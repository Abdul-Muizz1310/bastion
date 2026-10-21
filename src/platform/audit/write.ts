import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { type EventInput, eventInputSchema } from "@/platform/audit/event";

export async function appendEvent(input: EventInput): Promise<number | null> {
  const parsed = eventInputSchema.parse(input);

  try {
    const db = getDb();
    const rows = await db
      .insert(events)
      .values({
        actor: parsed.actor,
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
