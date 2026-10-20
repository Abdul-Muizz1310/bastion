import { paperTrail } from "@/capabilities/paper-trail";
import { SITE } from "@/lib/site/config";
import { callCapability } from "@/platform/gateway/call";
import { listSealed, type SealedEvidence } from "../evidence";
import { ROUNDS } from "../limits";
import { recordTranscript } from "../receipts";
import { POLL_MS, type StageContext, type StageHandler, type StageOutcome } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `debate` (spec 21 §6.1, §6.3): start one paper-trail debate over the claim and the sealed
 * evidence, poll it, and keep its signed transcript. A debate spends LLM budget, so the id is the
 * stage's output from the first run: every later poll, and every retry after an error (the runner
 * keeps the previous output), continues that debate and never starts another — except after the
 * debate itself ended in `error` (Ruling T), or its transcript names another debate
 * (`transcript_mismatch`): either outcome moves the id into `failedDebateIds`, so "retry from this
 * stage" starts a new debate. The verdict and confidence come only from a transcript that parsed
 * and belongs to the stored debate.
 */

export { ROUNDS };

export type DebateDeps = {
  start: typeof callStart;
  get: typeof callGet;
  transcript: typeof callTranscript;
  sealed: typeof listSealed;
  record: typeof recordTranscript;
};

function callStart(ctx: StageContext, input: Parameters<typeof paperTrail.debate.input.parse>[0]) {
  return callCapability(paperTrail.debate, input, callContext(ctx));
}
function callGet(ctx: StageContext, id: string) {
  return callCapability(paperTrail.debateGet, { id }, callContext(ctx));
}
function callTranscript(ctx: StageContext, id: string) {
  return callCapability(paperTrail.transcript, { id }, callContext(ctx));
}

/** What the stage stores: the debate it follows (if any) and the debates that failed before it. */
type Stored = { debateId: string | null; failedDebateIds: string[] };

function stored(ctx: StageContext): Stored {
  const out = ctx.outputs.debate;
  if (typeof out !== "object" || out === null || Array.isArray(out)) {
    return { debateId: null, failedDebateIds: [] };
  }
  const id = out.debateId;
  const failed = out.failedDebateIds;
  return {
    debateId: typeof id === "string" && id !== "" ? id : null,
    failedDebateIds: Array.isArray(failed)
      ? failed.filter((f): f is string => typeof f === "string")
      : [],
  };
}

/**
 * paper-trail needs a url and a title on every pooled item; fall back to the item's anchor on our
 * own page (`#e-<key>`, the same anchor read gives document items).
 */
function poolItem(siteUrl: string, dossierId: string, e: SealedEvidence) {
  return {
    certificate_id: e.certificateId,
    url: e.url.trim() === "" ? `${siteUrl}/d/${dossierId}#e-${e.key}` : e.url,
    title: e.title.trim() === "" ? e.certificateId : e.title,
    text: e.text,
  };
}

export function debateStage(deps: DebateDeps, siteUrl: string): StageHandler {
  return async (ctx): Promise<StageOutcome> => {
    const { debateId: known, failedDebateIds } = stored(ctx);
    const waiting = (debateId: string): StageOutcome => ({
      kind: "waiting",
      output: { debateId, failedDebateIds },
      retryInMs: POLL_MS,
    });
    /** Ruling T: a terminal failure of this debate drops its id, so a retry starts a new one. */
    const abandon = (debateId: string, error: string): StageOutcome => ({
      kind: "error",
      error,
      retryable: false,
      output: { failedDebateIds: [...failedDebateIds, debateId] },
    });
    if (known === null) {
      const pool = (await deps.sealed(ctx.dossier.id)).map((e) =>
        poolItem(siteUrl, ctx.dossier.id, e),
      );
      const started = await deps.start(ctx, {
        claim: ctx.dossier.claim,
        max_rounds: ROUNDS[ctx.dossier.mode],
        ...(pool.length > 0 ? { evidence_pool: pool } : {}),
      });
      if (!started.ok) return failure("paper-trail.debate", started);
      return waiting(started.data.debate_id);
    }

    const got = await deps.get(ctx, known);
    if (!got.ok) return failure("paper-trail.debateGet", got);
    switch (got.data.status) {
      case "pending":
      case "running":
        return waiting(known);
      case "error":
        return abandon(known, `debate_failed: ${known}`);
      case "done":
        break;
    }

    const fetched = await deps.transcript(ctx, known);
    if (!fetched.ok) return failure("paper-trail.transcript", fetched);
    const t = fetched.data;
    const saved = await deps.record(ctx.dossier.id, {
      debateId: known,
      transcriptHash: t.transcript_hash,
      signature: t.signature,
      payload: t,
      verdict: t.verdict,
      confidence: t.confidence,
    });
    // The transcript names another debate: fetching it again would too, so the id goes as well.
    if (!saved.ok) return abandon(known, saved.error);
    return {
      kind: "ok",
      output: { debateId: known, verdict: t.verdict, confidence: t.confidence, failedDebateIds },
    };
  };
}

export const debate: StageHandler = debateStage(
  {
    start: callStart,
    get: callGet,
    transcript: callTranscript,
    sealed: listSealed,
    record: recordTranscript,
  },
  SITE.url,
);
