import { expect, test } from "@playwright/test";

/**
 * E2E — canonical auth flow:
 *  - unauth → home redirects to /login?returnTo=%2F
 *  - demo-mode sign-in (viewer) → back at home, role pill reads "viewer"
 *  - viewer sees the prompt disabled with the "read-only" footer
 *
 * Requires DEMO_MODE=true in the running server's env so the guest buttons
 * render on /login.
 */

test.describe("13-e2e: auth flow", () => {
  test("unauth'd home redirects to login with returnTo preserved", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login\?returnTo=%2F/);
    await expect(page.locator("h1")).toContainText("bastion");
  });

  test("demo-mode viewer sign-in lands back on home with role pill", async ({ page }) => {
    await page.goto("/login");

    // Demo-mode quick-sign-in buttons. The "viewer" button submits the guest action.
    const viewerButton = page.getByRole("button", { name: "viewer" });
    await expect(viewerButton).toBeVisible();
    await viewerButton.click();

    // After redirect, we should be back at /
    await expect(page).toHaveURL(/\/(?:\?.*)?$/);

    // Nav should render the role pill (not the login link)
    await expect(page.getByText(/viewer/i).first()).toBeVisible();

    // Home should show the dossier console heading + read-only footer
    await expect(page.locator("h1")).toContainText(/initiate a dossier/i);
    await expect(page.getByText(/read-only/i)).toBeVisible();

    // "start dossier" button should be disabled for viewer
    const start = page.getByRole("button", { name: /start dossier/i });
    await expect(start).toBeDisabled();
  });
});
