import { min, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

/**
 * Time travel (spec 07, amended by spec 21 §3.2): every entity the append-only log holds —
 * dossiers, capabilities (one per gateway capability: its latest call), v1's types — as its latest
 * event at or before T, reconstructed with one DISTINCT ON query and no snapshot table. Read-only.
 *
 * It reads the columns the page shows and the metadata its known fields come from; never `before`
 * or `after`, which could carry what a downstream answered. The view decides what leaves the server.
 */

export const REPLAY_LIMIT = 1000;

export type TimeTravelOptions = {
  asOf: Date;
  service?: string;
};

export type TimeTravelEntity = {
  entityType: string;
  entityId: string;
  service: string | null;
  lastAction: string;
  lastEventAt: Date;
  requestId: string | null;
  actor: string | null;
  actorId: string | null;
  metadata: unknown;
};

export type TimeTravelResult = {
  entities: TimeTravelEntity[];
  bounds: {
    min: Date | null;
    max: Date;
  };
  /** True when more than REPLAY_LIMIT entities existed at T; the first REPLAY_LIMIT are kept. */
  truncated: boolean;
  message?: string;
};

/** One row as the driver returns it — parsed, never cast. */
const replayRow = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  service: z.string().nullable(),
  action: z.string(),
  created_at: z
    .union([z.date(), z.string()])
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), "created_at is not a time"),
  request_id: z.string().nullable(),
  actor: z.string().nullable(),
  actor_id: z.string().nullable(),
  metadata: z.unknown(),
});

export async function getTimeTravelState(options: TimeTravelOptions): Promise<TimeTravelResult> {
  const db = getDb();

  const [bounds] = await db.select({ earliest: min(events.createdAt) }).from(events);
  const earliest = bounds?.earliest ?? null;
  const range = { min: earliest, max: new Date() };

  if (!earliest) {
    return { entities: [], bounds: range, truncated: false, message: "No audit data yet." };
  }
  if (options.asOf < earliest) {
    return { entities: [], bounds: range, truncated: false, message: "No events before this time" };
  }

  // A raw `sql` template hands its parameters to the driver as they are, and drizzle's postgres-js
  // driver serialises timestamps itself — a Date here fails at runtime, so it goes in as ISO text.
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entity_type, entity_id)
      entity_type, entity_id, service, action, created_at, request_id, actor, actor_id, metadata
    FROM events
    WHERE created_at <= ${options.asOf.toISOString()}
    ${options.service ? sql`AND service = ${options.service}` : sql``}
    ORDER BY entity_type, entity_id, created_at DESC, id DESC
    LIMIT ${REPLAY_LIMIT + 1}
  `);

  const parsed = z.array(replayRow).parse(rows);
  const entities = parsed.slice(0, REPLAY_LIMIT).map((row) => ({
    entityType: row.entity_type,
    entityId: row.entity_id,
    service: row.service,
    lastAction: row.action,
    lastEventAt: row.created_at,
    requestId: row.request_id,
    actor: row.actor,
    actorId: row.actor_id,
    metadata: row.metadata,
  }));

  return { entities, bounds: range, truncated: parsed.length > REPLAY_LIMIT };
}
