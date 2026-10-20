import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { type EvidenceItem, evidenceItems, receipts } from "@/lib/db/schema";
import type { Candidate } from "./select-evidence";

/**
 * The Postgres adapter for sealed evidence (spec 21 §6.1, §6.3). One `evidence_items` row per
 * certified candidate (unique per dossier on `stable_id`, the candidate key) and one `certificate`
 * receipt beside it. The receipt keeps the full certified text in `payload.text`: the verify step
 * hands it back to inkprint, and the evidence row keeps only a 400-character excerpt.
 */

export const EXCERPT_CHARS = 400;

export type SealedRecord = {
  candidate: Candidate;
  certificateId: string;
  /** Ruling S: the source's own hash (magpie's content hash; sha256 of a document item's text). */
  contentHash: string;
  /** inkprint's sha256 of the certified text (the certificate fingerprint). */
  inkprintHash: string;
  signature: string | null;
  /** The exact text inkprint certified. */
  text: string;
};

export async function listEvidence(dossierId: string): Promise<EvidenceItem[]> {
  return getDb()
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.dossierId, dossierId))
    .orderBy(asc(evidenceItems.stableId));
}

/**
 * Persists records and their receipts in one transaction. A record whose candidate key is already
 * stored is left alone (no second row, no second receipt), so a replay cannot duplicate anything.
 * Two records with one key are refused before any write: the row would keep one certificate and
 * the receipt could name the other. Returns how many were new.
 */
export async function saveSealed(
  dossierId: string,
  records: readonly SealedRecord[],
): Promise<number> {
  if (records.length === 0) return 0;
  const byKey = new Map(records.map((r) => [r.candidate.key, r]));
  if (byKey.size !== records.length) {
    throw new RangeError("saveSealed: two records share a candidate key");
  }
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(evidenceItems)
      .values(
        records.map((r) => ({
          dossierId,
          source: r.candidate.product,
          stableId: r.candidate.key,
          url: r.candidate.url,
          title: r.candidate.title,
          certificateId: r.certificateId,
          contentHash: r.contentHash,
          kind: r.candidate.kind,
          product: r.candidate.product,
          locator: r.candidate.locator,
          excerpt: r.candidate.text.slice(0, EXCERPT_CHARS),
          inkprintHash: r.inkprintHash,
        })),
      )
      .onConflictDoNothing({ target: [evidenceItems.dossierId, evidenceItems.stableId] })
      .returning({ stableId: evidenceItems.stableId });
    const fresh = inserted.flatMap((row) => byKey.get(row.stableId) ?? []);
    if (fresh.length > 0) {
      await tx.insert(receipts).values(
        fresh.map((r) => ({
          dossierId,
          kind: "certificate" as const,
          ref: r.certificateId,
          hash: r.inkprintHash,
          signature: r.signature,
          payload: { text: r.text, key: r.candidate.key },
        })),
      );
    }
    return fresh.length;
  });
}

export type SealedEvidence = {
  evidenceId: string;
  /** The candidate key (`stable_id`): the `#e-<key>` anchor on the dossier page. */
  key: string;
  certificateId: string;
  url: string;
  title: string;
  text: string;
};

/** The certified evidence the debate gets: row plus the full text from its certificate receipt. */
export async function listSealed(dossierId: string): Promise<SealedEvidence[]> {
  const rows = await getDb()
    .select({
      evidenceId: evidenceItems.id,
      key: evidenceItems.stableId,
      certificateId: evidenceItems.certificateId,
      url: evidenceItems.url,
      title: evidenceItems.title,
      excerpt: evidenceItems.excerpt,
      payload: receipts.payload,
    })
    .from(evidenceItems)
    .leftJoin(
      receipts,
      and(
        eq(receipts.dossierId, evidenceItems.dossierId),
        eq(receipts.kind, "certificate"),
        sql`${receipts.ref} = ${evidenceItems.certificateId}::text`,
      ),
    )
    .where(and(eq(evidenceItems.dossierId, dossierId), isNotNull(evidenceItems.certificateId)))
    .orderBy(asc(evidenceItems.stableId));
  return rows.flatMap((row) => {
    const payload = row.payload as { text?: unknown } | null;
    const text = typeof payload?.text === "string" ? payload.text : (row.excerpt ?? "");
    return row.certificateId === null
      ? []
      : [
          {
            evidenceId: row.evidenceId,
            key: row.key,
            certificateId: row.certificateId,
            url: row.url,
            title: row.title,
            text,
          },
        ];
  });
}
