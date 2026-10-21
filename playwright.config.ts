/**
 * Playwright (spec 21 §10.1). Two ways to run it:
 *
 * 1. The stub run (CI's `e2e` job; the default): against `next build && next start`, never a dev
 *    server. Playwright starts, in order, the stub that stands in for every downstream service
 *    (`tests/e2e/fixtures/upstream.ts`), the main app (:3100) and the limits app (:3101, no debates
 *    today, feathers-demo asleep), then seeds the golden dossier. Needs a built app and
 *    `DATABASE_URL` naming a local, migrated Postgres:
 *
 *      pnpm build
 *      DATABASE_URL=postgresql://…@localhost:5432/bastion_e2e node scripts/migrate.mjs --force
 *      DATABASE_URL=postgresql://…@localhost:5432/bastion_e2e pnpm test:e2e
 *
 * 2. A deployment (`PLAYWRIGHT_BASE_URL=https://…`): no stub, no seed, nothing written. Only the
 *    metadata spec runs — and, with `BASTION_LIVE_SMOKE=1`, the live smoke (`tests/e2e/live/`),
 *    which spends one debate on that deployment.
 *
 * There is no sign-in (spec 21 §2): every spec is an anonymous visitor.
 */
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";
import {
  APP_PORT,
  APP_URL,
  E2E_SWEEP_TOKEN,
  isLocalDatabase,
  LIMITS_BUDGETS,
  LIMITS_PORT,
  MAIN_BUDGETS,
  STUB_ORIGIN,
  STUB_PORT,
  serviceUrls,
  type Tenant,
} from "./tests/e2e/fixtures/env";
import { prepareRun, serverLogFile } from "./tests/e2e/fixtures/run-files";

const DEPLOYMENT = process.env.PLAYWRIGHT_BASE_URL;
const LIVE_SMOKE = process.env.BASTION_LIVE_SMOKE === "1";

type WebServer = NonNullable<Extract<PlaywrightTestConfig["webServer"], unknown[]>>[number];

/** The stub, then the two apps — each app's every downstream URL under its tenant on the stub. */
function stubRunServers(): WebServer[] {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!isLocalDatabase(databaseUrl)) {
    throw new Error(
      "e2e: DATABASE_URL must name a local, migrated Postgres (localhost). The stub run writes to it; " +
        "it never runs against a hosted database. To test a deployment, set PLAYWRIGHT_BASE_URL.",
    );
  }
  const files = prepareRun(__dirname);

  const app = (tenant: Tenant, port: number, budgets: Readonly<Record<string, string>>) => ({
    name: tenant,
    // The app's output goes to .e2e/<tenant>.log (cases 3 and 5 read its drive.stage lines back).
    command: `pnpm exec next start --port ${port} 2>&1 | tee "${serverLogFile(__dirname, tenant)}"`,
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: databaseUrl,
      // A throwaway secret and signing key: nothing the run mints is valid anywhere else.
      IRON_SESSION_PASSWORD: process.env.IRON_SESSION_PASSWORD ?? files.ironSessionPassword,
      BASTION_SIGNING_KEY_PRIVATE: files.signingKeyPrivate,
      BASTION_SIGNING_KEY_PUBLIC: files.signingKeyPublic,
      BASTION_KEY_ID: "e2e-stub-key",
      // Blank, so a developer's .env cannot point the run at a real Upstash: budgets are counted
      // in-process and the rate limits are off.
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      VERCEL_GIT_COMMIT_SHA: "",
      NODE_EXTRA_CA_CERTS: files.certPath,
      ...serviceUrls(tenant),
      ...budgets,
    },
  });

  return [
    {
      name: "stub",
      command: "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON tests/e2e/fixtures/upstream.ts",
      url: `${STUB_ORIGIN}/__ready`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        E2E_STUB_PORT: String(STUB_PORT),
        E2E_STUB_CERT: files.certPath,
        E2E_STUB_KEY: files.keyPath,
      },
    },
    app("main", APP_PORT, { ...MAIN_BUDGETS, BASTION_SWEEP_TOKEN: E2E_SWEEP_TOKEN }),
    app("limits", LIMITS_PORT, LIMITS_BUDGETS),
  ];
}

const shared: PlaywrightTestConfig = {
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
};

export default DEPLOYMENT
  ? defineConfig({
      ...shared,
      projects: [
        {
          name: "deployment",
          testMatch: LIVE_SMOKE
            ? [/metadata\.spec\.ts$/, /live\/.*\.spec\.ts$/]
            : /metadata\.spec\.ts$/,
          use: { ...devices["Desktop Chrome"], baseURL: DEPLOYMENT },
        },
      ],
    })
  : defineConfig({
      ...shared,
      globalSetup: "./tests/e2e/fixtures/seed.ts",
      webServer: stubRunServers(),
      projects: [
        {
          name: "stub",
          testIgnore: /live\//,
          use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
        },
      ],
    });
