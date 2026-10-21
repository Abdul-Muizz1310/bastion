import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  type StreamStep,
  type SweepAnswer,
  stageMs,
  streamSnapshot,
  sweepOnce,
} from "../fixtures/helpers";

/**
 * The live smoke (spec 21 §10.1): one rapid dossier against the deployment `PLAYWRIGHT_BASE_URL`
 * names, run only with `BASTION_LIVE_SMOKE=1` — never in CI. It spends one debate, a few scrapes and
 * at most 12 certificates of that deployment's budgets.
 *
 *   BASTION_LIVE_SMOKE=1 BASTION_SWEEP_TOKEN=… PLAYWRIGHT_BASE_URL=https://bastion-six.vercel.app \
 *     pnpm test:e2e
 *
 * No page is open while it runs, and it does not wait for the 30-minute cron: the smoke itself is
 * the sweep's client (spec 21 §6.2 "Two drivers"). After composing it calls `POST
 * /api/dossiers/sweep` with `BASTION_SWEEP_TOKEN` about every 60 s until the dossier is done; it
 * must reach `succeeded` within 15 minutes, then pass every verification check, live, in the
 * browser. The report says which driver ran each stage — and, when the deployment keeps one
 * (`BASTION_CHAIN_TRACE=1`), carries the dossier's chain trace.
 */

const ENABLED = process.env.BASTION_LIVE_SMOKE === "1" && Boolean(process.env.PLAYWRIGHT_BASE_URL);
const SWEEP_TOKEN = process.env.BASTION_SWEEP_TOKEN?.trim() ?? "";
/** How often the smoke calls the sweep while its dossier is not done. */
const SWEEP_EVERY_MS = 60_000;
/** The dossier must be done this long after it was composed. */
const DONE_WITHIN_MS = 15 * 60_000;

const budgetsSchema = z.object({ debate: z.object({ left: z.number().int() }) });
const sourcesSchema = z.array(z.object({ name: z.string(), item_count: z.number().int() }));
const samplesSchema = z.object({ items: z.array(z.object({ id: z.uuid() })).min(1) });
const healthSchema = z.object({ state: z.enum(["live", "asleep", "down"]) });

const traceSchema = z.object({
  events: z.array(
    z.looseObject({
      event: z.string(),
      stage: z.string().optional(),
      driver: z.string().optional(),
    }),
  ),
});

/** "seal: sweep" per stage, in the order the chain trace recorded them. */
function driversOf(body: string): string[] {
  const parsed = traceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return [];
  return parsed.data.events
    .filter((e) => e.event === "drive.stage")
    .map((e) => `${e.stage ?? "?"}: ${e.driver ?? "?"}`);
}

/** "seal: sweep #2 (ok)" per stage the smoke's own sweep calls ran, in the order they ran them. */
function sweptStages(calls: SweepAnswer[], dossierId: string): string[] {
  return calls.flatMap((call, n) =>
    call.swept
      .filter((d) => d.dossierId === dossierId)
      .flatMap((d) => d.stages.map((s) => `${s.stage}: sweep #${n + 1} (${s.status})`)),
  );
}

const finished = (status: string) => status === "succeeded" || status === "failed";

test.skip(!ENABLED, "set BASTION_LIVE_SMOKE=1 and PLAYWRIGHT_BASE_URL to spend a live debate");
test.skip(
  SWEEP_TOKEN === "",
  "set BASTION_SWEEP_TOKEN to the deployment's sweep token: with no page open, the smoke drives its dossier by calling POST /api/dossiers/sweep",
);

