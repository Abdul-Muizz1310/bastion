import { paperTrail } from "@/capabilities/paper-trail";
import { SITE } from "@/lib/site/config";
import { callCapability } from "@/platform/gateway/call";
import { listSealed, type SealedEvidence } from "../evidence";
import { recordTranscript } from "../receipts";
import { POLL_MS, type StageContext, type StageHandler } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `debate` (spec 21 §6.1, §6.3): start one paper-trail debate over the claim and the sealed
 * evidence, poll it, and keep its signed transcript. A debate spends LLM budget, so the id is the
 * stage's output from the first run: every later poll, and every retry after an error (the runner
 * keeps the previous output), continues that debate and never starts another. The verdict and
 * confidence come only from a transcript that parsed.
 */

export const ROUNDS = { rapid: 1, standard: 2, adversarial: 3 } as const;

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

function storedDebateId(ctx: StageContext): string | null {
  const out = ctx.outputs.debate;
  if (typeof out === "object" && out !== null && !Array.isArray(out)) {
    const id = out.debateId;
    if (typeof id === "string" && id !== "") return id;
  }
  return null;
}

/** paper-trail needs a url and a title on every pooled item; fall back to our own page for the item. */
function poolItem(siteUrl: string, dossierId: string, e: SealedEvidence) {
  return {
    certificate_id: e.certificateId,
    url: e.url.trim() === "" ? `${siteUrl}/d/${dossierId}#e-${e.evidenceId}` : e.url,
    title: e.title.trim() === "" ? e.certificateId : e.title,
    text: e.text,
  };
}

export function debateStage(deps: DebateDeps, siteUrl: string): StageHandler {
  const waiting = (debateId: string) =>
    ({ kind: "waiting", output: { debateId }, retryInMs: POLL_MS }) as const;

  return async (ctx) => {
    const known = storedDebateId(ctx);
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
        return { kind: "error", error: `debate_failed: ${known}`, retryable: false };
      case "done":
        break;
    }

    const fetched = await deps.transcript(ctx, known);
    if (!fetched.ok) return failure("paper-trail.transcript", fetched);
    const t = fetched.data;
    await deps.record(ctx.dossier.id, {
      debateId: known,
      transcriptHash: t.transcript_hash,
      signature: t.signature,
      payload: t,
      verdict: t.verdict,
      confidence: t.confidence,
    });
    return {
      kind: "ok",
      output: { debateId: known, verdict: t.verdict, confidence: t.confidence },
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
