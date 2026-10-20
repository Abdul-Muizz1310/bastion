import type { Stage, StageHandler } from "./stages";
import { gather } from "./stages/gather";
import { read } from "./stages/read";
import { wake } from "./stages/wake";

/**
 * The stage handlers the advance route runs (spec 21 §6.1). wake, gather and read are real (Task 6); the rest are stubs until their task
 * lands — seal/debate (Task 7), measure/envelope/record (Task 8) — and a
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
  seal: notImplemented,
  debate: notImplemented,
  measure: notImplemented,
  envelope: notImplemented,
  record: notImplemented,
};
