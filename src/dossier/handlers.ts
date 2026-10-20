import type { Stage, StageHandler } from "./stages";
import { debate } from "./stages/debate";
import { gather } from "./stages/gather";
import { read } from "./stages/read";
import { seal } from "./stages/seal";
import { wake } from "./stages/wake";

/**
 * The stage handlers the advance route runs (spec 21 §6.1). wake, gather, read, seal and debate are real (Tasks 6-7); the rest are stubs until their task
 * lands — measure/envelope/record (Task 8) — and a
 * stub fails the dossier non-retryably rather than pretend the stage happened.
 */

const notImplemented: StageHandler = async () => ({
  kind: "error",
  error: "not_implemented",
  retryable: false,
});

export const HANDLERS: Readonly<Record<Stage, StageHandler>> = {
  wake,
  gather,
  read,
  seal,
  debate,
  measure: notImplemented,
  envelope: notImplemented,
  record: notImplemented,
};
