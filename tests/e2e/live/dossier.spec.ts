import { expect, test } from "@playwright/test";
import { z } from "zod";
import { finishedDossier, type StreamStep, stageMs } from "../fixtures/helpers";

/**
 * The live smoke (spec 21 §10.1): one rapid dossier against the deployment `PLAYWRIGHT_BASE_URL`
 * names, run only with `BASTION_LIVE_SMOKE=1` — never in CI. It spends one debate, a few scrapes and
 * at most 12 certificates of that deployment's budgets.
 *
 *   BASTION_LIVE_SMOKE=1 PLAYWRIGHT_BASE_URL=https://bastion-six.vercel.app pnpm test:e2e
 *
 * The dossier is followed only over its public SSE stream, which never advances anything, and its
 * page is opened only once it has finished — so no page nudges it. It must reach `succeeded` within
 * 12 minutes, driven by the chain, the foreground loop or the 5-minute sweep (spec 21 §6.2), then
 * pass every verification check, live, in the browser. The report carries the dossier's chain trace
 * and which driver ran each stage.
 */

const ENABLED = process.env.BASTION_LIVE_SMOKE === "1" && Boolean(process.env.PLAYWRIGHT_BASE_URL);

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

/** "seal: sweep (attempt ok)" per stage, in the order the trace recorded them. */
function driversOf(body: string): string[] {
  const parsed = traceSchema.safeParse(JSON.parse(body));
  if (!parsed.success) return [];
  return parsed.data.events
    .filter((e) => e.event === "drive.stage")
    .map((e) => `${e.stage ?? "?"}: ${e.driver ?? "?"}`);
}

test.skip(!ENABLED, "set BASTION_LIVE_SMOKE=1 and PLAYWRIGHT_BASE_URL to spend a live debate");

test("live: a rapid dossier with no page open succeeds within 12 minutes and verifies", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(20 * 60_000);

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

  // Driven by the chain, the foreground loop or the sweep — no page is open. The chain's trace
  // (spec 21 §6.2) goes into the report whether the run passes or fails.
  let done: Awaited<ReturnType<typeof finishedDossier>> | null = null;
  let failure: unknown = null;
  try {
    done = await finishedDossier(baseURL ?? "", id, 12 * 60_000, 5_000);
  } catch (err) {
    failure = err;
  }
  const trace = await request.get(`/api/dossiers/${id}/chain-trace`);
  const traceBody = trace.ok() ? await trace.text() : null;
  await test.info().attach("chain-trace.json", {
    body: traceBody ?? `chain trace unavailable: HTTP ${trace.status()}`,
    contentType: traceBody === null ? "text/plain" : "application/json",
  });
  // Which driver ran each stage, from the trace's drive.stage lines (unknown without the trace).
  const drivenBy = traceBody === null ? [] : driversOf(traceBody);
  test.info().annotations.push({
    type: "drivers",
    description: drivenBy.length === 0 ? "unknown: no trace" : drivenBy.join(" · "),
  });
  if (failure !== null || done === null) throw failure;
  const timings = done.steps.map(
    (s: StreamStep) => `${s.stage} ${s.status} ${stageMs(s) ?? "–"} ms`,
  );
  test.info().annotations.push({ type: "stages", description: timings.join(" · ") });
  expect(done.status, timings.join("\n")).toBe("succeeded");

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
