import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchVerification } from "@/features/dossier/verify";

/**
 * Spec 19 — dossier verification. The network edge of the VerifyButton lives
 * here so its failure branches are testable without a DOM.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OK_BODY = {
  dossier_id: "dossier-1",
  overall_valid: true,
  results: [{ certificate_id: "cert-1", valid: true, checks: { signature: true, hash: true } }],
  verified_at: "2026-01-01T00:00:00.000Z",
};

describe("19-verification: fetchVerification", () => {
  let fetchImpl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchImpl = vi.fn();
  });

  it("calls the verify endpoint for the given dossier", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(OK_BODY));
    await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith("/api/dossiers/dossier-1/verify");
  });

  it("returns the parsed response on success", async () => {
    fetchImpl.mockResolvedValue(jsonResponse(OK_BODY));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: true, response: OK_BODY });
  });

  it("surfaces the server's error message on a non-2xx response", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ error: "Access denied" }, 403));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, error: "Access denied" });
  });

  it("falls back to the status code when the error body is unusable", async () => {
    fetchImpl.mockResolvedValue(new Response("not json", { status: 500 }));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, error: "Verify failed (500)" });
  });

  it("reports a malformed success body instead of rendering garbage", async () => {
    fetchImpl.mockResolvedValue(jsonResponse({ nonsense: true }));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, error: "Malformed verification response" });
  });

  it("reports a network failure", async () => {
    fetchImpl.mockRejectedValue(new Error("ECONNRESET"));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, error: "ECONNRESET" });
  });

  it("reports a non-Error rejection without leaking its shape", async () => {
    fetchImpl.mockRejectedValue("boom");
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: false, error: "network_error" });
  });

  it("accepts the 'no evidence yet' shape where overall_valid is null", async () => {
    const body = {
      dossier_id: "dossier-1",
      overall_valid: null,
      message: "no_evidence_yet",
      results: [],
      verified_at: "2026-01-01T00:00:00.000Z",
    };
    fetchImpl.mockResolvedValue(jsonResponse(body));
    const outcome = await fetchVerification("dossier-1", fetchImpl as unknown as typeof fetch);
    expect(outcome).toEqual({ ok: true, response: body });
  });
});
