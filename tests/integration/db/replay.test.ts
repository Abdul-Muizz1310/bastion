import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { getTimeTravelState } from "@/lib/audit/replay";

/**
 * The time-travel replay against a real Postgres (spec 07, spec 21 §3.2): each entity is its latest
 * event at or before T (inclusive), a tie at one instant goes to the later id, and `before` /
 * `after` are never read. Commits audit events (append-only), so it runs only against a local,
 * disposable server; this run's own service name keeps other rows out of the answer.
 */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const SERVICE = `it-replay-${randomUUID().slice(0, 8)}`;
const DOSSIER = randomUUID();
const T1 = new Date("2026-10-20T09:00:00.000Z");
const T2 = new Date("2026-10-20T09:00:05.000Z");
const T3 = new Date("2026-10-20T09:00:09.000Z");

async function insert(more: Partial<typeof events.$inferInsert>) {
  await getDb()
    .insert(events)
    .values({
      actor: "bastion",
      action: "dossier.stage.ok",
      entityType: "dossier",
      entityId: DOSSIER,
      service: SERVICE,
      requestId: `${SERVICE}-req`,
      before: { leaked: "before-blob" },
      after: { leaked: "after-blob" },
      metadata: {},
      ...more,
    });
}

describe.skipIf(!LOCAL)("getTimeTravelState against Postgres", () => {
  beforeAll(async () => {
    await insert({ action: "dossier.created", createdAt: T1 });
    await insert({ metadata: { stage: "gather", attempt: 1 }, createdAt: T2 });
    await insert({ metadata: { stage: "seal", attempt: 1 }, createdAt: T3 });
    // Two events of one capability at the same instant: the later id is the latest.
    await insert({
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.scrape",
      actor: "v_kk6eooepno",
      metadata: { status: 502, ms: 40 },
      createdAt: T2,
    });
    await insert({
      action: "gateway.call",
      entityType: "capability",
      entityId: "magpie.scrape",
      actor: "v_kk6eooepno",
      metadata: { status: 200, ms: 41 },
      createdAt: T2,
    });
  });

  it("rebuilds each entity from its latest event at or before T, inclusive", async () => {
    const at = await getTimeTravelState({ asOf: T2, service: SERVICE });
    expect(at.entities.map((e) => [e.entityType, e.lastAction, e.metadata])).toEqual([
      ["capability", "gateway.call", { status: 200, ms: 41 }],
      ["dossier", "dossier.stage.ok", { stage: "gather", attempt: 1 }],
    ]);
    expect(at.truncated).toBe(false);
  });

  it("moves on as T moves on", async () => {
    const later = await getTimeTravelState({ asOf: T3, service: SERVICE });
    const dossier = later.entities.find((e) => e.entityType === "dossier");
    expect(dossier).toMatchObject({
      entityId: DOSSIER,
      lastEventAt: T3,
      requestId: `${SERVICE}-req`,
      actor: "bastion",
      actorId: null,
      metadata: { stage: "seal", attempt: 1 },
    });
  });

  it("before the entity's first event, it did not exist", async () => {
    const earlier = await getTimeTravelState({
      asOf: new Date(T1.getTime() - 1),
      service: SERVICE,
    });
    expect(earlier.entities).toEqual([]);
  });

  it("never reads before or after", async () => {
    const at = await getTimeTravelState({ asOf: T3, service: SERVICE });
    expect(JSON.stringify(at)).not.toMatch(/before-blob|after-blob/);
  });
});
