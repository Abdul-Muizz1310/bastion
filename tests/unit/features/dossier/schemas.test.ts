import { describe, expect, it } from "vitest";
import {
  dossierCreateRequestSchema,
  dossierCreateResponseSchema,
  dossierEventSchema,
  dossierModeSchema,
  dossierStatusSchema,
  sourceSlugSchema,
  verdictSchema,
} from "@/features/dossier/schemas";

describe("16-dossier-schemas: DossierCreateRequest", () => {
  it("case 1: valid create request parses", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "Is LLM training data leakage a real problem?",
      sources: ["hackernews", "arxiv-cs"],
      mode: "standard",
    });
    expect(result.success).toBe(true);
  });

  it("case 2: empty claim is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "",
      sources: ["hackernews"],
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 3: claim over 1024 chars is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "x".repeat(1025),
      sources: ["hackernews"],
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 4: empty sources array is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: [],
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 5: sources with 11 items is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: Array.from({ length: 11 }, (_, i) => `source-${i}`),
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 6: source with invalid slug (uppercase) is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: ["Bad Name"],
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 6b: source with spaces is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: ["hacker news"],
      mode: "standard",
    });
    expect(result.success).toBe(false);
  });

  it("case 7: unknown mode is rejected", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: ["hackernews"],
      mode: "turbo",
    });
    expect(result.success).toBe(false);
  });

  it("case 8: mode defaults to 'standard' when omitted", () => {
    const result = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: ["hackernews"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("standard");
    }
  });

  it("accepts all three modes", () => {
    for (const mode of ["rapid", "standard", "adversarial"] as const) {
      const r = dossierCreateRequestSchema.safeParse({
        claim: "test",
        sources: ["hackernews"],
        mode,
      });
      expect(r.success).toBe(true);
    }
  });

  it("source with dashes and digits is accepted", () => {
    const r = dossierCreateRequestSchema.safeParse({
      claim: "test",
      sources: ["arxiv-cs", "source-2", "hn-1"],
      mode: "rapid",
    });
    expect(r.success).toBe(true);
  });
});

describe("16-dossier-schemas: DossierCreateResponse", () => {
  it("case 9: valid response parses", () => {
    const result = dossierCreateResponseSchema.safeParse({
      dossier_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-abc-123",
      stream_url: "/api/dossiers/550e8400-e29b-41d4-a716-446655440000/stream",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID dossier_id", () => {
    const result = dossierCreateResponseSchema.safeParse({
      dossier_id: "not-a-uuid",
      request_id: "req-abc",
      stream_url: "/api/dossiers/x/stream",
    });
    expect(result.success).toBe(false);
  });

  it("rejects stream_url with wrong prefix", () => {
    const result = dossierCreateResponseSchema.safeParse({
      dossier_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-abc",
      stream_url: "/api/wrong/x/stream",
    });
    expect(result.success).toBe(false);
  });

  it("rejects stream_url without /stream suffix", () => {
    const result = dossierCreateResponseSchema.safeParse({
      dossier_id: "550e8400-e29b-41d4-a716-446655440000",
      request_id: "req-abc",
      stream_url: "/api/dossiers/x",
    });
    expect(result.success).toBe(false);
  });
});

describe("16-dossier-schemas: DossierEvent", () => {
  it("accepts valid event with all fields", () => {
    const r = dossierEventSchema.safeParse({
      step: "gather",
      status: "ok",
      latency_ms: 1234,
      metadata: { items: 10 },
      at: "2026-04-18T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null latency_ms (for 'started' events)", () => {
    const r = dossierEventSchema.safeParse({
      step: "gather",
      status: "started",
      latency_ms: null,
      metadata: {},
      at: "2026-04-18T10:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative latency_ms", () => {
    const r = dossierEventSchema.safeParse({
      step: "gather",
      status: "ok",
      latency_ms: -5,
      metadata: {},
      at: "2026-04-18T10:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown step", () => {
    const r = dossierEventSchema.safeParse({
      step: "wat",
      status: "ok",
      latency_ms: 0,
      metadata: {},
      at: "2026-04-18T10:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("accepts all known steps", () => {
    for (const step of [
      "gather",
      "seal",
      "adjudicate",
      "measure",
      "envelope",
      "record",
    ] as const) {
      const r = dossierEventSchema.safeParse({
        step,
        status: "ok",
        latency_ms: 1,
        metadata: {},
        at: "2026-04-18T10:00:00.000Z",
      });
      expect(r.success).toBe(true);
    }
  });
});

describe("16-dossier-schemas: enum schemas", () => {
  it("dossierModeSchema has 3 options", () => {
    expect(dossierModeSchema.options).toEqual(["rapid", "standard", "adversarial"]);
  });

  it("dossierStatusSchema has 4 options", () => {
    expect(dossierStatusSchema.options).toEqual([
      "pending",
      "running",
      "succeeded",
      "failed",
    ]);
  });

  it("verdictSchema has 3 options", () => {
    expect(verdictSchema.options).toEqual(["TRUE", "FALSE", "INCONCLUSIVE"]);
  });

  it("sourceSlugSchema accepts valid slugs", () => {
    expect(sourceSlugSchema.safeParse("hackernews").success).toBe(true);
    expect(sourceSlugSchema.safeParse("arxiv-cs").success).toBe(true);
    expect(sourceSlugSchema.safeParse("a").success).toBe(true);
  });

  it("sourceSlugSchema rejects uppercase / spaces / special chars", () => {
    expect(sourceSlugSchema.safeParse("HackerNews").success).toBe(false);
    expect(sourceSlugSchema.safeParse("hacker news").success).toBe(false);
    expect(sourceSlugSchema.safeParse("hacker_news").success).toBe(false);
    expect(sourceSlugSchema.safeParse("").success).toBe(false);
  });
});
