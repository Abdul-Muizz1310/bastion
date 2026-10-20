import "server-only";
import { listDocuments } from "@/dossier/documents";
import { listEvidence } from "@/dossier/evidence";
import { listReceipts, type StoredReceipt } from "@/dossier/receipts";
import type { StepRow } from "@/dossier/stages";
import { findDossier, loadSteps } from "@/dossier/store";
import type { Dossier, DossierDocument, EvidenceItem } from "@/lib/db/schema";

/**
 * What `/d/[id]` reads (spec 21 §6.6): the dossier, then — in parallel — its step rows, evidence,
 * documents and receipts. An unknown or malformed id is null (the page answers 404); a database
 * error is the page's error, never a half-drawn receipt.
 */

export type DossierPageData = {
  dossier: Dossier;
  steps: StepRow[];
  evidence: EvidenceItem[];
  documents: DossierDocument[];
  receipts: StoredReceipt[];
};

export async function loadDossierPage(id: string): Promise<DossierPageData | null> {
  const dossier = await findDossier(id);
  if (dossier === null) return null;
  const [steps, evidence, documents, receipts] = await Promise.all([
    loadSteps(dossier.id),
    listEvidence(dossier.id),
    listDocuments(dossier.id),
    listReceipts(dossier.id),
  ]);
  return { dossier, steps, evidence, documents, receipts };
}