test("live: a rapid dossier with no page open, driven by the sweep, succeeds within 15 minutes and verifies", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(30 * 60_000);

  const budgets = budgetsSchema.parse(await (await request.get("/api/platform/budgets")).json());
  expect(budgets.debate.left, "no debates left today on this deployment").toBeGreaterThan(0);

  // Compose checks its sources and samples against magpie and inkthread: wake them first.
  for (const service of ["magpie", "inkthread"]) {
    const woke = await request.post(`/api/platform/wake/${service}`, { timeout: 120_000 });
    expect(woke.status(), `wake ${service}`).toBe(200);
    expect(healthSchema.parse(await woke.json()).state, `${service} did not wake`).toBe("live");
  }
  const sources = sourcesSchema
    .parse(await (await request.get("/api/tools/magpie.sources")).json())
    .filter((s) => s.item_count > 0)
    .slice(0, 3)
    .map((s) => s.name);
  expect(sources.length, "magpie has no source with items").toBeGreaterThan(0);
  const sample = samplesSchema.parse(
    await (await request.get("/api/tools/inkthread.samples")).json(),
  ).items[0];

  const created = await request.post("/api/dossiers", {
    data: {
      claim: "The fee schedule lists a basic filing fee for a utility patent application.",
      sources,
      documents: sample ? [{ document_id: sample.id, kind: "sample" }] : [],
      mode: "rapid",
    },
  });
  expect(created.status(), await created.text()).toBe(202);
  const { dossier_id: id } = z.object({ dossier_id: z.uuid() }).parse(await created.json());
  test.info().annotations.push({ type: "dossier", description: `${baseURL}/d/${id}` });
  const composedAt = Date.now();

  // The smoke is the sweep's client: a call drives every due dossier in the foreground and answers
  // what it ran; another starts about 60 s after the last one started, until the dossier is done.
  // None starts once 15 minutes have passed.
  const calls: SweepAnswer[] = [];
  let failure: unknown = null;
  let snapshot = await streamSnapshot(baseURL ?? "", id);
  try {
    while (!finished(snapshot.status) && Date.now() - composedAt < DONE_WITHIN_MS) {
      const calledAt = Date.now();
      calls.push(await sweepOnce(request, SWEEP_TOKEN));
      snapshot = await streamSnapshot(baseURL ?? "", id);
      const wait = SWEEP_EVERY_MS - (Date.now() - calledAt);
      if (!finished(snapshot.status) && wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
        snapshot = await streamSnapshot(baseURL ?? "", id);
      }
    }
  } catch (err) {
    failure = err;
  }
  const doneAt = Date.now();

  // Which driver ran each stage — pass or fail: the smoke's sweep calls' own answers, and the
  // chain trace's drive.stage lines when the deployment keeps one.
  const swept = sweptStages(calls, id);
  console.info(`drivers: ${swept.join(" · ") || "none of the smoke's sweeps ran a stage"}`);
  test.info().annotations.push({
    type: "drivers",
    description: swept.length === 0 ? "no stage was run by the smoke's sweeps" : swept.join(" · "),
  });
  test.info().annotations.push({
    type: "sweeps",
    description: calls
      .map((c, n) => {
        const mine = c.swept.find((d) => d.dossierId === id);
        return `#${n + 1} ${c.ms} ms ${mine === undefined ? "not selected" : `stopped ${mine.stopped}`}`;
      })
      .join(" · "),
  });
  const trace = await request.get(`/api/dossiers/${id}/chain-trace`);
  const traceBody = trace.ok() ? await trace.text() : null;
  await test.info().attach("chain-trace.json", {
    body:
      traceBody ??
      `chain trace unavailable: HTTP ${trace.status()} (the deployment keeps one only with BASTION_CHAIN_TRACE=1)`,
    contentType: traceBody === null ? "text/plain" : "application/json",
  });
  if (traceBody !== null) {
    test
      .info()
      .annotations.push({ type: "traced drivers", description: driversOf(traceBody).join(" · ") });
  }
  if (failure !== null) throw failure;

  const timings = snapshot.steps.map(
    (s: StreamStep) => `${s.stage} ${s.status} ${stageMs(s) ?? "–"} ms`,
  );
  test.info().annotations.push({ type: "stages", description: timings.join(" · ") });
  expect(snapshot.status, `after ${calls.length} sweeps:\n${timings.join("\n")}`).toBe("succeeded");
  expect(doneAt - composedAt, "done, but not within 15 minutes").toBeLessThanOrEqual(
    DONE_WITHIN_MS,
  );

  await page.goto(`/d/${id}`);
  await page.getByRole("button", { name: "verify everything" }).click();
  const checks = page.locator("li[data-check]");
  await expect(checks).toHaveCount(7, { timeout: 120_000 });
  for (const check of await checks.all()) {
    const name = await check.getAttribute("data-check");
    await expect(check, `${name}: ${await check.innerText()}`).toHaveAttribute(
      "data-state",
      "pass",
    );
  }
});
