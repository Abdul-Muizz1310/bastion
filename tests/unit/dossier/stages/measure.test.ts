import { describe, expect, it, vi } from "vitest";
import { type QueryRow, slowquery } from "@/capabilities/slowquery";
import { perfReceiptHash, perfReceiptJson, type PerfReceipt } from "@/dossier/receipt-math";
import type { SingletonReceipt, StoredReceipt } from "@/dossier/receipts";
import { measuredServices, measureStage } from "@/dossier/stages/measure";
import type { RequestEvent } from "@/platform/audit/request-events";
import type { GatewayResult } from "@/platform/gateway/result";
import { DOSSIER_ID, fixture, stageCtx } from "./helpers";

/**
 * Stage `measure` (spec 21 §6.1): ask every service the dossier called (its audit log says which)
 * for the queries it ran under the dossier's request id, and keep them as the perf receipt. A
 * service that does not answer is recorded as such; the stage still succeeds.
 */

const REQUEST_ID = "req-dossier-1";
const AT = new Date("2026-10-20T10:00:00Z");
const ev = (id: number, service: string | null, action = "gateway.call"): RequestEvent => ({
  id,
  action,
  service,
  createdAt: AT,
});

const rows = () => slowquery.queries.output.parse(fixture("slowquery", "queries.json"));
const demoRows = () => slowquery.queries.output.parse(fixture("slowquery", "queries-demo.json"));
const ok = (data: QueryRow[]): GatewayResult<QueryRow[]> => ({
  ok: true,
  data,
  status: 200,
  requestId: "r",
  ms: 1,
});
type Failure = Extract<GatewayResult<QueryRow[]>, { ok: false }>;
const fail = (error: Failure["error"], status: number): GatewayResult<QueryRow[]> => ({
  ok: false,
  error,
  status,
  requestId: "r",
});

const storedFrom = (r: SingletonReceipt): StoredReceipt => ({
  id: "00000000-0000-4000-8000-0000000000aa",
  kind: r.kind,
  ref: r.ref,
  hash: r.hash,
  signature: r.signature,
  payload: r.payload,
  createdAt: AT,
});

function setup(
  opts: {
    events?: RequestEvent[][];
    answers?: Partial<Record<string, GatewayResult<QueryRow[]>>>;
    stored?: StoredReceipt | null;
    keep?: (r: SingletonReceipt) => StoredReceipt;
  } = {},
) {
  const reads = [...(opts.events ?? [[ev(1, "paper-trail"), ev(2, "magpie")]])];
  const events = vi.fn(async (_requestId: string) => reads.shift() ?? []);
  const queries = vi.fn(
    async (_ctx: unknown, input: { service: string; requestId?: string }) =>
      opts.answers?.[input.service] ?? ok(rows()),
  );
  const saved: SingletonReceipt[] = [];
  const stored = vi.fn(async () => opts.stored ?? null);
  const stage = measureStage({
    events,
    queries: queries as never,
    stored,
    save: async (_id, r) => {
      saved.push(r);
      return (opts.keep ?? storedFrom)(r);
    },
  });
  return { stage, events, queries, saved, stored };
}

const servicesOf = (r: SingletonReceipt) => (r.payload as unknown as PerfReceipt).services;

describe("measuredServices", () => {
  it("is every called service that keeps a slowquery log, once each, sorted", () => {
    const events = [
      ev(1, "paper-trail"),
      ev(2, "magpie"),
      ev(3, "paper-trail"),
      ev(4, "feathers-demo"),
      ev(5, "bastion", "dossier.stage.ok"),
      ev(6, null),
      ev(7, "inkthread"),
      ev(8, "inkprint"),
      ev(9, "slowquery"),
      ev(10, "Magpie"),
      ev(11, "unknown"),
    ];
    expect(measuredServices(events)).toEqual([
      "inkprint",
      "inkthread",
      "magpie",
      "paper-trail",
      "slowquery",
    ]);
    expect(measuredServices([])).toEqual([]);
  });
});

