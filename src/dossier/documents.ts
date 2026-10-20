import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { type DossierDocument, dossierDocuments } from "@/lib/db/schema";

/** The Postgres adapter for a dossier's inkthread documents (spec 21 §6.3). */

export async function listDocuments(dossierId: string): Promise<DossierDocument[]> {
  const rows = await getDb()
    .select()
    .from(dossierDocuments)
    .where(eq(dossierDocuments.dossierId, dossierId));
  // A stable order, so the candidate keys derived from it are too.
  return rows.sort((a, b) =>
    a.documentId < b.documentId ? -1 : a.documentId > b.documentId ? 1 : 0,
  );
}

export type DocumentFacts = { sha256: string; graphHash: string; pageCount: number };

export async function saveDocumentFacts(
  dossierId: string,
  documentId: string,
  facts: DocumentFacts,
): Promise<void> {
  await getDb()
    .update(dossierDocuments)
    .set(facts)
    .where(
      and(eq(dossierDocuments.dossierId, dossierId), eq(dossierDocuments.documentId, documentId)),
    );
}
