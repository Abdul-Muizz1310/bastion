/**
 * Playwright config — scaffolded in Block 13.
 *
 * To activate:
 *   pnpm add -D @playwright/test
 *   npx playwright install chromium
 *   pnpm build && pnpm start          # terminal 1
 *   pnpm test:e2e                      # terminal 2
 *
 * The e2e suite assumes DEMO_MODE=true so the guest sign-in shortcut is
 * available. In CI, point PLAYWRIGHT_BASE_URL at a preview deployment.
 */
import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "pnpm start",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
