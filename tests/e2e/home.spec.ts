import { expect, test } from "@playwright/test";

/**
 * spec 21 §3.1 and §10.1 case 1: the platform map. Eight product nodes, each a link to its
 * workbench whose accessible name carries its health in words; reachable and opened by keyboard.
 */

const PRODUCTS = [
  "bastion",
  "magpie",
  "inkgrid",
  "inkthread",
  "inkprint",
  "paper-trail",
  "slowquery",
  "feathers",
] as const;

test.describe("21-e2e: the platform map", () => {
  test("case 1: eight nodes, each a workbench link whose name says its state in words", async ({
    page,
  }) => {
    await page.goto("/");
    const map = page.locator('svg[data-layout="wide"]');
    await expect(map).toBeVisible();
    await expect(map.locator("a")).toHaveCount(PRODUCTS.length);

    // The first answer of the shared status poll: every service the stub serves is live.
    await expect(page.getByText(/^6 services: 6 live/)).toBeVisible({ timeout: 30_000 });
    for (const id of PRODUCTS) {
      const node = map.locator(`a[href="/tools/${id}"]`);
      await expect(node).toHaveCount(1);
      // Name, state and role: the state is a word, never colour alone.
      await expect(node).toHaveAccessibleName(new RegExp(`^${id}\\s+live\\b`));
    }

    // The gallery holds the golden dossier, as a receipt linking to its public URL.
    const gallery = page.locator('[data-section="gallery"]');
    await expect(
      gallery.locator('a[href="/d/550e8400-e29b-41d4-a716-446655440000"]'),
    ).toBeVisible();
  });

  test("case 1: Tab reaches the map and Enter opens a node's workbench", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/^6 services: 6 live/)).toBeVisible({ timeout: 30_000 });

    // Tab from the top of the page until focus lands on the map's first node (the hub).
    const focusedHref = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        return el?.closest('svg[data-layout="wide"]') ? el.getAttribute("href") : null;
      });
    let href: string | null = null;
    for (let i = 0; i < 40 && href === null; i++) {
      await page.keyboard.press("Tab");
      href = await focusedHref();
    }
    expect(href).toBe("/tools/bastion");

    // The nodes are in the dossier's order: the next Tab is magpie, the one after inkgrid.
    await page.keyboard.press("Tab");
    expect(await focusedHref()).toBe("/tools/magpie");
    await page.keyboard.press("Tab");
    expect(await focusedHref()).toBe("/tools/inkgrid");

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tools\/inkgrid$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("inkgrid");
  });
});
