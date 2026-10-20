import type { StoredEvent } from "@/platform/audit/read";
import { type ActorDisplay, actorDisplay } from "./actor";
import { type KnownFields, knownFields } from "./known-fields";

/**
 * What one event shows on the public audit pages (spec 21 §3.2): its identity, the actor's
 * pseudonym, the entity (a dossier links to its page) and the known fields — never the metadata
 * (invariant 6). And how a read of `size + 1` rows becomes one page and its cursor (invariant 4).
 * Pure.
 */

export type EntityView = { type: string; id: string; href: string | null };

export type AuditEventView = {
  id: number;
  at: Date;
  actor: ActorDisplay;
  action: string;
  service: string | null;
  entity: EntityView;
  requestId: string | null;
  facts: KnownFields;
};

export type AuditPage = {
  events: AuditEventView[];
  /** The cursor for the next older page (the smallest id shown), or null when nothing is older. */
  older: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A dossier entity links to its public page; nothing else has one. */
export function entityHref(type: string, id: string): string | null {
  return type === "dossier" && UUID.test(id) ? `/d/${id}` : null;
}

export function eventView(row: StoredEvent): AuditEventView {
  return {
    id: row.id,
    at: row.createdAt,
    actor: actorDisplay(row),
    action: row.action,
    service: row.service,
    entity: {
      type: row.entityType,
      id: row.entityId,
      href: entityHref(row.entityType, row.entityId),
    },
    requestId: row.requestId,
    facts: knownFields(row.metadata),
  };
}

/** `rows` is a read of up to `size + 1` events, newest first; the extra row only says "older". */
export function pageOf(rows: readonly AuditEventView[], size: number): AuditPage {
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new RangeError(`pageOf: size must be a positive whole number, not ${size}`);
  }
  if (rows.length > size + 1) {
    throw new RangeError(`pageOf: read ${rows.length} rows for a page of ${size}`);
  }
  for (let i = 1; i < rows.length; i += 1) {
    if ((rows[i]?.id ?? 0) >= (rows[i - 1]?.id ?? 0)) {
      throw new RangeError("pageOf: rows must be newest first by id");
    }
  }
  const events = rows.slice(0, size);
  const older = rows.length > size ? (events.at(-1)?.id ?? null) : null;
  return { events, older };
}
