import { describe, expect, it, vi } from "vitest";
import { postAdvance, postRetry } from "@/features/dossier/live/advance-client";
import { DOSSIER_ID } from "../fixtures";

/**
 * Spec 21 §6.2, §6.4, §6.6: the browser edges of the runner — the page's nudge
 * (`POST …/advance`) and "retry from this stage" (`POST …/retry`), each answer parsed.
 */

const signal = new AbortController().signal;

describe("postAdvance", () => {
  it("reads an AdvanceResult", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ran: "seal", status: "ok", dossier: "running", nextAt: "2026-10-20T10:00:03.000Z" }),
    );
    expect(await postAdvance(DOSSIER_ID, signal, fetchImpl)).toEqual({
      kind: "ok",
      dossier: "running",
      nextAt: "2026-10-20T10:00:03.000Z",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/dossiers/${DOSSIER_ID}/advance`,
      expect.objectContaining({ method: "POST", cache: "no-store", signal }),
    );
  });

  it("names a 429 with its wait, from the body or else the header", async () => {
    const body = vi.fn(async () => Response.json({ error: "rate_limited", retryAfterS: 12 }, { status: 429 }));
    expect(await postAdvance(DOSSIER_ID, signal, body)).toEqual({ kind: "rate_limited", retryAfterS: 12 });
    const header = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "9" } }));
    expect(await postAdvance(DOSSIER_ID, signal, header)).toEqual({ kind: "rate_limited", retryAfterS: 9 });
  });

  it("names a 404 as gone, and anything else as failed", async () => {
    const gone = vi.fn(async () => Response.json({ error: "unknown_dossier" }, { status: 404 }));
    expect(await postAdvance(DOSSIER_ID, signal, gone)).toEqual({ kind: "gone" });
    const boom = vi.fn(async () => Response.json({ error: "advance_failed" }, { status: 500 }));
    expect(await postAdvance(DOSSIER_ID, signal, boom)).toMatchObject({ kind: "failed" });
    const odd = vi.fn(async () => Response.json({ ran: 3 }));
    expect(await postAdvance(DOSSIER_ID, signal, odd)).toMatchObject({ kind: "failed" });
    const offline = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await postAdvance(DOSSIER_ID, signal, offline)).toMatchObject({ kind: "failed" });
  });

  it("rethrows an abort, so a page that was left sets nothing", async () => {
    const c = new AbortController();
    c.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    await expect(postAdvance(DOSSIER_ID, c.signal, fetchImpl)).rejects.toThrow(/aborted/);
  });

  it("refuses an id that is not a dossier id", async () => {
    await expect(postAdvance("x/../y", signal, vi.fn())).rejects.toThrow(RangeError);
  });
});

describe("postRetry", () => {
  it("POSTs the stage as JSON and reads the answer", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ stage: "seal", dossier: "running" }, { headers: { "x-request-id": "rid-retry" } }),
    );
    const out = await postRetry(DOSSIER_ID, "seal", { fetchImpl });
    expect(out).toMatchObject({ ok: true, data: { stage: "seal", dossier: "running" }, requestId: "rid-retry" });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/dossiers/${DOSSIER_ID}/retry`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ stage: "seal" }) }),
    );
  });

  it("names a 409 (not retryable) and a 429 for what they are", async () => {
    const conflict = vi.fn(async () =>
      Response.json({ error: "not_retryable", detail: "later_stage_ok", requestId: "r" }, { status: 409 }),
    );
    expect(await postRetry(DOSSIER_ID, "seal", { fetchImpl: conflict })).toMatchObject({
      ok: false,
      kind: "refused",
      error: "not_retryable",
    });
    const limited = vi.fn(async () =>
      Response.json({ error: "rate_limited", retryAfterS: 3000, requestId: "r" }, { status: 429 }),
    );
    expect(await postRetry(DOSSIER_ID, "seal", { fetchImpl: limited })).toMatchObject({
      ok: false,
      kind: "rate_limited",
      retryAfterS: 3000,
    });
  });
});
