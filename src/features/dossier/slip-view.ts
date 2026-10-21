import type { ReceiptTone } from "@/components/receipts/ReceiptCard";
import type { DossierStatus, Verdict } from "./live/events";
import type { LiveState } from "./live/model";

/**
 * The verdict slip beside the claim (spec 21 §6.6, "The live card"), as a view. Pure. The server
 * hands its facts; while the live island follows a run its state wins for the status, the stamp
 * and the confidence, and the counts the stream does not carry read as what will fill them ("after
 * seal", seal's own "certified N of M") — never as stale zeros. A finished or failed dossier shows
 * the server's counts: the page was rendered from them.
 */

export type SlipFacts = {
  id: string;
  status: DossierStatus;
  verdict: Verdict | null;
  confidence: number | null;
  evidence: { items: number; certified: number };
  documents: number;
  envelopeId: string | null;
  mode: string;
};

export type SlipView = {
  stamp: { text: string; tone: ReceiptTone } | null;
  /** Why there is no stamp yet, when there is none. */
  noVerdict: string | null;
  lines: [string, string][];
  /** The page holds "verify everything" (a finished or failed render). */
  verifyLink: boolean;
};

const TONE: Readonly<Record<Verdict, ReceiptTone>> = {
  TRUE: "pass",
  FALSE: "fail",
  INCONCLUSIVE: "neutral",
};

const STATUS_WORDS: Readonly<Record<DossierStatus, string>> = {
  pending: "queued",
  running: "running",
  succeeded: "sealed",
  failed: "stopped",
};

const finished = (s: DossierStatus) => s === "succeeded" || s === "failed";

function stageState(
  live: LiveState,
  stage: "seal" | "envelope",
): { status: string; note: string | null } | null {
  const step = live.steps.find((s) => s.stage === stage);
  return step === undefined ? null : { status: step.status, note: step.note };
}

export function slipView(facts: SlipFacts, live: LiveState | null): SlipView {
  const status = live?.status ?? facts.status;
  const verdict = live === null ? facts.verdict : live.verdict;
  const confidence = live === null ? facts.confidence : live.confidence;
  // The server's counts hold for the page it rendered; a run it rendered unfinished is the stream's.
  const fromServer = live === null || finished(facts.status);

  let evidence = `${facts.evidence.items} items · ${facts.evidence.certified} certified`;
  let envelope = facts.envelopeId === null ? "not sealed" : facts.envelopeId.slice(0, 8);
  if (!fromServer) {
    const seal = stageState(live, "seal");
    evidence =
      (seal?.status === "ok" || seal?.status === "skipped") && seal.note !== null
        ? seal.note
        : "after seal";
    const env = stageState(live, "envelope");
    envelope =
      (env?.status === "ok" || env?.status === "skipped") && env.note !== null
        ? env.note
        : "after the run";
  }

  return {
    stamp: verdict === null ? null : { text: verdict.toLowerCase(), tone: TONE[verdict] },
    noVerdict:
      verdict !== null
        ? null
        : status === "failed"
          ? "no verdict: the run stopped before the debate finished."
          : "no verdict yet: the debate has not finished.",
    lines: [
      ["status", STATUS_WORDS[status]],
      ["confidence", confidence === null ? "—" : `${Math.round(confidence * 100)} %`],
      ["evidence", evidence],
      ["documents", facts.documents === 0 ? "none" : `${facts.documents} PDF`],
      ["envelope", envelope],
      ["mode", facts.mode],
    ],
    verifyLink: finished(facts.status),
  };
}
