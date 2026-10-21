import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { z } from "zod";
import { E2E_SWEEP_TOKEN, SLOW_SOURCE, SLOW_STAGE_MS, STALLED_DOSSIER_ID } from "./fixtures/env";
import {
  finishedDossier,
  gateLive,
  type SweepAnswer,
  serverLog,
  stageMs,
  streamSnapshot,
  sweepOnce,
} from "./fixtures/helpers";

/**
 * spec 21 §6 and §10.1 cases 3–5 and 9: the golden dossier — signed by the issuers' own code —
 * verifies 7 of 7; the sweep refuses no token and, with it, drives a stalled dossier to the end; a
 * dossier no page is watching does not move until the sweep drives it, across a 12 s scrape and a
 * retried seal; and a dossier composed in the browser is driven by its page's nudges alone, to its
 * receipt, and verified. Serial: a sweep drives every due dossier, so no sweep may run while the
 * browser's dossier is being driven by its page.
 */

const GOLDEN_ID = z
  .object({ dossier: z.object({ id: z.uuid() }) })
  .parse(
    JSON.parse(
      readFileSync(join(__dirname, "..", "fixtures", "receipts", "golden-dossier.json"), "utf8"),
    ),
  ).dossier.id;
const createdSchema = z.object({ dossier_id: z.uuid(), url: z.string() });
const bundleSchema = z.object({ dossier: z.object({ id: z.uuid(), status: z.string() }) });
const STATES = ["pass", "fail", "unavailable", "expired"];
const EVERY_STAGE = ["wake", "gather", "read", "seal", "debate", "measure", "envelope", "record"];

/** Runs "verify everything" and answers each check's state, by name. */
async function verifyEverything(page: Page): Promise<Record<string, string>> {
  await page.getByRole("button", { name: "verify everything" }).click();
  const checks = page.locator("li[data-check]");
  await expect(checks).toHaveCount(7, { timeout: 30_000 });
  const states: Record<string, string> = {};
  for (const check of await checks.all()) {
    const name = await check.getAttribute("data-check");
    const state = await check.getAttribute("data-state");
    if (name !== null && state !== null) states[name] = state;
    // Each state is written in words beside its glyph, never colour alone.
    expect(STATES).toContain(state);
    await expect(check).toContainText(state ?? "?");
  }
  return states;
}

const driveStageSchema = z.looseObject({
  event: z.literal("drive.stage"),
  dossierId: z.string(),
  stage: z.string(),
  driver: z.string(),
});

/** The main app's `drive.stage` lines for one dossier (spec 21 §6.2 "The trace"), oldest first. */
function drivenStages(dossierId: string): z.infer<typeof driveStageSchema>[] {
  return serverLog("main")
    .split("\n")
    .filter((line) => line.startsWith('{"tag":"dossier-chain"') && line.includes(dossierId))
    .flatMap((line) => {
      const parsed = driveStageSchema.safeParse(JSON.parse(line));
      return parsed.success && parsed.data.dossierId === dossierId ? [parsed.data] : [];
    });
}

