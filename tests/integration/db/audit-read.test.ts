import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import { readEvents } from "@/platform/audit/read";

/**
 * The audit pages' reader against a real Postgres (spec 21 §3.2): newest first by id with a cursor,
 * the filters, a literal action prefix (`_` and `%` are not wildcards), a request oldest first, and
 * never `before` / `after`. Commits audit events (append-only), so it runs only against a local,
 * disposable server; every row carries this run's own action prefix so other rows never interfere.
 */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const RUN = `it-audit-${randomUUID().slice(0, 8)}`;
const REQUEST = `${RUN}-req`;
const ids: number[] = [];

async function insert(action: string, more: Partial<typeof events.$inferInsert> = {}) {
  const [row] = await getDb()
    .insert(events)
    .values({
      actor: "bastion",
      action,
      entityType: "capability",
      entityId: "magpie.scrape",
      service: "magpie",
      requestId: REQUEST,
      before: { secret: "before-blob" },
      after: { secret: "after-blob" },
      metadata: { status: 200, ms: 5 },
      ...more,
    })
    .returning({ id: events.id });
  if (!row) throw new Error("insert returned nothing");
  ids.push(row.id);
  return row.id;
}

describe.skipIf(!LOCAL)("readEvents against Postgres", () => {
  beforeAll(async () => {
    await insert(`${RUN}.call`, { createdAt: new Date("2026-10-20T09:00:02Z") });
    await insert(`${RUN}.call`, { service: "inkprint", createdAt: new Date("2026-10-20T09:00:01Z") });
    await insert(`${RUN}_x.call`, { createdAt: new Date("2026-10-20T09:00:03Z") });
    await insert(`${RUN}.stage`, {
      service: "bastion",
      entityType: "dossier",
      requestId: `${RUN}-other`,
      createdAt: new Date("2026-10-20T09:00:00Z"),
    });
    await insert(`${RUN}%.call`, { createdAt: new Date("2026-10-20T09:00:04Z") });
  });

  it("lists newest first by id, one page at a time, without overlap or gaps", async () => {
    const first = await readEvents({ actionPrefix: RUN, limit: 2, order: "newest" });
    expect(first.map((e) => e.id)).toEqual([ids[4], ids[3]]);
    const second = await readEvents({
      actionPrefix: RUN,
      beforeId: first.at(-1)?.id,
      limit: 2,
      order: "newest",
    });
    expect(second.map((e) => e.id)).toEqual([ids[2], ids[1]]);
    const third = await readEvents({
      actionPrefix: RUN,
      beforeId: second.at(-1)?.id,
      limit: 2,
      order: "newest",
    });
    expect(third.map((e) => e.id)).toEqual([ids[0]]);
  });

  it("matches the action prefix literally: _ and % are not wildcards", async () => {
    const underscore = await readEvents({ actionPrefix: `${RUN}_`, limit: 10, order: "newest" });
    expect(underscore.map((e) => e.action)).toEqual([`${RUN}_x.call`]);
    const percent = await readEvents({ actionPrefix: `${RUN}%`, limit: 10, order: "newest" });
    expect(percent.map((e) => e.action)).toEqual([`${RUN}%.call`]);
    const dot = await readEvents({ actionPrefix: `${RUN}.`, limit: 10, order: "newest" });
    expect(dot.map((e) => e.action).sort()).toEqual([`${RUN}.call`, `${RUN}.call`, `${RUN}.stage`]);
  });

  it("filters by service and by request id", async () => {
    const inkprint = await readEvents({
      actionPrefix: RUN,
      service: "inkprint",
      limit: 10,
      order: "newest",
    });
    expect(inkprint.map((e) => e.id)).toEqual([ids[1]]);
    const other = await readEvents({ requestId: `${RUN}-other`, limit: 10, order: "newest" });
    expect(other.map((e) => e.id)).toEqual([ids[3]]);
  });

  it("reads a request oldest first by time, then id", async () => {
    const trace = await readEvents({ requestId: REQUEST, limit: 10, order: "oldest" });
    expect(trace.map((e) => e.id)).toEqual([ids[1], ids[0], ids[2], ids[4]]);
  });

  it("never reads before or after", async () => {
    const rows = await readEvents({ requestId: REQUEST, limit: 10, order: "oldest" });
    for (const row of rows) {
      expect(row).not.toHaveProperty("before");
      expect(row).not.toHaveProperty("after");
    }
    expect(JSON.stringify(rows)).not.toMatch(/before-blob|after-blob/);
  });

  it("returns the columns the views read, typed", async () => {
    const [row] = await readEvents({ requestId: `${RUN}-other`, limit: 1, order: "newest" });
    expect(row).toEqual({
      id: ids[3],
      actor: "bastion",
      actorId: null,
      action: `${RUN}.stage`,
      entityType: "dossier",
      entityId: "magpie.scrape",
      service: "bastion",
      requestId: `${RUN}-other`,
      metadata: { status: 200, ms: 5 },
      createdAt: new Date("2026-10-20T09:00:00Z"),
    });
  });
});
