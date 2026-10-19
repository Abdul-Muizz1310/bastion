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

/** Imperative shell: probe `/health`, and when live read `/version` (best effort). */
export async function probe(service: ServiceId, timeoutMs: number): Promise<Health> {
  const { baseUrl, healthPath, versionPath } = SERVICES[service];
  const outcome = await timed(`${baseUrl}${healthPath}`, timeoutMs);
  const state = classifyProbe(outcome);
  const health: Health = {
    service,
    state,
    latencyMs: outcome.ms,
    checkedAt: new Date().toISOString(),
  };
  if (state !== "live") return health;
  const v = await timed(`${baseUrl}${versionPath}`, timeoutMs);
  if (v.kind === "response" && v.status >= 200 && v.status < 300) {
    const parsed = versionBody.safeParse(v.body);
    if (parsed.success) {
      const commitSha = parsed.data.commit_sha ?? parsed.data.commit;
      if (parsed.data.version) health.version = parsed.data.version;
      if (commitSha) health.commitSha = commitSha;
    }
  }
  return health;
}
