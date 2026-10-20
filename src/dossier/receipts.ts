import { and, asc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { getDb } from "@/lib/db/client";
import { dossiers, RECEIPT_KINDS, receipts } from "@/lib/db/schema";
import type { Json } from "@/platform/canonical-json";

/**
 * The Postgres adapter for a dossier's receipts (spec 21 §6.1, §6.3): the debate's transcript
 * receipt and the verdict it yields, and the three receipts a dossier holds exactly one of — the
 * perf receipt, the envelope and the audit digest. "Retry from this stage" reuses earlier receipts
 * (spec §6.4), so a stage first looks for its stored receipt and a save never stores a second one.
 */

export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
/** The kinds a dossier has at most one of. */
export type SingletonKind = Extract<ReceiptKind, "perf" | "envelope" | "audit">;

const storedSchema = z.object({
  id: z.string(),
  kind: z.enum(RECEIPT_KINDS),
  ref: z.string().nullable(),
  hash: z.string().nullable(),
  signature: z.string().nullable(),
  payload: z.json().nullable(),
  createdAt: z.date(),
});

export type StoredReceipt = {
  id: string;
  kind: ReceiptKind;
  ref: string | null;
  hash: string | null;
  signature: string | null;
  payload: Json | null;
  createdAt: Date;
};

export type SingletonReceipt = {
  kind: SingletonKind;
  ref: string | null;
  hash: string;
  signature: string | null;
  payload: Json;
};

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function stored(row: unknown): StoredReceipt {
  return storedSchema.parse(row);
}

async function firstOf(
  db: Db | Tx,
  dossierId: string,
  kind: ReceiptKind,
  ref?: string,
): Promise<StoredReceipt | null> {
  const rows = await db
    .select()
    .from(receipts)
    .where(
      and(
        eq(receipts.dossierId, dossierId),
        eq(receipts.kind, kind),
        ref === undefined ? undefined : eq(receipts.ref, ref),
      ),
    )
    .orderBy(asc(receipts.createdAt), asc(receipts.id))
    .limit(1);
  return rows[0] === undefined ? null : stored(rows[0]);
}

/** The dossier's (first) receipt of a kind — with `ref`, only one naming that reference. */
export async function findReceipt(
  dossierId: string,
  kind: ReceiptKind,
  ref?: string,
): Promise<StoredReceipt | null> {
  return firstOf(getDb(), dossierId, kind, ref);
}

/**
 * Inside `tx`: the stored receipt of the kind, or this one inserted. The dossier row is locked
 * first, so concurrent saves for one dossier serialise and exactly one receipt is stored.
 */
async function once(tx: Tx, dossierId: string, r: SingletonReceipt): Promise<StoredReceipt> {
  const locked = await tx
    .select({ id: dossiers.id })
    .from(dossiers)
    .where(eq(dossiers.id, dossierId))
    .for("update");
  if (locked.length === 0) throw new RangeError(`saveReceipt: unknown dossier ${dossierId}`);
  const existing = await firstOf(tx, dossierId, r.kind);
  if (existing !== null) return existing;
  const [row] = await tx
    .insert(receipts)
    .values({
      dossierId,
      kind: r.kind,
      ref: r.ref,
      hash: r.hash,
      signature: r.signature,
      payload: r.payload,
    })
    .returning();
  return stored(row);
}

/** Store a perf or audit receipt unless the dossier has one; either way, return the stored one. */
export async function saveReceiptOnce(
  dossierId: string,
  r: SingletonReceipt,
): Promise<StoredReceipt> {
  return getDb().transaction((tx) => once(tx, dossierId, r));
}

export type EnvelopeReceipt = Omit<SingletonReceipt, "kind" | "ref"> & { ref: string };

/** `saveReceiptOnce` for the envelope, setting `dossiers.envelope_id` to the stored one's id. */
export async function saveEnvelopeReceipt(
  dossierId: string,
  r: EnvelopeReceipt,
): Promise<StoredReceipt> {
  return getDb().transaction(async (tx) => {
    const kept = await once(tx, dossierId, { ...r, kind: "envelope" });
    await tx
      .update(dossiers)
      .set({ envelopeId: kept.ref, updatedAt: new Date() })
      .where(eq(dossiers.id, dossierId));
    return kept;
  });
}

/* The debate's transcript receipt and the verdict it yields (spec 21 §6.1). */

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
