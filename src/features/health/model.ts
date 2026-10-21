import * as z from "zod/mini";
import type { Health } from "@/platform/registry/health";
import type { ServiceId } from "@/platform/registry/products";

/**
 * The health a page shows (spec 21 §3.1). Pure: no fetch, no timers, no React — it runs in the
 * browser, so it imports only types from the server registry.
 *
 * A service is live | asleep | down (the status route's answer). The page adds three display states:
 * "checking" before the first answer, "unknown" when there is no answer for a service, and "waking"
 * while a wake request is in flight (Ruling F; the workbenches use it, the home map never does).
 */

export type DisplayState = Health["state"] | "waking" | "checking" | "unknown";

/** One service's answer as the browser reads it: the id is a string until matched to the page's ids. */
export type ServiceHealth = Omit<Health, "service"> & { service: string };

export type StatusSnapshot =
  | { phase: "checking" }
  | { phase: "ok"; checkedAt: string; services: Readonly<Partial<Record<string, ServiceHealth>>> }
  | { phase: "error"; checkedAt: string };

export type NodeHealth = { state: DisplayState; detail?: string };

export class StatusParseError extends Error {
  override name = "StatusParseError";
}

/** One service's Health as the status and wake routes send it. */
export const healthSchema: z.ZodMiniType<ServiceHealth> = z.object({
  service: z.string().check(z.minLength(1)),
  state: z.enum(["live", "asleep", "down"]),
  latencyMs: z.number().check(z.nonnegative()),
  version: z.optional(z.string()),
  commitSha: z.optional(z.string()),
  checkedAt: z.string(),
});

const statusSchema = z.object({
  services: z.array(healthSchema),
  timestamp: z.string(),
});

/** Parse GET /api/platform/status. One entry per service; anything else is refused. */
export function parseStatusResponse(body: unknown): StatusSnapshot {
  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    throw new StatusParseError(`status: unexpected body (${parsed.error.issues[0]?.message})`);
  }
  // Keyed by the id as sent; lookups go by the ServiceIds the server rendered into the page, so an
  // id the page does not know is simply never read.
  const services: Record<string, ServiceHealth> = {};
  for (const entry of parsed.data.services) {
    if (Object.hasOwn(services, entry.service)) {
      throw new StatusParseError(`status: ${entry.service} answered twice`);
    }
    services[entry.service] = entry;
  }
  return { phase: "ok", checkedAt: parsed.data.timestamp, services };
}

/** Worst first: the product's state is that of its least healthy service. */
const SEVERITY: Readonly<Record<"down" | "unknown" | "asleep" | "live", number>> = {
  down: 0,
  unknown: 1,
  asleep: 2,
  live: 3,
};

/**
 * A product's health from its services. A product with no service runs inside bastion, and bastion
 * is serving this page, so it is live.
 */
export function nodeHealth(services: readonly ServiceId[], snapshot: StatusSnapshot): NodeHealth {
  if (services.length === 0) return { state: "live", detail: "serving this page" };
  switch (snapshot.phase) {
    case "checking":
      return { state: "checking" };
    case "error":
      return { state: "unknown" };
    case "ok":
      break;
    default:
      return assertNever(snapshot);
  }

  const answers = services.map((id) => snapshot.services[id]);
  let worst: keyof typeof SEVERITY = "live";
  for (const answer of answers) {
    const state = answer?.state ?? "unknown";
    if (SEVERITY[state] < SEVERITY[worst]) worst = state;
  }
  const single = new Set(services).size === 1 ? answers[0] : undefined;
  if (worst === "live" && single)
    return { state: "live", detail: `${Math.round(single.latencyMs)} ms` };
  return { state: worst };
}

export type HealthCounts = {
  total: number;
  live: number;
  asleep: number;
  down: number;
  unknown: number;
  checking: number;
};

export function summarize(serviceIds: readonly string[], snapshot: StatusSnapshot): HealthCounts {
  const counts: HealthCounts = {
    total: serviceIds.length,
    live: 0,
    asleep: 0,
    down: 0,
    unknown: 0,
    checking: 0,
  };
  for (const id of serviceIds) {
    if (snapshot.phase === "checking") counts.checking += 1;
    else if (snapshot.phase === "error") counts.unknown += 1;
    else counts[snapshot.services[id]?.state ?? "unknown"] += 1;
  }
  return counts;
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected status snapshot: ${JSON.stringify(value)}`);
}
