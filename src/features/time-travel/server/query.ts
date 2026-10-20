"use server";

import "server-only";
import { z } from "zod/v4";
import { allowRead } from "@/features/audit/read-limit";
import { toTimeTravelView } from "@/features/time-travel/to-view";
import type { TimeTravelQueryResult } from "@/features/time-travel/view";
import { getTimeTravelState } from "@/lib/audit/replay";

/**
 * Spec 07 — the only path from the browser to the DISTINCT ON replay query.
 *
 * Public (spec 21 §2: no sign-in) and read-only (case 12): it forwards nothing
 * but `asOf` and an optional `service` filter, both parsed at the boundary.
 */

// Parse, don't validate: an unparseable timestamp is rejected here rather than
// being handed to `new Date()` and silently becoming Invalid Date in SQL.
const asOfSchema = z.iso.datetime({ offset: true });
const serviceSchema = z.string().min(1).max(64);

export async function loadTimeTravelState(
  asOfIso: string,
  service?: string,
): Promise<TimeTravelQueryResult> {
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

  // Ruling AL: each accepted call spends one of the visitor's 60 replays a minute; a malformed one
  // was refused above without spending any.
  const allowance = await allowRead("replay");
  if (!allowance.ok) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterS: allowance.retryAfterS,
      limit: allowance.limit,
    };
  }

  const asOf = new Date(parsedAsOf.data);
  const state = await getTimeTravelState({ asOf, service: parsedService });
  return { ok: true, view: toTimeTravelView(state, asOf) };
}
