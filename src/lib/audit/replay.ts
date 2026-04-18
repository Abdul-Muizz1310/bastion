import { eq, lte, min, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";

export type TimeTravelOptions = {
  asOf: Date;
  service?: string;
};

export type TimeTravelEntity = {
  entityType: string;
  entityId: string;
  service: string | null;
  state: unknown;
  lastAction: string;
  lastEventAt: Date;
};

export type TimeTravelResult = {
  entities: TimeTravelEntity[];
  bounds: {
    min: Date | null;
    max: Date;
  };
  message?: string;
};

export async function getTimeTravelState(options: TimeTravelOptions): Promise<TimeTravelResult> {
  const db = getDb();

  // Get bounds
  const boundsResult = await db.select({ earliest: min(events.createdAt) }).from(events);

  const earliest = boundsResult[0]?.earliest ?? null;
  const bounds = { min: earliest, max: new Date() };

  if (!earliest) {
    return {
      entities: [],
      bounds,
      message: "No audit data yet.",
    };
  }

  if (options.asOf < earliest) {
    return {
      entities: [],
      bounds,
      message: "No events before this time",
    };
  }

  // DISTINCT ON query to get latest event per entity up to asOf
  const conditions = [lte(events.createdAt, options.asOf)];
  if (options.service) {
    conditions.push(eq(events.service, options.service));
  }

  const rows = await db.execute(sql`
    SELECT DISTINCT ON (entity_type, entity_id)
      entity_type, entity_id, service, "after" as state, action, created_at
    FROM events
    WHERE created_at <= ${options.asOf}
    ${options.service ? sql`AND service = ${options.service}` : sql``}
    ORDER BY entity_type, entity_id, created_at DESC
    LIMIT 1000
  `);

  const rowData = rows as unknown as Record<string, unknown>[];
  const entities: TimeTravelEntity[] = rowData.map((row: Record<string, unknown>) => ({
    entityType: row.entity_type as string,
    entityId: row.entity_id as string,
    service: row.service as string | null,
    state: row.state,
    lastAction: row.action as string,
    lastEventAt: new Date(row.created_at as string),
  }));

  return { entities, bounds };
}
