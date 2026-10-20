import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paperTrail } from "@/capabilities/paper-trail";
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
 * paper-trail through the gateway (spec 21 §5: debate a claim, rounds as they finish, the signed
 * transcript; §6.1: the debate stage grounds on the sealed evidence pool). Schemas mirror
 * paper-trail-backend's `DebateCreateOut`, `DebateOut`, `DebateListOut` and `TranscriptJsonOut`.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const DEBATE = "889d7f2b-33c0-432a-b956-8a360f7b9497";
const CERT = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b";
const created = fixture("paper-trail", "debate-create.json");
const done = fixture("paper-trail", "debate.json");
const running = fixture("paper-trail", "debate-running.json");
const transcript = fixture("paper-trail", "transcript.json");
const receiptKey = fixture("paper-trail", "receipt-key.json");
const list = fixture("paper-trail", "list.json");
const evidence = {
  certificate_id: CERT,
  url: "https://www.uspto.gov/fees",
  title: "USPTO fee schedule",
  text: "Basic filing fee - Utility 350.00",
};

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paper-trail.debate", () => {
  it("POSTs /debates with the claim, rounds and evidence pool", async () => {
    const input = { claim: "The fee is 350.", max_rounds: 2, evidence_pool: [evidence] };
    await expectParses(paperTrail.debate, input, created, 201);
    expect(sent()).toMatchObject({
      url: `${base("paper-trail")}/debates`,
      method: "POST",
      body: input,
    });
  });

  it("asks for one round when none is given (paper-trail's own default is five)", async () => {
    await expectParses(paperTrail.debate, { claim: "c" }, created, 201);
    expect(sent().body).toStrictEqual({ claim: "c", max_rounds: 1 });
  });

  it("refuses a create answer without the debate id", async () => {
    await expectMissingFieldRejected(paperTrail.debate, { claim: "c" }, created, ["debate_id"]);
  });

  it.each([
    ["an empty url", { ...evidence, url: "" }],
    ["a blank url", { ...evidence, url: "   " }],
    ["an empty title", { ...evidence, title: "" }],
    ["a blank title", { ...evidence, title: "\t" }],
    ["no url", { certificate_id: CERT, title: "t", text: "x" }],
    ["no title", { certificate_id: CERT, url: "u", text: "x" }],
    ["empty text", { ...evidence, text: "" }],
    ["a certificate id that is not a uuid", { ...evidence, certificate_id: "cert-1" }],
  ])("refuses an evidence item with %s", async (_label, item) => {
    await expectInvalidInput(paperTrail.debate, { claim: "c", evidence_pool: [evidence, item] });
  });

  it.each([
    ["an empty claim", { claim: "" }],
    ["a blank claim", { claim: "  " }],
    ["a claim over 2000 characters", { claim: "x".repeat(2001) }],
    ["four rounds (the dearest mode is three)", { claim: "c", max_rounds: 4 }],
    ["zero rounds", { claim: "c", max_rounds: 0 }],
    ["51 evidence items", { claim: "c", evidence_pool: Array.from({ length: 51 }, () => evidence) }],
  ])("refuses %s", async (_label, input) => {
    await expectInvalidInput(paperTrail.debate, input);
  });

  it("spends the debate budget", async () => {
    vi.stubEnv("BUDGET_DEBATE", "0");
    expect(await call(paperTrail.debate, { claim: "c" })).toMatchObject({
      error: "budget_exhausted",
    });
  });
});

describe("paper-trail.debateGet and list", () => {
  it("GETs /debates/{id} while it runs and once it is done", async () => {
    expect(await expectParses(paperTrail.debateGet, { id: DEBATE }, running)).toMatchObject({
      status: "running",
      verdict: null,
    });
    expect(await expectParses(paperTrail.debateGet, { id: DEBATE }, done)).toMatchObject({
      status: "done",
      verdict: "TRUE",
    });
    expect(sent().url).toBe(`${base("paper-trail")}/debates/${DEBATE}`);
  });

  it("refuses a status paper-trail cannot store", async () => {
    const result = await call(
      paperTrail.debateGet,
      { id: DEBATE },
      Response.json({ ...(done as object), status: "finished" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("refuses a debate without its status", async () => {
    await expectMissingFieldRejected(paperTrail.debateGet, { id: DEBATE }, done, ["status"]);
  });

  it("GETs /debates with an encoded cursor and a limit", async () => {
    const cursor = (list as { next_cursor: string }).next_cursor;
    await expectParses(paperTrail.list, { cursor, limit: "10" }, list);
    expect(sent().url).toBe(
      `${base("paper-trail")}/debates?cursor=${encodeURIComponent(cursor)}&limit=10`,
    );
  });

  it("refuses a list without its cursor field", async () => {
    await expectMissingFieldRejected(paperTrail.list, {}, list, ["next_cursor"]);
  });

  it.each([["a/b"], ["a b"], [""]])("refuses the cursor %j", async (cursor) => {
    await expectInvalidInput(paperTrail.list, { cursor });
  });
});

describe("paper-trail.transcript and receiptKey", () => {
  it("GETs /debates/{id}/transcript.json and parses the signed transcript", async () => {
    const data = await expectParses(paperTrail.transcript, { id: DEBATE }, transcript);
    expect(sent().url).toBe(`${base("paper-trail")}/debates/${DEBATE}/transcript.json`);
    expect(data).toMatchObject({ verdict: "TRUE", signature_alg: "Ed25519" });
  });

  it("refuses a transcript without its hash", async () => {
    await expectMissingFieldRejected(paperTrail.transcript, { id: DEBATE }, transcript, [
      "transcript_hash",
    ]);
  });

  it("refuses a transcript hash that is not 64 characters", async () => {
    const result = await call(
      paperTrail.transcript,
      { id: DEBATE },
      Response.json({ ...(transcript as object), transcript_hash: "abc" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("refuses a citation that is neither a cert nor a url", async () => {
    const bad = structuredClone(transcript) as { rounds: { citations: unknown[] }[] };
    bad.rounds[0]?.citations.push({ type: "doi", ref: "10.1/x", title: "" });
    const result = await call(paperTrail.transcript, { id: DEBATE }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("accepts an unsigned transcript (no signing key configured)", async () => {
    await expectParses(
      paperTrail.transcript,
      { id: DEBATE },
      { ...(transcript as object), signature: null, signature_alg: null },
    );
  });

  it("GETs /platform/receipt-public-key and parses the recorded key", async () => {
    const data = await expectParses(paperTrail.receiptKey, {}, receiptKey);
    expect(sent().url).toBe(`${base("paper-trail")}/platform/receipt-public-key`);
    expect(data).toMatchObject({ alg: "Ed25519" });
  });

  it("refuses a receipt key without the PEM", async () => {
    await expectMissingFieldRejected(paperTrail.receiptKey, {}, receiptKey, ["public_key"]);
  });

  it.each([["../platform"], ["889d7f2b"]])("refuses the debate id %s", async (id) => {
    await expectInvalidInput(paperTrail.transcript, { id });
  });
});
