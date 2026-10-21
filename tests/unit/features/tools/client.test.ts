import { beforeEach, describe, expect, it, vi } from "vitest";
import { feathers } from "@/capabilities/feathers";
import { inkthread } from "@/capabilities/inkthread";
import { magpie } from "@/capabilities/magpie";
import { paperTrail } from "@/capabilities/paper-trail";
import { callTool, toolPath } from "@/features/tools/client";
import { fixture } from "../../capabilities/harness";

/**
 * The browser edge of every workbench action (spec 21 §5.1): one call to `/api/tools/<id>`, the
 * answer parsed with the capability's own output schema, every failure named for what it is.
 */

const RID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const USER = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

function ok(body: unknown, status = 200, requestId: string | null = RID): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (requestId !== null) headers.set("x-request-id", requestId);
  return new Response(JSON.stringify(body), { status, headers });
}

function failure(status: number, body: Record<string, unknown>): Response {
  return ok({ requestId: RID, ...body }, status);
}

beforeEach(() => {
  fetchImpl.mockReset();
});

describe("toolPath", () => {
  it("puts a GET's defined input in the query string, in order", () => {
    expect(toolPath(magpie.items, { name: "hn", limit: 20, offset: undefined })).toBe(
      "/api/tools/magpie.items?name=hn&limit=20",
    );
  });

  it("has no query string for a GET without input", () => {
    expect(toolPath(magpie.sources, {})).toBe("/api/tools/magpie.sources");
  });

  it("never puts a POST's input in the URL", () => {
    expect(toolPath(magpie.scrape, { source: "hn" })).toBe("/api/tools/magpie.scrape");
  });
});

describe("callTool", () => {
  it("GETs the capability and parses the answer with its own schema", async () => {
    fetchImpl.mockResolvedValueOnce(ok(fixture("inkthread", "reading.json")));
    const outcome = await callTool(inkthread.reading, { documentId: DOC }, { fetchImpl });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(`/api/tools/inkthread.reading?documentId=${DOC}`);
    expect(fetchImpl.mock.calls[0]?.[1].method).toBe("GET");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.requestId).toBe(RID);
    expect(outcome.data.schema).toBe("inkthread.reading/1");
  });

  it("POSTs a JSON body for every other method", async () => {
    fetchImpl.mockResolvedValueOnce(ok(fixture("paper-trail", "debate-create.json"), 201));
    const outcome = await callTool(
      paperTrail.debate,
      { claim: "the sky is blue", max_rounds: 1 },
      { fetchImpl },
    );
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ claim: "the sky is blue", max_rounds: 1 });
    expect(outcome).toMatchObject({ ok: true, status: 201 });
  });

  it("reads a 204 as no content (a soft delete)", async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response(null, { status: 204, headers: { "x-request-id": RID } }),
    );
    const outcome = await callTool(feathers.deleteUser, { id: USER }, { fetchImpl });
    expect(outcome).toEqual({ ok: true, data: null, status: 204, requestId: RID });
  });

  it("refuses an answer the capability's schema does not accept", async () => {
    fetchImpl.mockResolvedValueOnce(ok({ schema: "something else" }));
    const outcome = await callTool(inkthread.reading, { documentId: DOC }, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, kind: "invalid_response", requestId: RID });
  });

  it("refuses a success without a request id: its receipt could not be traced", async () => {
    fetchImpl.mockResolvedValueOnce(ok(fixture("magpie", "sources.json"), 200, null));
    const outcome = await callTool(magpie.sources, {}, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, kind: "invalid_response", requestId: null });
  });

  it.each([
    [504, { error: "asleep" }, { kind: "asleep" }],
    [429, { error: "rate_limited", retryAfterS: 17 }, { kind: "rate_limited", retryAfterS: 17 }],
    [
      429,
      { error: "budget_exhausted", retryAfterS: 3600 },
      { kind: "budget_exhausted", retryAfterS: 3600 },
    ],
    [
      404,
      { error: "downstream_error", detail: "user not found" },
      { kind: "downstream_error", status: 404, detail: "user not found" },
    ],
    [502, { error: "downstream_error", detail: "HTTP 500" }, { kind: "downstream_error", status: 502 }],
    [502, { error: "invalid_response", detail: "x: invalid_type" }, { kind: "invalid_response" }],
    [422, { error: "invalid_input", detail: "id: Invalid UUID" }, { kind: "invalid_input" }],
    [404, { error: "unknown_capability" }, { kind: "refused", error: "unknown_capability" }],
  ])("names a %i %o as %o, with the request id", async (status, body, expected) => {
    fetchImpl.mockResolvedValueOnce(failure(status, body));
    const outcome = await callTool(feathers.user, { id: USER }, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, requestId: RID, ...expected });
  });

  it("calls an error body outside the contract bastion unreachable, keeping the header's id", async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response("<html>gateway timeout</html>", {
        status: 504,
        headers: { "x-request-id": RID },
      }),
    );
    const outcome = await callTool(magpie.sources, {}, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, kind: "unreachable", status: 504, requestId: RID });
  });

  it("calls a network failure bastion unreachable, with no request id", async () => {
    fetchImpl.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const outcome = await callTool(magpie.sources, {}, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, kind: "unreachable", requestId: null });
  });

  it("rethrows an abort, so a page that was left never sets state", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchImpl.mockImplementationOnce(async (_url, init) => {
      init.signal?.throwIfAborted();
      return ok([]);
    });
    await expect(
      callTool(magpie.sources, {}, { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
