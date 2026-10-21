import { createHash, timingSafeEqual } from "node:crypto";
import {
  DRIVE_MARGIN_MS,
  type DrivenStage,
  type DriveResult,
  type DriveWindow,
  MIN_ROUND_MS,
  type StopReason,
} from "./drive";
import { UnknownDossierError } from "./runner";
import type { DossierStatus } from "./stages";

/**
 * The sweep (spec 21 §6.2, Ruling AM): a token-gated request — made every 30 minutes by a GitHub
 * Actions schedule, and by the live smoke — that drives every dossier whose frontier stage is due
 * with the foreground loop, oldest first. Each dossier gets a 90 s slice to start rounds in, so one
 * long debate cannot starve the others, and a dossier is started only while a full round (100 s
 * after the margin) still fits. This module is the pure part: the token check and the order of work.
 */

export const SWEEP_LIMIT = 25;
/** How long the sweep keeps starting rounds for one dossier. */
export const SWEEP_SLICE_MS = 90_000;
/** A shorter token is treated as not configured: it could be guessed. */
export const MIN_SWEEP_TOKEN = 32;
const SWEEP_TOKEN = "BASTION_SWEEP_TOKEN";

/** The configured token, trimmed; null when unset, blank or too short (the route answers 503). */
export function sweepTokenFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string | null {
  const value = (env[SWEEP_TOKEN] ?? "").trim();
  return value.length < MIN_SWEEP_TOKEN ? null : value;
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

/**
 * Exactly `Bearer <token>` (the scheme in any case, one space), compared in constant time: both
 * sides are hashed first, so neither the token's length nor its prefix leaks through timing.
 */
export function isSweepAuthorized(header: string | null, expected: string): boolean {
  if (header === null || expected === "") return false;
  const match = /^Bearer (\S+)$/i.exec(header);
  if (match === null) return false;
  return timingSafeEqual(digest(match[1] ?? ""), digest(expected));
}

export type Swept = {
  dossierId: string;
  stages: DrivenStage[];
  /** The dossier's status after the drive; null when it could not be driven. */
  dossier: DossierStatus | null;
  stopped: StopReason | "gone" | "error";
};

export type SweepDeps = {
  due: (now: Date, limit: number) => Promise<string[]>;
  drive: (dossierId: string, window: Required<DriveWindow>) => Promise<DriveResult>;
  now: () => number;
  /** When the sweep's own request runs out (epoch ms). */
  deadlineMs: number;
};

export async function sweepDue(deps: SweepDeps): Promise<Swept[]> {
  const ids = await deps.due(new Date(deps.now()), SWEEP_LIMIT);
  const swept: Swept[] = [];
  for (const dossierId of ids) {
    const now = deps.now();
    // Start a dossier only while a full round still fits before the sweep's own end.
    if (deps.deadlineMs - now - DRIVE_MARGIN_MS < MIN_ROUND_MS) break;
    try {
      const result = await deps.drive(dossierId, {
        deadlineMs: deps.deadlineMs,
        startBeforeMs: Math.min(deps.deadlineMs, now + SWEEP_SLICE_MS),
      });
      swept.push({
        dossierId,
        stages: result.stages,
        dossier: result.last?.dossier ?? null,
        stopped: result.stopped,
      });
    } catch (err) {
      if (err instanceof UnknownDossierError) {
        // Deleted since it was selected: nothing to drive.
        swept.push({ dossierId, stages: [], dossier: null, stopped: "gone" });
        continue;
      }
      // One broken dossier must not stop the others; the summary carries only its code.
      console.error("sweep: driving a dossier failed", { dossierId, err });
      swept.push({ dossierId, stages: [], dossier: null, stopped: "error" });
    }
  }
  return swept;
}
