import { describe, expect, it, vi } from "vitest";
import { createBodySchema } from "@/dossier/create";
import {
  type ComposeDraft,
  composeBody,
  emptyDraft,
  runCompose,
  submitCompose,
  validateCompose,
} from "@/features/dossier/compose";
import { DOC_ID, DOSSIER_ID } from "./fixtures";

/**
 * Spec 21 §6.6, "Compose", invariant 1: the fields are checked when the visitor submits — a claim of
 * 1–1024 characters after trimming, at least one source or document, at most 5 sources and 3
 * documents — and the body sent is exactly what `POST /api/dossiers` accepts.
 */

const UPLOAD = "6e5d4c3b-2a19-4807-b6a5-948372615049";
const JOB = "1f2e3d4c-5b6a-4978-8695-a4b3c2d1e0f9";

function draft(over: Partial<ComposeDraft> = {}): ComposeDraft {
  return { ...emptyDraft(), claim: "The fee is 350 dollars.", sources: ["hackernews"], ...over };
}

describe("validateCompose", () => {
  it("accepts a claim with one source, or with one document", () => {
    expect(validateCompose(draft())).toEqual({});
    expect(
      validateCompose(
        draft({ sources: [], documents: [{ documentId: DOC_ID, kind: "sample", jobId: null, label: "x" }] }),
      ),
    ).toEqual({});
  });

  it("refuses an empty or whitespace-only claim", () => {
    expect(validateCompose(draft({ claim: "" })).claim).toBe("Write the claim to check.");
    expect(validateCompose(draft({ claim: " \n\t " })).claim).toBe("Write the claim to check.");
  });

  it("accepts 1024 characters after trimming and refuses 1025", () => {
    expect(validateCompose(draft({ claim: `  ${"x".repeat(1024)}  ` })).claim).toBeUndefined();
    expect(validateCompose(draft({ claim: "x".repeat(1025) })).claim).toBe(
      "At most 1024 characters — this one has 1025.",
    );
  });

  it("refuses a dossier with nothing to read: no source and no document", () => {
    expect(validateCompose(draft({ sources: [], documents: [] })).evidence).toBe(
      "Pick at least one web source or document.",
    );
  });

  it("refuses more than 5 sources or 3 documents", () => {
    expect(validateCompose(draft({ sources: ["a", "b", "c", "d", "e", "f"] })).evidence).toMatch(/at most 5/);
    const docs = ["1", "2", "3", "4"].map((n) => ({
      documentId: `00000000-0000-4000-8000-00000000000${n}`,
      kind: "sample" as const,
      jobId: null,
      label: n,
    }));
    expect(validateCompose(draft({ documents: docs })).evidence).toMatch(/at most 3/);
  });
});

describe("composeBody", () => {
  it("trims the claim, keeps the mode, and sends an upload's job (never a sample's)", () => {
    const body = composeBody(
      draft({
        claim: "  The fee is 350 dollars.  ",
        mode: "adversarial",
        documents: [
          { documentId: DOC_ID, kind: "sample", jobId: null, label: "fees.pdf" },
          { documentId: UPLOAD, kind: "upload", jobId: JOB, label: "mine.pdf" },
        ],
      }),
    );
    expect(body).toEqual({
      claim: "The fee is 350 dollars.",
      sources: ["hackernews"],
      documents: [
        { document_id: DOC_ID, kind: "sample" },
        { document_id: UPLOAD, kind: "upload", job_id: JOB },
      ],
      mode: "adversarial",
    });
    expect(createBodySchema.safeParse(body).success).toBe(true);
  });

  it("omits the job of a deduplicated upload that has none (Ruling AC)", () => {
    const body = composeBody(
      draft({ documents: [{ documentId: UPLOAD, kind: "upload", jobId: null, label: "mine.pdf" }] }),
    );
    expect(body.documents).toEqual([{ document_id: UPLOAD, kind: "upload" }]);
    expect(createBodySchema.safeParse(body).success).toBe(true);
  });

  it("starts from standard mode with nothing picked", () => {
    expect(emptyDraft()).toEqual({ claim: "", sources: [], documents: [], mode: "standard" });
  });
});

