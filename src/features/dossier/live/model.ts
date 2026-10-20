import { onePerStage, type StepView, sortByStage } from "../step-view";
import type { DossierStatus, StreamEvent, Verdict } from "./events";

/**
 * The live island's state (spec 21 §6.6, "The live run"), folded from the stream's events. Pure.
 * The steps stay one per stage in stage order; a dossier that predates the step machine has none.
 */

export type Connection = "connecting" | "open" | "reconnecting" | "paused" | "failed" | "closed";

export type LiveState = {
  steps: readonly StepView[];
  status: DossierStatus;
  verdict: Verdict | null;
  confidence: number | null;
  connection: Connection;
  /** The stream said done (or the dossier was already finished): nothing more will arrive. */
  finished: boolean;
};

export type LiveInitial = {
  status: DossierStatus;
  verdict: Verdict | null;
  confidence: number | null;
  steps: readonly StepView[];
};

export type LiveAction =
  | { type: "event"; event: StreamEvent }
  | { type: "connection"; state: "open" | "reconnecting" | "paused" | "failed" };

const terminal = (status: DossierStatus) => status === "succeeded" || status === "failed";

function inStageOrder(steps: readonly StepView[]): StepView[] {
  if (steps.length === 0) return [];
  if (!onePerStage(steps)) {
    throw new RangeError("live dossier: the steps must be exactly one per stage");
  }
  return sortByStage(steps);
}

export function initialLive(initial: LiveInitial): LiveState {
  const finished = terminal(initial.status);
  return {
    steps: inStageOrder(initial.steps),
    status: initial.status,
    verdict: initial.verdict,
    confidence: initial.confidence,
    connection: finished ? "closed" : "connecting",
    finished,
  };
}

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  if (action.type === "connection") {
    return state.finished ? state : { ...state, connection: action.state };
  }
  const event = action.event;
  switch (event.type) {
    case "step":
      return {
        ...state,
        steps: state.steps.map((s) => (s.stage === event.step.stage ? event.step : s)),
      };
    case "status":
      return {
        ...state,
        status: event.status.status,
        verdict: event.status.verdict,
        confidence: event.status.confidence,
      };
    case "done":
      return {
        ...state,
        status: event.done.status,
        verdict: event.done.verdict,
        confidence: event.done.confidence,
        finished: true,
        connection: "closed",
      };
    case "ended":
      return { ...state, finished: true, connection: "closed" };
    case "timeout":
      return state.finished ? state : { ...state, connection: "reconnecting" };
    case "heartbeat":
      return state;
  }
}
