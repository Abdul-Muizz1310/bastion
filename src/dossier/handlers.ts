import type { Stage, StageHandler } from "./stages";
import { debate } from "./stages/debate";
import { envelope } from "./stages/envelope";
import { gather } from "./stages/gather";
import { measure } from "./stages/measure";
import { read } from "./stages/read";
import { record } from "./stages/record";
import { seal } from "./stages/seal";
import { wake } from "./stages/wake";

/** The stage handlers the advance route runs (spec 21 §6.1): one per stage, in stage order. */
export const HANDLERS: Readonly<Record<Stage, StageHandler>> = {
  wake,
  gather,
  read,
  seal,
  debate,
  measure,
  envelope,
  record,
};
