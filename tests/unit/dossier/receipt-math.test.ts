import { describe, expect, it } from "vitest";
import {
  type AuditEventForDigest,
  auditDigest,
  lastEventId,
  type PerfQuery,
  type PerfReceipt,
  perfReceiptHash,
  perfReceiptJson,
} from "@/dossier/receipt-math";
import { sha256Hex } from "@/platform/sha256";

/**
 * The receipts' pure math (spec 21 §6.1, §6.5): the perf receipt's hash and the audit digest. Both
 * are SHA-256 over canonical JSON, so the format is pinned here byte for byte — a stranger
 * recomputing them needs nothing but this description.
 */

const query = (over: Partial<PerfQuery> = {}): PerfQuery => ({
  id: "abcdef1234567890",
  fingerprint: "select * from orders where user_id = ?",
  calls: 3,
  total_ms: 412.7,
  max_ms: 201.3,
  suggestions: [{ kind: "index", sql: "CREATE INDEX ix ON orders(created_at);" }],
  ...over,
});

const receipt = (over: Partial<PerfReceipt> = {}): PerfReceipt => ({
  dossier_id: "550e8400-e29b-41d4-a716-446655440000",
  request_id: "req-1",
  services: [
    { service: "magpie", queries: [], error: "404" },
    { service: "paper-trail", queries: [query()] },
  ],
  ...over,
});

const CANONICAL =
  '{"dossier_id":"550e8400-e29b-41d4-a716-446655440000","request_id":"req-1","services":[' +
  '{"error":"404","queries":[],"service":"magpie"},' +
  '{"queries":[{"calls":3,"fingerprint":"select * from orders where user_id = ?","id":"abcdef1234567890",' +
  '"max_ms":201.3,"suggestions":[{"kind":"index","sql":"CREATE INDEX ix ON orders(created_at);"}],' +
  '"total_ms":412.7}],"service":"paper-trail"}]}';

describe("perfReceiptHash", () => {
  it("is the sha256 of the receipt's canonical JSON, byte for byte", () => {
    expect(perfReceiptHash(receipt())).toBe(sha256Hex(CANONICAL));
  });

  it("writes an answering service without an error key, and a failed one with it", () => {
    const json = perfReceiptJson(receipt()) as { services: Array<Record<string, unknown>> };
    expect(json.services[0]).toEqual({ service: "magpie", queries: [], error: "404" });
    expect(Object.keys(json.services[1] ?? {}).sort()).toEqual(["queries", "service"]);
  });

  const changes: Array<[string, PerfReceipt]> = [
    [
      "the query id",
      receipt({
        services: [{ service: "paper-trail", queries: [query({ id: "0123456789abcdef" })] }],
      }),
    ],
    [
      "the fingerprint",
      receipt({
        services: [{ service: "paper-trail", queries: [query({ fingerprint: "select 1" })] }],
      }),
    ],
    [
      "the calls",
      receipt({ services: [{ service: "paper-trail", queries: [query({ calls: 4 })] }] }),
    ],
    [
      "total_ms",
      receipt({ services: [{ service: "paper-trail", queries: [query({ total_ms: 412.8 })] }] }),
    ],
    [
      "max_ms",
      receipt({ services: [{ service: "paper-trail", queries: [query({ max_ms: 201.4 })] }] }),
    ],
    [
      "max_ms to null",
      receipt({ services: [{ service: "paper-trail", queries: [query({ max_ms: null })] }] }),
    ],
    [
      "a suggestion's kind",
      receipt({
        services: [
          {
            service: "paper-trail",
            queries: [
              query({
                suggestions: [{ kind: "rewrite", sql: "CREATE INDEX ix ON orders(created_at);" }],
              }),
            ],
          },
        ],
      }),
    ],
    [
      "a suggestion's sql",
      receipt({
        services: [
          {
            service: "paper-trail",
            queries: [query({ suggestions: [{ kind: "index", sql: null }] })],
          },
        ],
      }),
    ],
    [
      "a suggestion removed",
      receipt({ services: [{ service: "paper-trail", queries: [query({ suggestions: [] })] }] }),
    ],
  ];
  const base = receipt({ services: [{ service: "paper-trail", queries: [query()] }] });

  it.each(changes)("changes when %s changes", (_what, changed) => {
    expect(perfReceiptHash(changed)).not.toBe(perfReceiptHash(base));
  });

  it("changes with the dossier, the request id, a service's error and the service order", () => {
    const h = perfReceiptHash(receipt());
    expect(
      perfReceiptHash(receipt({ dossier_id: "650e8400-e29b-41d4-a716-446655440000" })),
    ).not.toBe(h);
    expect(perfReceiptHash(receipt({ request_id: "req-2" }))).not.toBe(h);
    expect(
      perfReceiptHash(
        receipt({
          services: [
            { service: "magpie", queries: [], error: "asleep" },
            { service: "paper-trail", queries: [query()] },
          ],
        }),
      ),
    ).not.toBe(h);
    expect(perfReceiptHash(receipt({ services: [...receipt().services].reverse() }))).not.toBe(h);
  });

  it("does not depend on the order the receipt's keys were written in", () => {
    const shuffled = {
      services: [
        { error: "404", queries: [], service: "magpie" },
        {
          queries: [
            {
              suggestions: [{ sql: "CREATE INDEX ix ON orders(created_at);", kind: "index" }],
              total_ms: 412.7,
              max_ms: 201.3,
              id: "abcdef1234567890",
              fingerprint: "select * from orders where user_id = ?",
              calls: 3,
            },
          ],
          service: "paper-trail",
        },
      ],
      request_id: "req-1",
      dossier_id: "550e8400-e29b-41d4-a716-446655440000",
    } as PerfReceipt;
    expect(perfReceiptHash(shuffled)).toBe(perfReceiptHash(receipt()));
  });

  it("hashes only the declared fields, whatever else a value carries at run time", () => {
    const extra = { ...query(), p50_ms: 1.5 } as PerfQuery;
    expect(
      perfReceiptHash(receipt({ services: [{ service: "paper-trail", queries: [extra] }] })),
    ).toBe(perfReceiptHash(base));
  });

  it("refuses a number JSON cannot hold", () => {
    expect(() =>
      perfReceiptHash(
        receipt({
          services: [{ service: "paper-trail", queries: [query({ total_ms: Number.NaN })] }],
        }),
      ),
    ).toThrow(TypeError);
  });
});

