import { z } from "zod";
import { SERVICES, type ServiceId } from "./products";

export type Health = {
  service: ServiceId;
  state: "live" | "asleep" | "down";
  latencyMs: number;
  version?: string;
  commitSha?: string;
  checkedAt: string;
};

export type ProbeOutcome =
  | { kind: "response"; status: number; body: unknown; ms: number }
  | { kind: "timeout"; ms: number }
  | { kind: "network_error"; ms: number };

/** Pure: a 2xx is live, a timeout means a cold Render instance (asleep), everything else is down. */
export function classifyProbe(outcome: ProbeOutcome): Health["state"] {
  switch (outcome.kind) {
    case "timeout":
      return "asleep";
    case "network_error":
      return "down";
    case "response":
      return outcome.status >= 200 && outcome.status < 300 ? "live" : "down";
  }
}

const versionBody = z.object({
  version: z.string().optional(),
  commit_sha: z.string().optional(),
  commit: z.string().optional(),
});

async function timed(url: string, timeoutMs: number): Promise<ProbeOutcome> {
  const start = performance.now();
  const ms = () => Math.round(performance.now() - start);
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
      redirect: "manual",
    });
    const body: unknown = await res.json().catch(() => null);
    return { kind: "response", status: res.status, body, ms: ms() };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return name === "TimeoutError" || name === "AbortError"
      ? { kind: "timeout", ms: ms() }
      : { kind: "network_error", ms: ms() };
  }
}

/** `/version` is best effort: it never gets more than this, nor more than the budget has left. */
export const VERSION_BUDGET_MS = 3_000;

/** Wake re-probes a cold start in attempts of at most this, so a stuck connection is retried. */
export const WAKE_ATTEMPT_MS = 30_000;

/** Pause after a fast 502/503 from Render's proxy before asking again. */
export const WAKE_PAUSE_MS = 2_000;

function assertBudget(ms: number, name: string): void {
  if (!Number.isFinite(ms) || ms <= 0) throw new RangeError(`${name} must be a positive number`);
}

/** Render's proxy answers a cold start with a timeout or a 502/503 — worth asking again. */
function isColdStart(outcome: ProbeOutcome): boolean {
  return (
    outcome.kind === "timeout" ||
    (outcome.kind === "response" && (outcome.status === 502 || outcome.status === 503))
  );
}

async function readVersion(health: Health, budgetMs: number): Promise<void> {
  const ms = Math.floor(Math.min(VERSION_BUDGET_MS, budgetMs));
  if (ms <= 0) return;
  const { baseUrl, versionPath } = SERVICES[health.service];
  const v = await timed(`${baseUrl}${versionPath}`, ms);
  if (v.kind === "response" && v.status >= 200 && v.status < 300) {
    const parsed = versionBody.safeParse(v.body);
    if (parsed.success) {
      const commitSha = parsed.data.commit_sha ?? parsed.data.commit;
      if (parsed.data.version) health.version = parsed.data.version;
      if (commitSha) health.commitSha = commitSha;
    }
  }
}

function healthOf(service: ServiceId, outcome: ProbeOutcome, latencyMs: number): Health {
  return {
    service,
    state: classifyProbe(outcome),
    latencyMs,
    checkedAt: new Date().toISOString(),
  };
}

/** Imperative shell: probe `/health` once, and when live read `/version` with what is left. */
export async function probe(service: ServiceId, timeoutMs: number): Promise<Health> {
  assertBudget(timeoutMs, "probe: timeoutMs");
  const { baseUrl, healthPath } = SERVICES[service];
  const outcome = await timed(`${baseUrl}${healthPath}`, Math.ceil(timeoutMs));
  const health = healthOf(service, outcome, outcome.ms);
  if (health.state === "live") await readVersion(health, timeoutMs - outcome.ms);
  return health;
}

/**
 * Hold a cold service until it answers or `deadlineMs` passes (spec 21 §4: up to 90 s). A timeout
 * or a 502/503 is a cold start in progress, so it asks again; anything else is final. Returns the
 * last answer's Health, with `latencyMs` the whole wait.
 */
export async function wake(
  service: ServiceId,
  deadlineMs: number,
  opts: { attemptMs?: number; pauseMs?: number } = {},
): Promise<Health> {
  assertBudget(deadlineMs, "wake: deadlineMs");
  const attemptMs = opts.attemptMs ?? WAKE_ATTEMPT_MS;
  const pauseMs = opts.pauseMs ?? WAKE_PAUSE_MS;
  const { baseUrl, healthPath } = SERVICES[service];
  const started = performance.now();
  // Whole milliseconds: AbortSignal.timeout throws on a fractional delay.
  const remaining = () => Math.floor(deadlineMs - (performance.now() - started));

  let outcome = await timed(`${baseUrl}${healthPath}`, Math.min(attemptMs, remaining()));
  while (isColdStart(outcome) && remaining() > 0) {
    if (outcome.kind === "response") {
      await new Promise((resolve) => setTimeout(resolve, Math.min(pauseMs, remaining())));
      if (remaining() <= 0) break;
    }
    outcome = await timed(`${baseUrl}${healthPath}`, Math.min(attemptMs, remaining()));
  }

  const health = healthOf(service, outcome, Math.round(performance.now() - started));
  if (health.state === "live") await readVersion(health, remaining());
  return health;
}
