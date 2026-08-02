"use server";

import { z } from "zod/v4";
import { type TimeTravelQueryResult, toTimeTravelView } from "@/features/time-travel/view";
import { getTimeTravelState } from "@/lib/audit/replay";
import { requireRole } from "@/lib/auth/rbac";

/**
 * Spec 07 — the only path from the browser to the DISTINCT ON replay query.
 *
 * Admin-gated (case 11) and read-only (case 12): it forwards nothing but
 * `asOf` and an optional `service` filter, both parsed at the boundary.
 */

// Parse, don't validate: an unparseable timestamp is rejected here rather than
// being handed to `new Date()` and silently becoming Invalid Date in SQL.
const asOfSchema = z.iso.datetime({ offset: true });
const serviceSchema = z.string().min(1).max(64);

export async function loadTimeTravelState(
  asOfIso: string,
  service?: string,
): Promise<TimeTravelQueryResult> {
  await requireRole(["admin"], "time-travel.query");

  const parsedAsOf = asOfSchema.safeParse(asOfIso);
  if (!parsedAsOf.success) {
    return { ok: false, error: "invalid_timestamp" };
  }

  let parsedService: string | undefined;
  if (service !== undefined) {
    const result = serviceSchema.safeParse(service);
    if (!result.success) {
      return { ok: false, error: "invalid_service" };
    }
    parsedService = result.data;
  }

  const asOf = new Date(parsedAsOf.data);
  const state = await getTimeTravelState({ asOf, service: parsedService });
  return { ok: true, view: toTimeTravelView(state, asOf) };
}