const event = (id: number, over: Partial<AuditEventForDigest> = {}): AuditEventForDigest => ({
  id,
  action: "dossier.stage.ok",
  service: "bastion",
  createdAt: new Date(Date.UTC(2026, 9, 20, 10, 0, id)),
  ...over,
});

describe("auditDigest", () => {
  it("is the sha256 of canonical [id, action, service, created_at ISO] rows, ordered by id", () => {
    const events = [event(7, { action: "gateway.call", service: null }), event(3)];
    expect(auditDigest(events)).toBe(
      sha256Hex(
        '[[3,"dossier.stage.ok","bastion","2026-10-20T10:00:03.000Z"],' +
          '[7,"gateway.call",null,"2026-10-20T10:00:07.000Z"]]',
      ),
    );
  });

  it("does not depend on the order the events arrive in", () => {
    const events = [1, 2, 3, 5, 8, 13, 21].map((id) => event(id, { action: `a${id}` }));
    const expected = auditDigest(events);
    for (let shift = 1; shift < events.length; shift++) {
      const rotated = [...events.slice(shift), ...events.slice(0, shift)];
      expect(auditDigest(rotated)).toBe(expected);
      expect(auditDigest([...rotated].reverse())).toBe(expected);
    }
  });

  it("does not reorder the caller's array", () => {
    const events = [event(2), event(1)];
    auditDigest(events);
    expect(events.map((e) => e.id)).toEqual([2, 1]);
  });

  it("changes when any event's id, action, service or time changes, or one is added", () => {
    const base = [event(1), event(2)];
    const h = auditDigest(base);
    expect(auditDigest([event(1), event(3)])).not.toBe(h);
    expect(auditDigest([event(1), event(2, { action: "dossier.stage.error" })])).not.toBe(h);
    expect(auditDigest([event(1), event(2, { service: "magpie" })])).not.toBe(h);
    expect(auditDigest([event(1), event(2, { service: null })])).not.toBe(h);
    expect(
      auditDigest([
        event(1),
        event(2, { createdAt: new Date(Date.UTC(2026, 9, 20, 10, 0, 2, 1)) }),
      ]),
    ).not.toBe(h);
    expect(auditDigest([...base, event(4)])).not.toBe(h);
  });

  it("of no events is the sha256 of []", () => {
    expect(auditDigest([])).toBe(sha256Hex("[]"));
  });

  it("refuses two events with one id", () => {
    expect(() => auditDigest([event(1), event(1, { action: "x" })])).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 53])("refuses the event id %s", (id) => {
    expect(() => auditDigest([event(1), { ...event(2), id }])).toThrow(RangeError);
  });

  it("refuses an invalid time", () => {
    expect(() => auditDigest([event(1, { createdAt: new Date(Number.NaN) })])).toThrow(RangeError);
  });
});

describe("lastEventId", () => {
  it("is the largest id, or 0 when there are none", () => {
    expect(lastEventId([event(3), event(9), event(4)])).toBe(9);
    expect(lastEventId([])).toBe(0);
  });
});
