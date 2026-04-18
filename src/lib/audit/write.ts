import { and, desc, eq, gte, like, lte } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { type EventInput, eventInputSchema } from "@/lib/validation";

export type QueryEventsOptions = {
  service?: string;
  requestId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  actorId?: string;
  actionPrefix?: string;
};

export async function appendEvent(input: EventInput): Promise<number | null> {
  const parsed = eventInputSchema.parse(input);

  try {
    const db = getDb();
    const rows = await db
      .insert(events)
      .values({
        actorId: parsed.actorId,
        action: parsed.action,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
        service: parsed.service,
        requestId: parsed.requestId,
        before: parsed.before,
        after: parsed.after,
        metadata: parsed.metadata ?? {},
      })
      .returning({ id: events.id });

    return rows[0]?.id ?? null;
  } catch (err) {
    console.error("appendEvent failed:", err);
    return null;
  }
}

export async function queryEvents(options: QueryEventsOptions = {}) {
  const db = getDb();
  const conditions = [];

  if (options.service) {
    conditions.push(eq(events.service, options.service));
  }
  if (options.requestId) {
    conditions.push(eq(events.requestId, options.requestId));
  }
  if (options.from) {
    conditions.push(gte(events.createdAt, options.from));
  }
  if (options.to) {
    conditions.push(lte(events.createdAt, options.to));
  }
  if (options.actorId) {
    conditions.push(eq(events.actorId, options.actorId));
  }
  if (options.actionPrefix) {
    conditions.push(like(events.action, `${options.actionPrefix}%`));
  }

  const query = db
    .select()
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(events.createdAt))
    .limit(options.limit ?? 50)
    .offset(options.offset ?? 0);

  return query;
}
