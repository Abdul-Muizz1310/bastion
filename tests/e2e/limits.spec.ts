import { expect, test } from "@playwright/test";
import { z } from "zod";
import { LIMITS_URL } from "./fixtures/env";
import { firstGate, gateLive, setLimitsFeathers, stubCalls } from "./fixtures/helpers";

/**
 * spec 21 §4, §5.1 and §10.1 cases 6–7, on the limits app (`BUDGET_DEBATE=0`, feathers-demo asleep):
 * a spent budget is said as a limit and refused before any downstream call; an asleep service reads
 * asleep — never down — and "wake again" brings it live once it answers.
 */

test.use({ baseURL: LIMITS_URL });

test.describe("21-e2e: limits", () => {
  test("case 6: with no debates left, compose holds the run and the API refuses before paper-trail", async ({
    page,
    request,
  }) => {
    await page.goto("/dossier");
    await expect(
      page.getByText("No debates left today — budgets reset at 00:00 UTC", { exact: false }),
    ).toBeVisible();
    const run = page.getByRole("button", { name: /^run the dossier/ });
    await expect(run).toBeDisabled();
    await expect(run).toHaveAttribute("aria-describedby", /.+/);

    // The server reserves the debate itself: a direct POST is refused as a limit, with its wait.
    const refused = await request.post("/api/dossiers", {
      data: {
        claim: "The basic filing fee is 350 dollars.",
        sources: ["hackernews"],
        mode: "rapid",
      },
    });
    expect(refused.status()).toBe(429);
    const body = z
      .object({ error: z.literal("budget_exhausted"), retryAfterS: z.number().int() })
      .parse(await refused.json());
    expect(body.retryAfterS).toBeGreaterThan(0);
    expect(body.retryAfterS).toBeLessThanOrEqual(86_400);

    // The workbench's debate is held too, and says the budget is off today.
    await page.goto("/tools/paper-trail");
    await gateLive(firstGate(page));
    await expect(page.getByRole("button", { name: "start the debate" })).toBeDisabled();
    await expect(page.getByRole("meter", { name: "debates left today" })).toHaveAttribute(
      "aria-valuetext",
      "off today",
    );

    // Nothing from this app ever asked paper-trail for a debate.
    const debates = (await stubCalls("limits")).filter(
      (c) => c.service === "paper-trail" && c.method === "POST",
    );
    expect(debates).toEqual([]);
  });

  test("case 7: an asleep service reads asleep, never down, and wake again brings it live", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await setLimitsFeathers("asleep");

    // The map: the 8 s probe times out, which is asleep (a cold Render service), not down.
    await page.goto("/");
    const node = page.locator('svg[data-layout="wide"] a[href="/tools/feathers"]');
    await expect(node).toHaveAccessibleName(/^feathers\s+asleep\b/, { timeout: 60_000 });
    await expect(page.getByText(/^6 services: 5 live · 1 asleep/)).toBeVisible();

    // The workbench's gate holds the wake for 90 s, then says asleep and offers to try again.
    await page.goto("/tools/feathers");
    const gate = firstGate(page);
    await expect(gate).toHaveAttribute("data-gate", "waking");
    const proof = page.getByRole("button", { name: "run the proof: create, delete, read" });
    await expect(proof).toBeDisabled();
    await expect(gate).toHaveAttribute("data-gate", "asleep", { timeout: 120_000 });
    await expect(gate).toContainText("Asleep is not down: try again.");
    await expect(proof).toBeDisabled();

    // The service answers again; the retry wakes it, the gate opens and the first read runs.
    await setLimitsFeathers("awake");
    await page.getByRole("button", { name: "wake again" }).click();
    await gateLive(gate);
    await expect(proof).toBeEnabled();
    await expect(page.getByText("ada@example.com")).toBeVisible();
  });
});
