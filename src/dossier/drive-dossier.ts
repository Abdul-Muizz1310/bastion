import { type ChainEventName, chainTracer, type Tracer, type TraceValue } from "./chain-trace";
import { type DriveResult, type Driver, driveLoop } from "./drive";
import { HANDLERS } from "./handlers";
import { advance } from "./runner";
import type { Stage, StageHandler } from "./stages";

/**
 * The foreground loop's shell (spec 21 §6.2): `driveLoop` over the real runner and stage handlers,
 * each round traced as `drive.stage` (who drove it, the stage, its status, ms) and the stop as
 * `drive.stop`, under the caller's invocation id. Used by the advance route (the page's nudge) and
 * by the sweep — the two drivers (Ruling AM). An unknown dossier throws `UnknownDossierError`, as `advance` does.
 */

export type DriveOptions = {
  driver: Driver;
  /** When the caller's own request runs out (epoch ms): its start + its route's maxDuration. */
  deadlineMs: number;
  /** No round starts at or after this (epoch ms): the sweep's per-dossier slice. */
  startBeforeMs?: number;
  invocation: string;
  emit?: Tracer;
  /** The stage handlers (the real ones by default; integration tests pass their own). */
  handlers?: Readonly<Record<Stage, StageHandler>>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function driveDossier(dossierId: string, options: DriveOptions): Promise<DriveResult> {
  const emit = options.emit ?? chainTracer;
  const { driver, invocation } = options;
  const note = (event: ChainEventName, fields: Record<string, TraceValue>) =>
    emit({ event, dossierId, invocation, ...fields });
  const window =
    options.startBeforeMs === undefined
      ? { deadlineMs: options.deadlineMs }
      : { deadlineMs: options.deadlineMs, startBeforeMs: options.startBeforeMs };
  const result = await driveLoop(window, {
    now: Date.now,
    sleep,
    advanceOnce: async (stageBudgetMs) => {
      const began = Date.now();
      const round = await advance(dossierId, options.handlers ?? HANDLERS, {
        stageBudgetMs,
        onTrace: (event, fields) => note(event, fields),
      });
      if (round.ran !== null && round.status !== null) {
        await note("drive.stage", {
          driver,
          stage: round.ran,
          status: round.status,
          ms: Date.now() - began,
        });
      }
      return round;
    },
  });
  await note("drive.stop", { driver, stopped: result.stopped, stages: result.stages.length });
  return result;
}