describe("measure stage", () => {
  it("asks each called service for the dossier's request id (Ruling P)", async () => {
    const { stage, queries, events } = setup();
    const ctx = stageCtx();
    await stage(ctx);
    expect(events.mock.calls[0]?.[0]).toBe(REQUEST_ID);
    const inputs = queries.mock.calls.map((c) => c[1]);
    expect(inputs).toEqual([
      { service: "magpie", requestId: REQUEST_ID },
      { service: "paper-trail", requestId: REQUEST_ID },
    ]);
    for (const input of inputs) expect(slowquery.queries.input.safeParse(input).success).toBe(true);
    expect(queries.mock.calls[0]?.[0]).toBe(ctx);
  });

  it("stores the perf receipt, hashed over its canonical JSON", async () => {
    const { stage, saved } = setup({
      events: [[ev(1, "paper-trail")], [ev(1, "paper-trail"), ev(2, "paper-trail")]],
    });
    const out = await stage(stageCtx());
    const expected: PerfReceipt = {
      dossier_id: DOSSIER_ID,
      request_id: REQUEST_ID,
      services: [
        {
          service: "paper-trail",
          queries: [
            {
              id: "0123456789abcdef",
              fingerprint: "select count(*) from order_items where order_id = ?",
              calls: 1,
              total_ms: 3.2,
              max_ms: 3.2,
              suggestions: [],
            },
            {
              id: "abcdef1234567890",
              fingerprint: "select * from orders where user_id = ? order by created_at desc",
              calls: 3,
              total_ms: 412.7,
              max_ms: 201.3,
              suggestions: [
                {
                  kind: "index",
                  sql: "CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at);",
                },
              ],
            },
          ],
        },
      ],
    };
    expect(saved).toEqual([
      {
        kind: "perf",
        ref: REQUEST_ID,
        hash: perfReceiptHash(expected),
        signature: null,
        payload: perfReceiptJson(expected),
      },
    ]);
    expect(out).toEqual({
      kind: "ok",
      output: { perfReceiptHash: perfReceiptHash(expected), auditUpTo: 2 },
    });
  });

  it("reads the demo's query shape too (integer total_ms, extra suggestion fields dropped)", async () => {
    const { stage, saved } = setup({
      events: [[ev(1, "slowquery")]],
      answers: { slowquery: ok(demoRows()) },
    });
    await stage(stageCtx());
    expect(servicesOf(saved[0] as SingletonReceipt)).toEqual([
      {
        service: "slowquery",
        queries: [
          {
            id: "abcdef1234567890",
            fingerprint: "select * from orders where user_id = ? order by created_at desc",
            calls: 7,
            total_ms: 4120,
            max_ms: 4.5,
            suggestions: [
              {
                kind: "index",
                sql: "CREATE INDEX IF NOT EXISTS ix_orders_created_at ON orders(created_at);",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("tolerates one failing service: it contributes its error and the stage succeeds", async () => {
    const { stage, saved } = setup({ answers: { magpie: fail("downstream_error", 404) } });
    const out = await stage(stageCtx());
    expect(out.kind).toBe("ok");
    const services = servicesOf(saved[0] as SingletonReceipt);
    expect(services[0]).toEqual({ service: "magpie", queries: [], error: "404" });
    expect(services[1]?.service).toBe("paper-trail");
    expect(services[1]?.queries).toHaveLength(2);
  });

  it.each([
    ["asleep", fail("asleep", 504), "asleep"],
    ["401", fail("downstream_error", 401), "401"],
    ["403", fail("downstream_error", 403), "403"],
    ["404", fail("downstream_error", 404), "404"],
    ["500", fail("downstream_error", 500), "500"],
    ["503", fail("downstream_error", 503), "503"],
    ["an unreadable answer", fail("invalid_response", 502), "invalid_response"],
  ] as const)("a service answering %s contributes that code", async (_what, answer, code) => {
    const { stage, saved } = setup({ answers: { magpie: answer, "paper-trail": answer } });
    expect((await stage(stageCtx())).kind).toBe("ok");
    expect(servicesOf(saved[0] as SingletonReceipt)).toEqual([
      { service: "magpie", queries: [], error: code },
      { service: "paper-trail", queries: [], error: code },
    ]);
  });

  it.each([
    ["the gateway's rate limit (retryable)", fail("rate_limited", 429), true],
    ["a refused input", fail("invalid_input", 422), false],
    ["a downstream 422", fail("downstream_error", 422), false],
  ] as const)("fails the stage on %s and stores nothing", async (_what, answer, retryable) => {
    const { stage, saved } = setup({ answers: { magpie: answer } });
    const out = await stage(stageCtx());
    expect(out).toMatchObject({ kind: "error", retryable });
    expect(out.kind === "error" && out.error).toContain("slowquery.queries (magpie)");
    expect(saved).toHaveLength(0);
  });

  it("stores an empty receipt when the dossier called no measured service", async () => {
    const only = [ev(1, "bastion", "dossier.stage.ok")];
    const { stage, saved, queries } = setup({ events: [only, only] });
    const out = await stage(stageCtx());
    expect(queries).not.toHaveBeenCalled();
    const empty: PerfReceipt = { dossier_id: DOSSIER_ID, request_id: REQUEST_ID, services: [] };
    expect(saved[0]?.hash).toBe(perfReceiptHash(empty));
    expect(out).toEqual({
      kind: "ok",
      output: { perfReceiptHash: perfReceiptHash(empty), auditUpTo: 1 },
    });
  });

  it("reuses a stored perf receipt: no call, no second receipt", async () => {
    const kept = storedFrom({
      kind: "perf",
      ref: REQUEST_ID,
      hash: "a".repeat(64),
      signature: null,
      payload: {},
    });
    const { stage, queries, saved } = setup({
      stored: kept,
      events: [[ev(4, "magpie"), ev(9, "bastion")]],
    });
    const out = await stage(stageCtx());
    expect(queries).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
    expect(out).toEqual({ kind: "ok", output: { perfReceiptHash: "a".repeat(64), auditUpTo: 9 } });
  });

  it("reports the hash of the receipt that was kept when another save won", async () => {
    const winner = storedFrom({
      kind: "perf",
      ref: REQUEST_ID,
      hash: "b".repeat(64),
      signature: null,
      payload: {},
    });
    const { stage } = setup({ keep: () => winner });
    const out = await stage(stageCtx());
    expect(out).toMatchObject({ kind: "ok", output: { perfReceiptHash: "b".repeat(64) } });
  });

  it("fails loudly when a stored perf receipt has no hash", async () => {
    const broken = {
      ...storedFrom({ kind: "perf", ref: null, hash: "x", signature: null, payload: {} }),
      hash: null,
    };
    const { stage } = setup({ stored: broken });
    expect(await stage(stageCtx())).toEqual({
      kind: "error",
      error: "measure: the stored perf receipt has no hash",
      retryable: false,
    });
  });
});
