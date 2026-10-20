import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The receipts adapter's own control flow (spec 21 §6.3): which statements it issues, in what
 * order, and what it does with what Postgres answers — the dossier row is locked before a singleton
 * receipt is looked up, an existing receipt is returned without an insert, the envelope id follows
 * the kept receipt, a transcript for another debate writes nothing, rows read back are parsed. That
 * the lock really serialises concurrent saves is proven against Postgres in
 * tests/integration/db/receipts.test.ts; here `getDb()` is a fake that answers from queues.
 */

type Call = {
  op: "select" | "insert" | "update";
  table?: unknown;
  values?: unknown;
  lock?: string;
};

const fake = vi.hoisted(() => ({
  selects: [] as unknown[][],
  returnings: [] as unknown[][],
  calls: [] as Call[],
  transactions: 0,
}));

vi.mock("@/lib/db/client", () => {
  const thenable = (value: () => unknown) => ({
    // biome-ignore lint/suspicious/noThenProperty: a drizzle query is awaited as a thenable.
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve().then(value).then(resolve, reject),
  });
  const db = {
    select: () => {
      const call: Call = { op: "select" };
      fake.calls.push(call);
      const query = {
        from: (table: unknown) => {
          call.table = table;
          return query;
        },
        where: () => query,
        orderBy: () => query,
        limit: () => query,
        for: (lock: string) => {
          call.lock = lock;
          return query;
        },
        ...thenable(() => fake.selects.shift() ?? []),
      };
      return query;
    },
    insert: (table: unknown) => {
      const call: Call = { op: "insert", table };
      fake.calls.push(call);
      const query = {
        values: (values: unknown) => {
          call.values = values;
          return query;
        },
        returning: () => Promise.resolve(fake.returnings.shift() ?? []),
        ...thenable(() => []),
      };
      return query;
    },
    update: (table: unknown) => {
      const call: Call = { op: "update", table };
      fake.calls.push(call);
      const query = {
        set: (values: unknown) => {
          call.values = values;
          return query;
        },
        where: () => query,
        ...thenable(() => []),
      };
      return query;
    },
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      fake.transactions += 1;
      return cb(db);
    },
  };
  return { getDb: () => db };
});

import {
  findReceipt,
  listReceipts,
  recordTranscript,
  saveEnvelopeReceipt,
  saveReceiptOnce,
  type SingletonReceipt,
} from "@/dossier/receipts";
import { dossiers, receipts } from "@/lib/db/schema";

const ID = "550e8400-e29b-41d4-a716-446655440000";
const AT = new Date("2026-10-20T10:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  dossierId: ID,
  kind: "perf",
  ref: "req-1",
  hash: "a".repeat(64),
  signature: null,
  payload: { services: [] },
  createdAt: AT,
  ...over,
});
const PERF: SingletonReceipt = {
  kind: "perf",
  ref: "req-1",
  hash: "b".repeat(64),
  signature: null,
  payload: { n: 1 },
};

beforeEach(() => {
  fake.selects = [];
  fake.returnings = [];
  fake.calls = [];
  fake.transactions = 0;
});

describe("findReceipt", () => {
  it("returns the stored row, parsed, or null", async () => {
    fake.selects.push([row()], []);
    expect(await findReceipt(ID, "perf")).toEqual({
      id: "00000000-0000-4000-8000-000000000001",
      kind: "perf",
      ref: "req-1",
      hash: "a".repeat(64),
      signature: null,
      payload: { services: [] },
      createdAt: AT,
    });
    expect(await findReceipt(ID, "transcript", "debate-1")).toBeNull();
    expect(fake.calls.every((c) => c.table === receipts)).toBe(true);
  });

  it("refuses a row Postgres should never hold", async () => {
    fake.selects.push([row({ kind: "invoice" })]);
    await expect(findReceipt(ID, "perf")).rejects.toThrow();
  });
});

describe("listReceipts", () => {
  it("returns every receipt of the dossier, parsed, as Postgres ordered them", async () => {
    fake.selects.push([row({ kind: "certificate", ref: "c1" }), row({ kind: "audit" })]);
    const all = await listReceipts(ID);
    expect(all.map((r) => [r.kind, r.ref])).toEqual([
      ["certificate", "c1"],
      ["audit", "req-1"],
    ]);
    expect(all[0]).not.toHaveProperty("dossierId");
    expect(fake.calls).toEqual([{ op: "select", table: receipts }]);
  });

  it("refuses a row Postgres should never hold", async () => {
    fake.selects.push([row({ hash: 7 })]);
    await expect(listReceipts(ID)).rejects.toThrow();
  });
});

