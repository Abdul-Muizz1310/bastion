import { expect, test } from "@playwright/test";

/**
 * E2E — role-based access to /time-travel (admin only).
 *  - viewer demo-sign-in → hit /time-travel → sees the styled 403 page.
 *  - editor demo-sign-in → hit /time-travel → sees the styled 403 page.
 *  - admin is NOT available in demo mode (DEMO_MODE only allows viewer/editor),
 *    so this block doesn't cover the happy-admin path — that's covered by
 *    unit tests against the requireRole helper.
 */

test.describe("13-e2e: page RBAC", () => {
  // A bare /login visit carries no returnTo, so the demo sign-in action lands
  // on its default redirect target /dashboard. Awaiting that URL also makes
  // sure the session cookie is set before the test navigates elsewhere.
  async function signInAsViewer(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByRole("button", { name: "viewer" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }

  async function signInAsEditor(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByRole("button", { name: "editor" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  }

  test("viewer hitting /time-travel sees the styled 403", async ({ page }) => {
    await signInAsViewer(page);
    await page.goto("/time-travel");
    await expect(page.locator("h1, p").first()).toContainText(/access denied|403/i);
    await expect(page.getByRole("link", { name: /back to dashboard/i })).toBeVisible();
  });

  test("editor hitting /time-travel sees the styled 403", async ({ page }) => {
    await signInAsEditor(page);
    await page.goto("/time-travel");
    await expect(page.getByText(/access denied|403/i).first()).toBeVisible();
  });

  test("viewer home page shows read-only footer and disabled start button", async ({ page }) => {
    await signInAsViewer(page);
    await page.goto("/");
    // .first(): both DossierPrompt and RunDemoButton render a read-only note.
    await expect(page.getByText(/read-only/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /start dossier/i })).toBeDisabled();
  });
});
