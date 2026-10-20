import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SLOWQUERY_HOSTS, slowquery } from "@/capabilities/slowquery";
import {
  base,
  call,
  expectInvalidInput,
  expectMissingFieldRejected,
  expectParses,
  fixture,
  sent,
  stubGateway,
} from "./harness";

/**
 * slowquery through the gateway (spec 21 §5: the fleet view, the demo's branch switch; §6.1: the
 * perf receipt of one request). `/_slowquery` is installed in paper-trail, magpie, inkprint,
 * inkthread and the demo (DR-0034), so the query capabilities take the service from their input.
 * Schemas: interface I-2 (`QueryRow`, `QueryDetail` of slowquery-detective 0.2.0), and the shape the
 * demo backend returns today, which both must parse.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const REQUEST = "4f1e2d3c-b4a5-4697-8877-665544332211";
const queries = fixture("slowquery", "queries.json");
const queriesDemo = fixture("slowquery", "queries-demo.json");
const query = fixture("slowquery", "query.json");
const queryDemo = fixture("slowquery", "query-demo.json");
const branch = fixture("slowquery", "branch.json");
const switched = fixture("slowquery", "switch.json");

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("slowquery.queries", () => {
  it("lists the hosts that install slowquery-detective", () => {
    expect(SLOWQUERY_HOSTS).toStrictEqual([
      "paper-trail",
      "magpie",
      "inkprint",
      "inkthread",
      "slowquery",
    ]);
  });

  it.each(SLOWQUERY_HOSTS)("GETs %s's /_slowquery/queries for one request id", async (service) => {
    await expectParses(slowquery.queries, { service, requestId: REQUEST }, queries);
    expect(sent().url).toBe(`${base(service)}/_slowquery/queries?request_id=${REQUEST}`);
    const token = sent().headers.get("x-platform-token") ?? "";
    expect(jose.decodeJwt(token)).toMatchObject({ aud: service, cap: "slowquery.queries" });
  });

  it("passes since as an ISO timestamp", async () => {
    const since = "2026-10-20T09:00:00Z";
    await expectParses(slowquery.queries, { service: "magpie", since }, queries);
    expect(sent().url).toBe(
      `${base("magpie")}/_slowquery/queries?since=${encodeURIComponent(since)}`,
    );
  });

  it("parses the demo backend's current list shape", async () => {
    await expectParses(slowquery.queries, { service: "slowquery" }, queriesDemo);
  });

  it("refuses a row without its fingerprint", async () => {
    await expectMissingFieldRejected(slowquery.queries, { service: "magpie" }, queries, [
      0,
      "fingerprint",
    ]);
  });

  it("refuses a suggestion kind slowquery does not make", async () => {
    const bad = structuredClone(queries) as { suggestions: { kind: string }[] }[];
    const first = bad[0]?.suggestions[0];
    if (first) first.kind = "drop_table";
    const result = await call(slowquery.queries, { service: "magpie" }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it.each([
    ["feathers-demo (it does not install slowquery)", { service: "feathers-demo" }],
    ["an unknown service", { service: "evil" }],
    ["no service", {}],
    ["a request id with a slash", { service: "magpie", requestId: "a/b" }],
    ["a request id starting with a dot", { service: "magpie", requestId: ".hidden" }],
    ["a request id over 128 characters", { service: "magpie", requestId: "a".repeat(129) }],
    ["since without an offset", { service: "magpie", since: "2026-10-20T09:00:00" }],
    ["since that is not a date", { service: "magpie", since: "yesterday" }],
  ])("refuses %s", async (_label, input) => {
    await expectInvalidInput(slowquery.queries, input);
  });
});

describe("slowquery.query", () => {
  it("GETs /_slowquery/queries/{id} on the named service (EXPLAIN plan, samples)", async () => {
    const data = await expectParses(
      slowquery.query,
      { service: "inkprint", id: "abcdef1234567890" },
      query,
    );
    expect(sent().url).toBe(`${base("inkprint")}/_slowquery/queries/abcdef1234567890`);
    expect(data).toMatchObject({ explain_plan: { cost: 1834.5 } });
  });

  it("parses the demo backend's current detail shape", async () => {
    await expectParses(slowquery.query, { service: "slowquery", id: "abcdef1234567890" }, queryDemo);
  });

  it("refuses a detail without its canonical SQL", async () => {
    await expectMissingFieldRejected(
      slowquery.query,
      { service: "slowquery", id: "abcdef1234567890" },
      query,
      ["canonical_sql"],
    );
  });

  it.each([["ABCDEF"], ["abcdef12345678901"], [".."], ["ab/cd"], [""]])(
    "refuses the fingerprint id %j",
    async (id) => {
      await expectInvalidInput(slowquery.query, { service: "slowquery", id });
    },
  );
});

describe("slowquery.branch and switch", () => {
  it("GETs the demo's /branches/current", async () => {
    await expectParses(slowquery.branch, {}, branch);
    expect(sent().url).toBe(`${base("slowquery")}/branches/current`);
  });

  it("refuses a branch other than slow or fast", async () => {
    const result = await call(slowquery.branch, {}, Response.json({ active: "main" }));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("POSTs /branches/switch with the target", async () => {
    await expectParses(slowquery.switch, { target: "fast" }, switched);
    expect(sent()).toMatchObject({
      url: `${base("slowquery")}/branches/switch`,
      method: "POST",
      body: { target: "fast" },
    });
  });

  it("refuses a switch answer without its latency", async () => {
    await expectMissingFieldRejected(slowquery.switch, { target: "fast" }, switched, ["latency_ms"]);
  });

  it("refuses a target other than slow or fast", async () => {
    await expectInvalidInput(slowquery.switch, { target: "main" });
  });
});