test.describe("21-e2e: dossiers", () => {
  test.describe.configure({ mode: "serial" });

  test("case 4: the golden dossier verifies 7 of 7, and its receipts download", async ({
    page,
    request,
  }) => {
    await page.goto(`/d/${GOLDEN_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const states = await verifyEverything(page);
    expect(states).toEqual({
      certificates: "pass",
      transcript: "pass",
      envelope: "pass",
      perf: "pass",
      audit: "pass",
      documents: "pass",
      steps: "pass",
    });
    await expect(page.getByText("7 checks: 7 pass")).toBeVisible();

    const download = page.getByRole("link", { name: "download receipts" });
    const href = await download.getAttribute("href");
    expect(href).toBe(`/api/dossiers/${GOLDEN_ID}/receipts`);
    const bundle = await request.get(href ?? "");
    expect(bundle.status()).toBe(200);
    expect(bundle.headers()["content-disposition"]).toContain(`dossier-${GOLDEN_ID}.receipts.json`);
    const body = bundleSchema.parse(await bundle.json());
    expect(body.dossier).toMatchObject({ id: GOLDEN_ID, status: "succeeded" });
  });

  test("case 9: the sweep refuses no token, and with it drives a stalled dossier to the end", async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const refused = await request.post("/api/dossiers/sweep");
    expect(refused.status()).toBe(401);
    expect(refused.headers()["www-authenticate"]).toBe("Bearer");

    // Seeded with every stage due and nobody to drive it.
    expect((await streamSnapshot(baseURL ?? "", STALLED_DOSSIER_ID)).status).toBe("pending");

    const answer = await request.post("/api/dossiers/sweep", {
      headers: { authorization: `Bearer ${E2E_SWEEP_TOKEN}` },
      timeout: 140_000,
    });
    expect(answer.status()).toBe(200);
    const body = z
      .object({
        swept: z.array(
          z.object({
            dossierId: z.string(),
            stages: z.array(z.object({ stage: z.string(), status: z.string() })),
            dossier: z.string().nullable(),
            stopped: z.string(),
          }),
        ),
        ms: z.number(),
      })
      .parse(await answer.json());
    const stalled = body.swept.find((s) => s.dossierId === STALLED_DOSSIER_ID);
    expect(stalled).toMatchObject({ dossier: "succeeded", stopped: "done" });
    expect(new Set(stalled?.stages.map((s) => s.stage))).toEqual(new Set(EVERY_STAGE));
    const done = await finishedDossier(baseURL ?? "", STALLED_DOSSIER_ID, 10_000);
    expect(done.status).toBe("succeeded");
  });

  test("case 5: with no page open, nothing moves until the sweep drives it across a 12 s scrape and a retried seal", async ({
    request,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    const answer = await request.post("/api/dossiers", {
      data: {
        claim: "Hacker News lists the USPTO basic filing fee as 350 dollars.",
        sources: [SLOW_SOURCE],
        mode: "rapid",
      },
    });
    expect(answer.status()).toBe(202);
    const { dossier_id: id, url } = createdSchema.parse(await answer.json());
    expect(url).toBe(`/d/${id}`);

    // Followed only through the public stream, which never advances anything. Composing starts
    // nothing in the background: with no page and no sweep, no stage is even claimed.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const idle = await streamSnapshot(baseURL ?? "", id);
    expect(idle.status).toBe("pending");
    for (const step of idle.steps) expect(step).toMatchObject({ status: "pending", attempt: 0 });

    // The sweep drives it in the foreground, stage after stage: the scrape takes 12 s; the first
    // seal takes 12 s and answers a retryable 503, due again in 5 s — the loop sleeps through the
    // backoff and runs the second attempt. Called again until the dossier is done, as the live
    // smoke does.
    const sweeps: SweepAnswer[] = [];
    const deadline = Date.now() + 150_000;
    let snapshot = idle;
    while (snapshot.status !== "succeeded" && snapshot.status !== "failed") {
      expect(Date.now(), `still ${snapshot.status} after ${sweeps.length} sweeps`).toBeLessThan(
        deadline,
      );
      sweeps.push(await sweepOnce(request, E2E_SWEEP_TOKEN));
      snapshot = await streamSnapshot(baseURL ?? "", id);
    }
    const done = await finishedDossier(baseURL ?? "", id, 10_000);
    expect(done.status).toBe("succeeded");
    const gather = done.steps.find((s) => s.stage === "gather");
    expect(gather?.status).toBe("ok");
    expect(gather === undefined ? null : stageMs(gather)).toBeGreaterThanOrEqual(
      SLOW_STAGE_MS - 1_000,
    );
    const seal = done.steps.find((s) => s.stage === "seal");
    expect(seal).toMatchObject({ status: "ok", attempt: 2 });
    for (const step of done.steps) expect(["ok", "skipped"]).toContain(step.status);

    // What the sweeps answered, and what the app logged: every stage was driven by the sweep.
    const answered = sweeps.flatMap((s) => s.swept.filter((d) => d.dossierId === id));
    expect(new Set(answered.flatMap((d) => d.stages.map((s) => s.stage)))).toEqual(
      new Set(EVERY_STAGE),
    );
    const driven = drivenStages(id);
    expect(new Set(driven.map((e) => e.stage))).toEqual(new Set(EVERY_STAGE));
    expect(new Set(driven.map((e) => e.driver))).toEqual(new Set(["sweep"]));
  });

  test("case 3: composed in the browser, its page drives it to its receipt and every check is said in words", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/dossier");
    const gates = page.locator("[data-gate]");
    await gateLive(gates.nth(0));
    await gateLive(gates.nth(1));

    await page
      .getByLabel("claim to check")
      .fill("The USPTO basic filing fee for a utility patent is 350 dollars.");
    await page.getByRole("checkbox", { name: /^hackernews/ }).check();
    await page.getByRole("checkbox", { name: /^uspto-fee-schedule\.pdf/ }).check();
    await page.getByLabel(/^rapid · 1 round/).check();
    await page.getByRole("button", { name: /^run the dossier/ }).click();

    await expect(page).toHaveURL(/\/d\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    // The live island follows the run and nudges it; once done, the page renders again as the receipt.
    await expect(page.locator('[data-section="verify"]')).toBeVisible({ timeout: 90_000 });
    const stages = page.locator("[data-stage]");
    await expect(stages).toHaveCount(8);
    await expect(page.locator('[data-stage][data-status="ok"]')).toHaveCount(8);

    // The receipt: evidence rows with certificates, the transcript, the queries, the envelope.
    await expect(page.locator('tr[id^="e-"]').first()).toBeVisible();
    await expect(page.locator("[data-service]").first()).toBeVisible();
    await expect(
      page.getByText("CREATE INDEX IF NOT EXISTS ix_orders_created_at").first(),
    ).toBeVisible();

    const states = await verifyEverything(page);
    // bastion's own receipts hold; the stub cannot sign as inkprint, so the signed ones fail —
    // verification never passes what it could not prove.
    expect(states.steps).toBe("pass");
    expect(states.perf).toBe("pass");
    expect(states.documents).toBe("pass");
    expect(states.certificates).toBe("fail");
    expect(states.envelope).toBe("fail");

    // Driven by the page alone: its nudge on load, then each due stage — no sweep ran meanwhile.
    const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const driven = drivenStages(id);
    expect(new Set(driven.map((e) => e.stage))).toEqual(new Set(EVERY_STAGE));
    expect(new Set(driven.map((e) => e.driver))).toEqual(new Set(["visitor"]));
  });
});
