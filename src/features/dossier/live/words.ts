import { clock } from "../timeline-view";
import type { LiveState } from "./model";
import { frontier } from "./nudge";
import type { AdvanceOutcome } from "./nudger";

/**
 * What the live island says about its stream and its nudges (spec 21 §6.6), in words. Pure. A
 * paused stream (a hidden tab) and one that stopped trying are said, never left silent; only the
 * latter offers a reload.
 */

export function connectionWords(s: LiveState): { text: string; reload: boolean } {
  if (s.finished) {
    if (s.status === "failed") {
      const at = frontier(s.steps);
      return {
        text:
          at === null
            ? "the run stopped."
            : `the run stopped at ${at.stage}: retry it from that stage below.`,
        reload: false,
      };
    }
    return { text: "the run finished — loading its receipt…", reload: false };
  }
  switch (s.connection) {
    case "connecting":
      return { text: "connecting to the live run…", reload: false };
    case "open":
      return { text: "following the live run: each stage updates as it moves.", reload: false };
    case "reconnecting":
      return { text: "reconnecting to the live run…", reload: false };
    case "paused":
      return {
        text: "paused while this tab is hidden — it picks up again when you come back. The run goes on without it.",
        reload: false,
      };
    case "failed":
      return {
        text: "stopped following: bastion’s stream did not open five times in a row. The run goes on; reload to follow it again.",
        reload: true,
      };
    case "closed":
      return { text: "not following the run.", reload: false };
  }
}

export function nudgeWords(outcome: AdvanceOutcome, at: number): string {
  const when = clock(new Date(at).toISOString());
  switch (outcome.kind) {
    case "ok":
      return `This page nudged the runner at ${when}: the stage it shows was due.`;
    case "rate_limited":
      return `The runner told this page to wait ${outcome.retryAfterS} s before nudging again (${when}).`;
    case "gone":
      return "bastion no longer knows this dossier.";
    case "failed":
      return `Nudging the runner did not work at ${when} (${outcome.detail}); this page tries again shortly.`;
  }
}
