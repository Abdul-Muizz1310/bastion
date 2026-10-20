import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dossiers, receipts } from "@/lib/db/schema";

/** The Postgres adapter for the debate's transcript receipt and the verdict it yields (spec 21 §6.1). */

export type TranscriptRecord = {
  debateId: string;
  transcriptHash: string;
  signature: string | null;
  /** The full `transcript.json` object: Task 9 re-verifies it. */
  payload: Record<string, unknown>;
  verdict: "TRUE" | "FALSE" | "INCONCLUSIVE";
  confidence: number;
};

export type TranscriptSaved = { ok: true } | { ok: false; error: string };

/**
 * One transaction: the `transcript` receipt (skipped when this debate's is already stored) and the
 * dossier's verdict and confidence. A replay rewrites the same verdict and adds no second receipt.
 * A transcript that names another debate than the stored id is refused before any write — a retry
 * would fetch the same answer, so the caller reports it as a non-retryable error.
 */
export async function recordTranscript(
  dossierId: string,
  t: TranscriptRecord,
): Promise<TranscriptSaved> {
  if (t.payload.debate_id !== t.debateId) {
    return {
      ok: false,
      error: `transcript_mismatch: expected ${t.debateId}, got ${String(t.payload.debate_id)}`,
    };
  }
  await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: receipts.id })
      .from(receipts)
      .where(
        and(
          eq(receipts.dossierId, dossierId),
          eq(receipts.kind, "transcript"),
          eq(receipts.ref, t.debateId),
        ),
      )
      .limit(1);
    if (!existing) {
      await tx.insert(receipts).values({
        dossierId,
        kind: "transcript",
        ref: t.debateId,
        hash: t.transcriptHash,
        signature: t.signature,
        payload: t.payload,
      });
    }
    await tx
      .update(dossiers)
      .set({ verdict: t.verdict, confidence: t.confidence.toFixed(2), updatedAt: new Date() })
      .where(eq(dossiers.id, dossierId));
  });
  return { ok: true };
}
