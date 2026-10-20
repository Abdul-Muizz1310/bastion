import { describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";
import { getRoute } from "@/features/tools/client";

/**
 * bastion's own JSON routes (token preview, transcript check) read the same way as a tool call:
 * parsed with their schema, failures named, the request id kept when there is one.
 */

const schema = z.object({ n: z.number() });

describe("getRoute", () => {
  it("GETs the path and parses the body, taking the request id from the header", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ n: 1 }, { headers: { "x-request-id": "rid-1" } }),
    );
    expect(await getRoute("/api/x", schema, { fetchImpl })).toEqual({
      ok: true,
      data: { n: 1 },
      status: 200,
      requestId: "rid-1",
    });
  });

  it("does without a request id on a route that sets none", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ n: 1 }));
    expect(await getRoute("/api/x", schema, { fetchImpl })).toMatchObject({ ok: true, requestId: "" });
  });

  it("names a refusal without a request id by its error", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "5" } }),
    );
    expect(await getRoute("/api/x", schema, { fetchImpl })).toMatchObject({
      ok: false,
      kind: "rate_limited",
      requestId: null,
    });
  });

  it("refuses a body its schema does not accept", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ n: "one" }));
    expect(await getRoute("/api/x", schema, { fetchImpl })).toMatchObject({
      ok: false,
      kind: "invalid_response",
    });
  });
});