describe("saveReceiptOnce", () => {
  it("locks the dossier row, then inserts when the dossier has no such receipt", async () => {
    fake.selects.push([{ id: ID }], []);
    fake.returnings.push([row({ hash: PERF.hash, payload: PERF.payload })]);
    const kept = await saveReceiptOnce(ID, PERF);
    expect(kept).toMatchObject({ kind: "perf", hash: PERF.hash, payload: { n: 1 } });
    expect(fake.transactions).toBe(1);
    expect(
      fake.calls.map((c) => [c.op, c.table === dossiers ? "dossiers" : "receipts", c.lock]),
    ).toEqual([
      ["select", "dossiers", "update"],
      ["select", "receipts", undefined],
      ["insert", "receipts", undefined],
    ]);
    expect(fake.calls[2]?.values).toEqual({ dossierId: ID, ...PERF });
  });

  it("returns the stored receipt without inserting a second", async () => {
    fake.selects.push([{ id: ID }], [row()]);
    const kept = await saveReceiptOnce(ID, PERF);
    expect(kept.hash).toBe("a".repeat(64));
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("refuses an unknown dossier before reading or writing receipts", async () => {
    fake.selects.push([]);
    await expect(saveReceiptOnce(ID, PERF)).rejects.toThrow(RangeError);
    expect(fake.calls).toHaveLength(1);
  });
});

describe("saveEnvelopeReceipt", () => {
  const ENVELOPE = {
    ref: "e5f6a7b8-c9d0-4e1f-a2b3-c4d5e6f7a8b9",
    hash: "e".repeat(64),
    signature: "sig",
    payload: {},
  };

  it("stores the envelope and sets dossiers.envelope_id in the same transaction", async () => {
    fake.selects.push([{ id: ID }], []);
    fake.returnings.push([row({ kind: "envelope", ref: ENVELOPE.ref, signature: "sig" })]);
    const kept = await saveEnvelopeReceipt(ID, ENVELOPE);
    expect(kept).toMatchObject({ kind: "envelope", ref: ENVELOPE.ref });
    expect(fake.transactions).toBe(1);
    expect(fake.calls[2]?.values).toMatchObject({ kind: "envelope", ref: ENVELOPE.ref });
    const update = fake.calls[3];
    expect(update).toMatchObject({ op: "update", table: dossiers });
    expect(update?.values).toMatchObject({ envelopeId: ENVELOPE.ref });
  });

  it("points envelope_id at the envelope already stored, not the new one", async () => {
    const stored = "11111111-2222-4333-8444-555555555555";
    fake.selects.push([{ id: ID }], [row({ kind: "envelope", ref: stored })]);
    await saveEnvelopeReceipt(ID, ENVELOPE);
    expect(fake.calls.some((c) => c.op === "insert")).toBe(false);
    expect(fake.calls.at(-1)?.values).toMatchObject({ envelopeId: stored });
  });
});

describe("recordTranscript", () => {
  const DEBATE = "889d7f2b-33c0-432a-b956-8a360f7b9497";
  const t = {
    debateId: DEBATE,
    transcriptHash: "5".repeat(64),
    signature: "tsig",
    payload: { debate_id: DEBATE },
    verdict: "TRUE" as const,
    confidence: 0.8,
  };

  it("stores the transcript receipt and the verdict, confidence to two places", async () => {
    fake.selects.push([]);
    expect(await recordTranscript(ID, t)).toEqual({ ok: true });
    expect(fake.calls.map((c) => c.op)).toEqual(["select", "insert", "update"]);
    expect(fake.calls[1]?.values).toEqual({
      dossierId: ID,
      kind: "transcript",
      ref: DEBATE,
      hash: t.transcriptHash,
      signature: "tsig",
      payload: t.payload,
    });
    expect(fake.calls[2]?.values).toMatchObject({ verdict: "TRUE", confidence: "0.80" });
  });

  it("adds no second receipt for a debate already stored", async () => {
    fake.selects.push([{ id: "r1" }]);
    await recordTranscript(ID, t);
    expect(fake.calls.map((c) => c.op)).toEqual(["select", "update"]);
  });

  it("writes nothing for a transcript that names another debate", async () => {
    const other = { ...t, payload: { debate_id: "other" } };
    expect(await recordTranscript(ID, other)).toEqual({
      ok: false,
      error: `transcript_mismatch: expected ${DEBATE}, got other`,
    });
    expect(fake.transactions).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });
});
