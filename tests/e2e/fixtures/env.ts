/**
 * The e2e run's fixed facts (spec 21 §10.1): ports, the stub's tenants and service prefixes, and the
 * environment each app is started with. Pure — `prepareRun()` in `run-files.ts` makes the files
 * (TLS certificate, throwaway keys) this environment points at. Node runs the stub straight from
 * TypeScript, so this module uses erasable syntax only and imports nothing.
 */

export const STUB_PORT = 8543;
export const APP_PORT = 3100;
export const LIMITS_PORT = 3101;

export const STUB_ORIGIN = `https://localhost:${STUB_PORT}`;
/** The main app: every service live, budgets generous. */
export const APP_URL = `http://localhost:${APP_PORT}`;
/** The limits app: no debates today, feathers-demo asleep until a test wakes it. */
export const LIMITS_URL = `http://localhost:${LIMITS_PORT}`;

export const SERVICE_IDS = [
  "paper-trail",
  "magpie",
  "inkprint",
  "inkthread",
  "slowquery",
  "feathers-demo",
] as const;
export type StubServiceId = (typeof SERVICE_IDS)[number];

export const TENANTS = ["main", "limits"] as const;
export type Tenant = (typeof TENANTS)[number];

/**
 * The stub-only magpie source behind the hand-off case (spec 21 §10.1 case 5): its batch scrape takes
 * SLOW_STAGE_MS, and the first seal of a dossier citing it takes as long and then answers a retryable
 * 503 — the first live smoke's failure.
 */
export const SLOW_SOURCE = "slow-wire";
export const SLOW_STAGE_MS = 12_000;
/** The hand-off's old fixed window: a stage longer than this lost its successor chain on Vercel. */
export const OLD_HANDOFF_MS = 10_000;
/** What the runner logs when a hand-off lets go before its successor answered (src/dossier/chain.ts). */
export const HANDOFF_LET_GO = "the hand-off let go before the next advance answered";

/** The main app's sweep token for this run only (spec 21 §6.2 "The sweep"); not a secret. */
export const E2E_SWEEP_TOKEN = "e2e-sweep-token-for-the-local-stub-run";
/** A dossier the seed leaves stalled at its first stage, for the sweep to drive (case 9). */
export const STALLED_DOSSIER_ID = "5a11ed00-0000-4000-8000-000000000009";

/** Budgets for the main app: high enough that retries and parallel workers never run out. */
export const MAIN_BUDGETS: Readonly<Record<string, string>> = {
  BUDGET_DEBATE: "100",
  BUDGET_UPLOAD: "100",
  BUDGET_LEAKSCAN: "100",
  BUDGET_SCRAPE: "500",
  BUDGET_CERTIFY: "2000",
  BUDGET_FEATHERS_WRITE: "500",
};

/** The limits app: the same, except no debate today (spec 21 §10.1 case 6). */
export const LIMITS_BUDGETS: Readonly<Record<string, string>> = {
  ...MAIN_BUDGETS,
  BUDGET_DEBATE: "0",
};

/** `<SERVICE>_BACKEND_URL` for every service, under one tenant's prefix on the stub. */
export function serviceUrls(tenant: Tenant): Record<string, string> {
  return Object.fromEntries(
    SERVICE_IDS.map((id) => [
      `${id.toUpperCase().replaceAll("-", "_")}_BACKEND_URL`,
      `${STUB_ORIGIN}/${tenant}/${id}`,
    ]),
  );
}

/** A Postgres URL the e2e run may write to: a local host only, never a hosted database. */
export function isLocalDatabase(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  );
}
