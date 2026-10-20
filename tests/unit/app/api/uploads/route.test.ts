import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/uploads` (spec 21 §3, §6.3): one multipart `file`, at most 4 MB, with the `%PDF-`
 * magic bytes (the bytes, not the declared type). The visitor is the actor and the address is
 * forwarded; the gateway reserves (and on a 4xx releases) the `upload` budget. 3 an hour.
 */

const { check, createRateLimiter, callCapability } = vi.hoisted(() => {
  const check = vi.fn();
  return { check, createRateLimiter: vi.fn(() => ({ check })), callCapability: vi.fn() };
});
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));
vi.mock("@/platform/gateway/call", async (orig) => ({
  ...(await orig<typeof import("@/platform/gateway/call")>()),
  callCapability,
}));

import * as route from "@/app/api/uploads/route";
import { inkthread, MAX_UPLOAD_BYTES } from "@/capabilities/inkthread";

const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const JOB = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PDF = new TextEncoder().encode("%PDF-1.7\n%…");

function upload(file: Blob | string | null, name = "fees.pdf", headers: Record<string, string> = {}) {
  const form = new FormData();
  if (typeof file === "string") form.set("file", file);
  else if (file !== null) form.set("file", file, name);
  return route.POST(
    new Request("https://bastion.test/api/uploads", {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": "203.0.113.9", ...headers },
    }),
  );
}

const ok = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 201,
  requestId: "r",
  ms: 1,
  data: {
    document: { id: DOC },
    job: { id: JOB },
    deduplicated: false,
    ...over,
  },
});

beforeEach(() => {
  vi.stubEnv("IRON_SESSION_PASSWORD", "x".repeat(32));
  check.mockReset().mockResolvedValue({ success: true, limit: 3, remaining: 2 });
  callCapability.mockReset().mockResolvedValue(ok());
});

describe("POST /api/uploads", () => {
  it("is dynamic and limited to 3 an hour per visitor", async () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(createRateLimiter).toHaveBeenCalledWith({ max: 3, windowMs: 3_600_000 });
    await upload(new Blob([PDF]));
    expect(check).toHaveBeenCalledWith(expect.stringMatching(/^upload:v_[a-z2-7]{10}$/));
  });

  it("forwards a PDF as the visitor and answers {document_id, job_id, deduplicated}", async () => {
    const res = await upload(new Blob([PDF], { type: "application/octet-stream" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document_id: DOC, job_id: JOB, deduplicated: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const [cap, input, ctx] = callCapability.mock.calls[0] ?? [];
    expect(cap).toBe(inkthread.upload);
    expect(input.fileName).toBe("fees.pdf");
    expect(input.file.size).toBe(PDF.byteLength);
    expect(ctx).toMatchObject({ clientIp: "203.0.113.9", actor: expect.stringMatching(/^v_/) });
  });

  it("falls back to the document's latest job for a deduplicated upload", async () => {
    callCapability.mockResolvedValue(
      ok({ job: null, deduplicated: true, document: { id: DOC, latest_job: { id: JOB } } }),
    );
    const res = await upload(new Blob([PDF]));
    expect(await res.json()).toEqual({ document_id: DOC, job_id: JOB, deduplicated: true });
  });

  it("answers null job_id when there is no job at all", async () => {
    callCapability.mockResolvedValue(ok({ job: null, deduplicated: true }));
    expect(await (await upload(new Blob([PDF]))).json()).toMatchObject({ job_id: null });
  });

  it("answers 415 to a non-PDF whatever it declares", async () => {
    const res = await upload(new Blob(["<html>"], { type: "application/pdf" }), "x.pdf");
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("unsupported_media_type");
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("answers 415 to a body that is not multipart", async () => {
    const res = await route.POST(
      new Request("https://bastion.test/api/uploads", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(415);
  });

  it("answers 413 above 4 MB", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(PDF);
    const res = await upload(new Blob([big]));
    expect(res.status).toBe(413);
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("answers 413 from content-length before reading an enormous body", async () => {
    const res = await upload(new Blob([PDF]), "a.pdf", {
      "content-length": String(MAX_UPLOAD_BYTES * 2),
    });
    expect(res.status).toBe(413);
  });

  it("accepts exactly 4 MB", async () => {
    const edge = new Uint8Array(MAX_UPLOAD_BYTES);
    edge.set(PDF);
    expect((await upload(new Blob([edge]))).status).toBe(200);
  });

  it.each([
    ["no file part", null],
    ["a text field", "%PDF-"],
    ["an empty file", new Blob([])],
  ])("answers 422 for %s", async (_n, file) => {
    const res = await upload(file as Blob | string | null);
    expect(res.status).toBe(422);
  });

  it("strips any path from the file name", async () => {
    await upload(new Blob([PDF]), "..\\evil/..//fees.pdf");
    expect(callCapability.mock.calls[0]?.[1].fileName).toBe("fees.pdf");
  });

  it("answers 429 over the rate limit without reading the file", async () => {
    check.mockResolvedValue({ success: false, limit: 3, remaining: 0, retryAfter: 600 });
    const res = await upload(new Blob([PDF]));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("600");
    expect(callCapability).not.toHaveBeenCalled();
  });

  it("maps a gateway refusal to its status, error and retry-after", async () => {
    callCapability.mockResolvedValue({
      ok: false,
      error: "budget_exhausted",
      status: 429,
      requestId: "r",
      retryAfterS: 300,
    });
    const res = await upload(new Blob([PDF]));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    expect((await res.json()).error).toBe("budget_exhausted");
  });
});
