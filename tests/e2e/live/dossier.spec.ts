import { expect, test } from "@playwright/test";
import { z } from "zod";
import { OLD_HANDOFF_MS } from "../fixtures/env";
import { finishedDossier, type StreamStep, stageMs } from "../fixtures/helpers";

/**
 * The live smoke (spec 21 §10.1): one rapid dossier against the deployment `PLAYWRIGHT_BASE_URL`
 * names, run only with `BASTION_LIVE_SMOKE=1` — never in CI. It spends one debate, a few scrapes and
 * at most 12 certificates of that deployment's budgets.
 *
 *   BASTION_LIVE_SMOKE=1 PLAYWRIGHT_BASE_URL=https://bastion-six.vercel.app pnpm test:e2e
 *
 * The dossier is followed only over its public SSE stream, which never advances anything, and its
 * page is opened only once it has finished — so every stage after the first was started by the
 * runner's own after() chain. It must cross a stage that ran longer than the 10 s handoff in one
 * invocation (proving the platform does not cancel the chain when its caller lets go), then pass
 * every verification check, live, in the browser.
 */

const ENABLED = process.env.BASTION_LIVE_SMOKE === "1" && Boolean(process.env.PLAYWRIGHT_BASE_URL);
/** Stages that never wait across invocations: each one's duration is one invocation's. */
const ONE_INVOCATION = ["gather", "seal", "measure", "envelope", "record"];

const budgetsSchema = z.object({ debate: z.object({ left: z.number().int() }) });
const sourcesSchema = z.array(z.object({ name: z.string(), item_count: z.number().int() }));
const samplesSchema = z.object({ items: z.array(z.object({ id: z.uuid() })).min(1) });
const healthSchema = z.object({ state: z.enum(["live", "asleep", "down"]) });

test.skip(!ENABLED, "set BASTION_LIVE_SMOKE=1 and PLAYWRIGHT_BASE_URL to spend a live debate");

test("live: a rapid dossier runs on its own chain past the 10 s handoff and verifies", async ({
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

  // The chain's trace (spec 21 §6.2) goes into the report whether the run passes or fails.
  let done: Awaited<ReturnType<typeof finishedDossier>>;
  try {
    done = await finishedDossier(baseURL ?? "", id, 15 * 60_000, 5_000, 3 * 60_000);
  } finally {
    const trace = await request.get(`/api/dossiers/${id}/chain-trace`);
    await test.info().attach("chain-trace.json", {
      body: trace.ok() ? await trace.text() : `chain trace unavailable: HTTP ${trace.status()}`,
      contentType: trace.ok() ? "application/json" : "text/plain",
    });
  }
  const timings = done.steps.map(
    (s: StreamStep) => `${s.stage} ${s.status} ${stageMs(s) ?? "–"} ms`,
  );
  test.info().annotations.push({ type: "stages", description: timings.join(" · ") });
  expect(done.status, timings.join("\n")).toBe("succeeded");

  const longest = Math.max(
    ...done.steps.filter((s) => ONE_INVOCATION.includes(s.stage)).map((s) => stageMs(s) ?? 0),
  );
  expect(
    longest,
    `no single-invocation stage outlasted the ${OLD_HANDOFF_MS} ms window the hand-off used to have, so this run did not prove the chain survives its caller letting go; run it again (more sources make gather longer)`,
  ).toBeGreaterThan(OLD_HANDOFF_MS);

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
