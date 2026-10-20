import type { Stage, StageHandler } from "./stages";

/**
 * The stage handlers the advance route runs (spec 21 §6.1). Every stage is a stub until its task
 * lands — wake/gather/read (Task 6), seal/debate (Task 7), measure/envelope/record (Task 8) — and a
 * stub fails the dossier non-retryably rather than pretend the stage happened.
 */

const notImplemented: StageHandler = async () => ({
  kind: "error",
  error: "not_implemented",
  retryable: false,
});

export const HANDLERS: Readonly<Record<Stage, StageHandler>> = {
  wake: notImplemented,
  gather: notImplemented,
  read: notImplemented,
  seal: notImplemented,
  debate: notImplemented,
  measure: notImplemented,
  envelope: notImplemented,
  record: notImplemented,
};
