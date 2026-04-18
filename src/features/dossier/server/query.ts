import { and, asc, desc, eq, gt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  type Dossier,
  type DossierEvent as DossierEventRow,
  dossierEvents,
  dossiers,
  type EvidenceItem,
  evidenceItems,
} from "@/lib/db/schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EVENTS_PER_CALL = 200;

function isValidUuid(id: string): boolean {
  return UUID_PATTERN.test(id);
}

export async function getDossier(id: string): Promise<Dossier | null> {
  if (!isValidUuid(id)) return null;
  const db = getDb();
  const rows = await db.select().from(dossiers).where(eq(dossiers.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listDossierEvents(
  dossierId: string,
  sinceAt?: Date,
): Promise<DossierEventRow[]> {
  if (!isValidUuid(dossierId)) return [];
  const db = getDb();
  const where = sinceAt
    ? and(eq(dossierEvents.dossierId, dossierId), gt(dossierEvents.at, sinceAt))
    : eq(dossierEvents.dossierId, dossierId);
  return db
    .select()
    .from(dossierEvents)
    .where(where)
    .orderBy(asc(dossierEvents.at))
    .limit(MAX_EVENTS_PER_CALL);
}

export async function listEvidenceItems(dossierId: string): Promise<EvidenceItem[]> {
  if (!isValidUuid(dossierId)) return [];
  const db = getDb();
  return db
    .select()
    .from(evidenceItems)
    .where(eq(evidenceItems.dossierId, dossierId))
    .orderBy(asc(evidenceItems.createdAt))
    .limit(MAX_EVENTS_PER_CALL);
}

/**
 * List recent dossiers, newest first. If `userId` is provided, scopes to that
 * user (for viewer role); otherwise returns all (for admin/editor).
 */
export async function listRecentDossiers(userId: string | null, limit = 10): Promise<Dossier[]> {
  const db = getDb();
  const cap = Math.min(Math.max(limit, 1), 100);
  if (userId !== null) {
    if (!isValidUuid(userId)) return [];
    return db
      .select()
      .from(dossiers)
      .where(eq(dossiers.userId, userId))
      .orderBy(desc(dossiers.createdAt))
      .limit(cap);
  }
  return db.select().from(dossiers).orderBy(desc(dossiers.createdAt)).limit(cap);
}
