import type { QueryRow } from "@/capabilities/slowquery";
import type { ServiceId } from "@/platform/registry/products";
import type { FailedOutcome, ToolOutcome } from "../outcome";

/**
 * slowquery's fleet view (spec 21 §5, §5.1): every host's `/_slowquery/queries` merged, slowest
 * first, each row tagged with its host — and each host's own state said, so one asleep service never
 * reads as an empty one. Pure.
 */

export type HostAnswer = { service: ServiceId; outcome: ToolOutcome<QueryRow[]> };

export type HostState =
  | { service: ServiceId; state: "ok"; count: number; requestId: string }
  | { service: ServiceId; state: "failed"; failure: FailedOutcome };

export type FleetRow = { service: ServiceId; row: QueryRow; requestId: string };

export type FleetView = { rows: FleetRow[]; hosts: HostState[] };

export const FLEET_LIMIT = 15;

/** A fingerprint's weight: p95, else the max, else the mean of its calls. */
export function rankMs(row: QueryRow): number {
  if (row.p95_ms !== null) return row.p95_ms;
  if (row.max_ms !== null) return row.max_ms;
  return row.call_count > 0 ? row.total_ms / row.call_count : 0;
}

export function fleetView(answers: readonly HostAnswer[], limit: number = FLEET_LIMIT): FleetView {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("fleet: the limit must be a positive whole number");
  }
  const hosts: HostState[] = [];
  const rows: FleetRow[] = [];
  for (const { service, outcome } of answers) {
    if (outcome.ok) {
      hosts.push({
        service,
        state: "ok",
        count: outcome.data.length,
        requestId: outcome.requestId,
      });
      for (const row of outcome.data) rows.push({ service, row, requestId: outcome.requestId });
    } else {
      hosts.push({ service, state: "failed", failure: outcome });
    }
  }
  // A stable sort keeps the hosts' own order among equal weights.
  rows.sort((a, b) => rankMs(b.row) - rankMs(a.row));
  return { rows: rows.slice(0, limit), hosts };
}
