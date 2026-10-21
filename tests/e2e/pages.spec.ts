import { expect, test } from "@playwright/test";

/**
 * spec 21 §3.2 and §10.1 case 8: the open log and the registry, rendered from the real database —
 * the golden dossier's audit events at their seeded ids — and the stub's health.
 */

const GOLDEN_ID = "550e8400-e29b-41d4-a716-446655440000";
const GOLDEN_REQUEST = "req-dossier-1";
const SERVICES = ["paper-trail", "magpie", "inkprint", "inkthread", "slowquery", "feathers-demo"];

test.describe("21-e2e: the open log and the registry", () => {
  test("case 8: /audit filters by request; the trail links its dossier; a bad filter reads nothing", async ({
    page,
  }) => {
    await page.goto(`/audit?request=${GOLDEN_REQUEST}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("audit log");
    await expect(page.locator("[data-event]")).toHaveCount(5);

    await page.goto(`/audit/${GOLDEN_REQUEST}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("request");
    await expect(page.locator("[data-event]")).toHaveCount(5);
    await expect(page.getByRole("link", { name: /^dossier 550e8400/ })).toHaveAttribute(
      "href",
      `/d/${GOLDEN_ID}`,
    );

    // An unknown service is refused before any read, and the page says how to clear it.
    await page.goto("/audit?service=nope");
    await expect(page.getByRole("link", { name: "clear filters" })).toBeVisible();
    await expect(page.locator("[data-event]")).toHaveCount(0);
  });

  test("case 8: /time-travel replays the log and /platform shows the registry live", async ({
    page,
  }) => {
    await page.goto("/time-travel");
    await expect(page.getByRole("slider")).toBeVisible();
    await expect(page.getByRole("list", { name: "entities as they stood" })).toBeVisible();

    await page.goto("/platform");
    const services = page.locator('[data-section="services"]');
    for (const id of SERVICES) {
      await expect(services.locator(`[data-service="${id}"]`)).toContainText("live", {
        timeout: 30_000,
      });
    }
    // The token contract names the run's key id; the page never shows a secret.
    await expect(page.locator('[data-section="contract"]')).toContainText("e2e-stub-key");
    const html = await page.content();
    expect(html).not.toContain("PRIVATE KEY");
    expect(html).not.toMatch(/postgres(ql)?:\/\//);
  });
});
