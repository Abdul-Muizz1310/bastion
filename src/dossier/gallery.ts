import { count, desc, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossiers, evidenceItems } from "@/lib/db/schema";

/**
 * The public gallery (spec 21 §3): the most recent dossiers with public fields only. No visitor, no
 * request id, no error text — nothing that identifies who composed a dossier or links it to audit.
 */

export type PublicDossier = {
  id: string;
  claim: string;
  mode: "rapid" | "standard" | "adversarial";
  status: "pending" | "running" | "succeeded" | "failed";
  verdict: "TRUE" | "FALSE" | "INCONCLUSIVE" | null;
  confidence: number | null;
  createdAt: string;
  evidenceCount: number;
  documentCount: number;
  products: string[];
};

export async function listPublicDossiers(limit = 12): Promise<PublicDossier[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: dossiers.id,
      claim: dossiers.claim,
      mode: dossiers.mode,
      status: dossiers.status,
      verdict: dossiers.verdict,
      confidence: dossiers.confidence,
      createdAt: dossiers.createdAt,
    })
    .from(dossiers)
    .orderBy(desc(dossiers.createdAt), desc(dossiers.id))
    .limit(limit);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const evidence = await db
    .select({
      dossierId: evidenceItems.dossierId,
      n: count(),
      products: sql<
        string[]
      >`coalesce(array_agg(distinct ${evidenceItems.product}) filter (where ${isNotNull(evidenceItems.product)}), '{}')`,
    })
    .from(evidenceItems)
    .where(inArray(evidenceItems.dossierId, ids))
    .groupBy(evidenceItems.dossierId);
  const documents = await db
    .select({ dossierId: dossierDocuments.dossierId, n: count() })
    .from(dossierDocuments)
    .where(inArray(dossierDocuments.dossierId, ids))
    .groupBy(dossierDocuments.dossierId);

  const evidenceBy = new Map(evidence.map((e) => [e.dossierId, e]));
  const documentsBy = new Map(documents.map((d) => [d.dossierId, d.n]));
  return rows.map((r) => ({
    id: r.id,
    claim: r.claim,
    mode: r.mode,
    status: r.status,
    verdict: r.verdict,
    confidence: r.confidence === null ? null : Number(r.confidence),
    createdAt: r.createdAt.toISOString(),
    evidenceCount: evidenceBy.get(r.id)?.n ?? 0,
    documentCount: documentsBy.get(r.id) ?? 0,
    products: [...(evidenceBy.get(r.id)?.products ?? [])].sort(),
  }));
}
