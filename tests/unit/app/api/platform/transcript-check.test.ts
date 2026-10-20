import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callCapability } = vi.hoisted(() => ({ callCapability: vi.fn() }));
vi.mock("@/platform/gateway/call", async (orig) => ({
  ...(await orig<typeof import("@/platform/gateway/call")>()),
  callCapability: (...a: unknown[]) => callCapability(...a),
}));

import * as route from "@/app/api/platform/transcript-check/route";

/**
 * `GET /api/platform/transcript-check?id=<uuid>` (spec 21 §5.1): paper-trail's transcript and its
 * published key, fetched through the gateway as the visitor under one request id, then checked.
 */

const FIXTURES = resolve(__dirname, "../../../../fixtures/receipts/paper-trail");
const load = (name: string): unknown => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
const transcript = load("transcript-a.json") as { debate_id: string; transcript_hash: string };
const key = load("receipt-key.json");
const ID = transcript.debate_id;

const req = (query: string) =>
  new Request(`https://bastion.test/api/platform/transcript-check${query}`, {
    headers: { "x-forwarded-for": "203.0.113.9" },
  });

const ok = (data: unknown, requestId: string) => ({ ok: true, data, status: 200, requestId, ms: 5 });

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  callCapability.mockReset();
  callCapability.mockImplementation(async (cap: { id: string }, _input, ctx: { requestId: string }) =>
    cap.id === "paper-trail.transcript" ? ok(transcript, ctx.requestId) : ok(key, ctx.requestId),
  );
});

describe("GET /api/platform/transcript-check", () => {
  it("is rendered per request", () => {
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("fetches the transcript and the key as the visitor, under one request id", async () => {
    const res = await route.GET(req(`?id=${ID}`));
    expect(res.status).toBe(200);
    const rid = res.headers.get("x-request-id");
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const ids = callCapability.mock.calls.map((c) => (c[0] as { id: string }).id).sort();
    expect(ids).toEqual(["paper-trail.receiptKey", "paper-trail.transcript"]);
    for (const call of callCapability.mock.calls) {
      expect(call[2]).toMatchObject({ requestId: rid, actor: expect.stringMatching(/^v_/) });
    }
    expect(callCapability.mock.calls.find((c) => (c[0] as { id: string }).id === "paper-trail.transcript")?.[1]).toEqual({ id: ID });
  });

  it("answers the check: hash recomputed and signature verified", async () => {
    const body = await (await route.GET(req(`?id=${ID}`))).json();
    expect(body).toMatchObject({
      debateId: ID,
      transcriptHash: transcript.transcript_hash,
      hash: { state: "pass" },
      signature: { state: "pass" },
    });
    expect(body.requestId).toBeDefined();
  });

  it("passes the transcript's own gateway failure through (asleep stays asleep)", async () => {
    callCapability.mockImplementation(async (cap: { id: string }, _i, ctx: { requestId: string }) =>
      cap.id === "paper-trail.transcript"
        ? { ok: false, error: "asleep", status: 504, requestId: ctx.requestId }
        : ok(key, ctx.requestId),
    );
    const res = await route.GET(req(`?id=${ID}`));
    expect(res.status).toBe(504);
    expect(await res.json()).toMatchObject({ error: "asleep" });
  });

  it("reads the signature as unavailable when the key cannot be fetched — never a pass", async () => {
    callCapability.mockImplementation(async (cap: { id: string }, _i, ctx: { requestId: string }) =>
      cap.id === "paper-trail.transcript"
        ? ok(transcript, ctx.requestId)
        : { ok: false, error: "rate_limited", status: 429, retryAfterS: 9, requestId: ctx.requestId },
    );
    const body = await (await route.GET(req(`?id=${ID}`))).json();
    expect(body.hash.state).toBe("pass");
    expect(body.signature.state).toBe("unavailable");
  });

  it.each([
    ["no id", ""],
    ["an id that is not a UUID", "?id=889d7f2b"],
    ["a repeated id", `?id=${ID}&id=${ID}`],
  ])("refuses %s before calling anything", async (_name, query) => {
    const res = await route.GET(req(query));
    expect(res.status).toBe(422);
    expect(callCapability).not.toHaveBeenCalled();
  });
});
