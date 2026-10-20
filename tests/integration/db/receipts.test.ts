import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { findReceipt, saveEnvelopeReceipt, saveReceiptOnce } from "@/dossier/receipts";
import { getDb } from "@/lib/db/client";
import { dossiers, receipts } from "@/lib/db/schema";
import { appendEvent } from "@/platform/audit/write";
import { requestEvents } from "@/platform/audit/request-events";

/**
 * The receipts adapter and the audit-log reader against a real Postgres (spec 21 §6.3, §6.5): a
 * perf, envelope or audit receipt is stored once per dossier however often (or concurrently) a
 * stage saves it, and a request's events come back ordered and bounded. Commits audit events
 * (append-only), so it runs only against a local, disposable server.
 */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const created: string[] = [];

async function newDossier(): Promise<{ id: string; requestId: string }> {
  const id = randomUUID();
  const requestId = `it-receipts-${id}`;
  created.push(id);
  await getDb().insert(dossiers).values({
    id,
    visitor: "v_kk6eooepno",
    claim: "receipts adapter",
    sources: [],
    mode: "rapid",
    status: "running",
    requestId,
  });
  return { id, requestId };
}

afterAll(async () => {
  if (!LOCAL) return;
  for (const id of created) await getDb().delete(dossiers).where(eq(dossiers.id, id));
});

describe.skipIf(!LOCAL)("receipts against Postgres", () => {
  it("finds nothing, then the stored receipt, filtered by kind and ref", async () => {
    const { id } = await newDossier();
    expect(await findReceipt(id, "perf")).toBeNull();
    await getDb()
      .insert(receipts)
      .values([
        {
          dossierId: id,
          kind: "transcript",
          ref: "debate-1",
          hash: "a".repeat(64),
          signature: "s1",
          payload: { x: 1 },
        },
        {
          dossierId: id,
          kind: "transcript",
          ref: "debate-2",
          hash: "b".repeat(64),
          signature: null,
          payload: null,
        },
      ]);
    expect(await findReceipt(id, "transcript", "debate-2")).toMatchObject({
      kind: "transcript",
      ref: "debate-2",
      hash: "b".repeat(64),
      signature: null,
      payload: null,
    });
    expect(await findReceipt(id, "transcript", "debate-3")).toBeNull();
    expect(await findReceipt(randomUUID(), "transcript")).toBeNull();
  });

  it("stores a singleton receipt once: a second save returns the first", async () => {
    const { id } = await newDossier();
    const first = await saveReceiptOnce(id, {
      kind: "perf",
      ref: null,
      hash: "1".repeat(64),
      signature: null,
      payload: { services: [{ service: "magpie", queries: [], error: "404" }], n: 412.7 },
    });
    expect(first).toMatchObject({ kind: "perf", hash: "1".repeat(64), payload: { n: 412.7 } });
    const second = await saveReceiptOnce(id, {
      kind: "perf",
      ref: null,
      hash: "2".repeat(64),
      signature: null,
      payload: {},
    });
    expect(second).toEqual(first);
    const rows = await getDb().select().from(receipts).where(eq(receipts.dossierId, id));
    expect(rows).toHaveLength(1);
    expect(await findReceipt(id, "perf")).toEqual(first);
  });

  it("stores exactly one receipt when five saves race", async () => {
    const { id } = await newDossier();
    // Open the pool's connections first: lazily opened ones stagger the saves and hide the race.
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => getDb().execute(sql`select pg_sleep(0.05)`)));
    const saved = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        saveReceiptOnce(id, {
          kind: "audit",
          ref: "r",
          hash: String(n).repeat(64),
          signature: null,
          payload: { n },
        }),
      ),
    );
    expect(new Set(saved.map((r) => r.id)).size).toBe(1);
    const rows = await getDb().select().from(receipts).where(eq(receipts.dossierId, id));
    expect(rows).toHaveLength(1);
  });

  it("an envelope receipt also sets dossiers.envelope_id, once", async () => {
    const { id } = await newDossier();
    const envelopeId = randomUUID();
    const first = await saveEnvelopeReceipt(id, {
      ref: envelopeId,
      hash: "e".repeat(64),
      signature: "sig",
      payload: { envelope_id: envelopeId },
    });
    expect(first).toMatchObject({ kind: "envelope", ref: envelopeId, signature: "sig" });
    const again = await saveEnvelopeReceipt(id, {
      ref: randomUUID(),
      hash: "f".repeat(64),
      signature: "other",
      payload: {},
    });
    expect(again).toEqual(first);
    const [d] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(d?.envelopeId).toBe(envelopeId);
    expect(await getDb().select().from(receipts).where(eq(receipts.dossierId, id))).toHaveLength(1);
  });

  it("refuses an unknown dossier", async () => {
    await expect(
      saveReceiptOnce(randomUUID(), {
        kind: "perf",
        ref: null,
        hash: "1".repeat(64),
        signature: null,
        payload: {},
      }),
    ).rejects.toThrow(/unknown dossier/);
  });

  it("reads a request's events in id order, bounded inclusively", async () => {
    const { id, requestId } = await newDossier();
    const ids: number[] = [];
    for (const [action, service] of [
      ["gateway.call", "magpie"],
      ["gateway.call", "paper-trail"],
      ["dossier.stage.ok", "bastion"],
    ] as const) {
      const eventId = await appendEvent({
        actor: "bastion",
        action,
        entityType: "dossier",
        entityId: id,
        service,
        requestId,
      });
      if (eventId === null) throw new Error("append failed");
      ids.push(eventId);
    }
    await appendEvent({
      actor: "bastion",
      action: "other",
      entityType: "dossier",
      entityId: id,
      requestId: `${requestId}-x`,
    });

    const all = await requestEvents(requestId);
    expect(all.map((e) => e.id)).toEqual(ids);
    expect(all.map((e) => [e.action, e.service])).toEqual([
      ["gateway.call", "magpie"],
      ["gateway.call", "paper-trail"],
      ["dossier.stage.ok", "bastion"],
    ]);
    expect(all[0]?.createdAt).toBeInstanceOf(Date);
    expect((await requestEvents(requestId, ids[1])).map((e) => e.id)).toEqual(ids.slice(0, 2));
    expect(await requestEvents(requestId, 0)).toEqual([]);
    expect(await requestEvents(`it-receipts-none-${randomUUID()}`)).toEqual([]);
  });
});