describe("submitCompose", () => {
  it("POSTs the body as JSON and reads the 202 answer's url", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { dossier_id: DOSSIER_ID, request_id: "rid", url: `/d/${DOSSIER_ID}` },
        { status: 202, headers: { "x-request-id": "rid" } },
      ),
    );
    const out = await submitCompose(composeBody(draft()), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/dossiers",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "content-type": "application/json" }) }),
    );
    expect(out).toMatchObject({ ok: true, data: { url: `/d/${DOSSIER_ID}` } });
  });

  it("refuses an answer whose url is not this dossier's page", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { dossier_id: DOSSIER_ID, request_id: "rid", url: "https://evil.example/" },
        { status: 202, headers: { "x-request-id": "rid" } },
      ),
    );
    expect(await submitCompose(composeBody(draft()), { fetchImpl })).toMatchObject({
      ok: false,
      kind: "invalid_response",
    });
  });

  it("names a spent debate budget and a 422 for what they are", async () => {
    const spent = vi.fn(async () =>
      Response.json({ error: "budget_exhausted", retryAfterS: 3600, requestId: "rid" }, { status: 429 }),
    );
    expect(await submitCompose(composeBody(draft()), { fetchImpl: spent })).toMatchObject({
      ok: false,
      kind: "budget_exhausted",
    });
    const refused = vi.fn(async () =>
      Response.json({ error: "invalid_input", detail: "unknown source: x", requestId: "rid" }, { status: 422 }),
    );
    expect(await submitCompose(composeBody(draft()), { fetchImpl: refused })).toMatchObject({
      ok: false,
      kind: "invalid_input",
      detail: "unknown source: x",
    });
  });
});

describe("runCompose — the submit, composed", () => {
  const answer = { dossier_id: DOSSIER_ID, request_id: "rid", url: `/d/${DOSSIER_ID}` };

  function deps(outcome: Awaited<ReturnType<Parameters<typeof runCompose>[1]["submit"]>>) {
    return {
      submit: vi.fn(async () => outcome),
      navigate: vi.fn(),
      refreshBudgets: vi.fn(),
    };
  }

  it("sends nothing for a draft that fails its checks, and says why", async () => {
    const d = deps({ ok: true, data: answer, status: 202, requestId: "rid" });
    const out = await runCompose(draft({ claim: " ", sources: [] }), d);
    expect(out.errors).toEqual({
      claim: "Write the claim to check.",
      evidence: "Pick at least one web source or document.",
    });
    expect(d.submit).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
  });

  it("sends the composed body, re-reads the budgets, and goes to the dossier's page on a 202", async () => {
    const d = deps({ ok: true, data: answer, status: 202, requestId: "rid" });
    const out = await runCompose(draft({ claim: "  The fee is 350 dollars.  " }), d);
    expect(d.submit).toHaveBeenCalledWith(composeBody(draft()));
    expect(d.refreshBudgets).toHaveBeenCalledTimes(1);
    expect(d.navigate).toHaveBeenCalledWith(`/d/${DOSSIER_ID}`);
    expect(out.errors).toEqual({});
  });

  it("stays on the form when the run is refused (the budgets are still re-read)", async () => {
    const d = deps({ ok: false, kind: "budget_exhausted", requestId: "rid" });
    const out = await runCompose(draft(), d);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.refreshBudgets).toHaveBeenCalledTimes(1);
    expect(out.outcome).toMatchObject({ ok: false, kind: "budget_exhausted" });
  });

  it("does nothing more when the page was left mid-call (an aborted submit)", async () => {
    const d = deps(null);
    await runCompose(draft(), d);
    expect(d.navigate).not.toHaveBeenCalled();
    expect(d.refreshBudgets).not.toHaveBeenCalled();
  });
});
