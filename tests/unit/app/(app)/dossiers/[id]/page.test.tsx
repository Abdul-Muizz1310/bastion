import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock notFound — throw sentinel so tests can catch
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND_CALLED");
  }),
}));

// Mock cookies()
const mockCookieGet = vi.fn().mockReturnValue({ value: "c" });
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: (name: string) => mockCookieGet(name) }),
}));

// Mock session (returns admin by default)
const mockGetSession = vi.fn().mockResolvedValue({
  sid: "s",
  user: { id: "u1", email: "a@x.com", role: "admin", name: null },
});
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Mock the verify button — it's a client component using fetch/useState
vi.mock("@/features/dossier/components/VerifyButton", () => ({
  VerifyButton: (props: any) =>
    createElement(
      "div",
      {
        "data-testid": "verify-button",
        "data-dossier-id": props.dossierId,
        "data-can-verify": String(props.canVerify),
      },
      "<VerifyButton stub>",
    ),
}));

// Mock query helpers
const mockGetDossier = vi.fn();
const mockListEvents = vi.fn();
vi.mock("@/features/dossier/server/query", () => ({
  getDossier: (...args: unknown[]) => mockGetDossier(...args),
  listDossierEvents: (...args: unknown[]) => mockListEvents(...args),
}));

// Mock the client StepTimeline — it uses EventSource which isn't available in jsdom.
// We only verify the RSC shell passes props correctly.
vi.mock("@/features/dossier/components/StepTimeline", () => ({
  StepTimeline: (props: any) =>
    createElement(
      "div",
      {
        "data-testid": "step-timeline",
        "data-dossier-id": props.dossierId,
        "data-initial-status": props.initialStatus,
        "data-initial-verdict": props.initialVerdict ?? "",
        "data-event-count": String(props.initialEvents.length),
      },
      "<StepTimeline stub>",
    ),
}));

import DossierPage from "@/app/(app)/dossiers/[id]/page";

const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

function dossier(overrides: Record<string, unknown> = {}) {
  return {
    id: VALID_UUID,
    userId: "user-1",
    claim: "Is X true?",
    sources: ["hackernews", "arxiv-cs"],
    mode: "standard" as const,
    status: "running" as const,
    verdict: null,
    confidence: null,
    requestId: "req-abc-123",
    envelopeId: null,
    createdAt: new Date("2026-04-18T10:00:00Z"),
    updatedAt: new Date("2026-04-18T10:00:00Z"),
    ...overrides,
  };
}

describe("17-dossier-page: routing guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListEvents.mockResolvedValue([]);
  });

  it("case 15: malformed id triggers notFound()", async () => {
    const { notFound } = await import("next/navigation");
    await expect(
      DossierPage({ params: Promise.resolve({ id: "not-a-uuid" }) }),
    ).rejects.toThrow("NOT_FOUND_CALLED");
    expect(notFound).toHaveBeenCalled();
    expect(mockGetDossier).not.toHaveBeenCalled();
  });

  it("case 16: unknown dossier (getDossier returns null) triggers notFound()", async () => {
    mockGetDossier.mockResolvedValue(null);
    const { notFound } = await import("next/navigation");
    await expect(
      DossierPage({ params: Promise.resolve({ id: VALID_UUID }) }),
    ).rejects.toThrow("NOT_FOUND_CALLED");
    expect(notFound).toHaveBeenCalled();
  });
});

describe("17-dossier-page: renders valid dossier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDossier.mockResolvedValue(dossier());
    mockListEvents.mockResolvedValue([]);
  });

  it("case 17: renders claim, mode, sources", async () => {
    const element = await DossierPage({ params: Promise.resolve({ id: VALID_UUID }) });
    const html = renderToString(element);
    expect(html).toContain("Is X true?");
    expect(html).toContain("standard");
    expect(html).toContain("hackernews, arxiv-cs");
  });

  it("case 18: passes initialEvents to StepTimeline", async () => {
    mockListEvents.mockResolvedValueOnce([
      {
        id: 1,
        dossierId: VALID_UUID,
        step: "gather",
        status: "ok",
        latencyMs: 10,
        metadata: {},
        at: new Date("2026-04-18T10:00:01Z"),
      },
      {
        id: 2,
        dossierId: VALID_UUID,
        step: "seal",
        status: "ok",
        latencyMs: 20,
        metadata: {},
        at: new Date("2026-04-18T10:00:02Z"),
      },
    ]);
    const element = await DossierPage({ params: Promise.resolve({ id: VALID_UUID }) });
    const html = renderToString(element);
    expect(html).toContain('data-event-count="2"');
    expect(html).toContain('data-initial-status="running"');
  });

  it("passes verdict + confidence when dossier is succeeded", async () => {
    mockGetDossier.mockResolvedValueOnce(
      dossier({ status: "succeeded", verdict: "TRUE", confidence: "0.87" }),
    );
    const element = await DossierPage({ params: Promise.resolve({ id: VALID_UUID }) });
    const html = renderToString(element);
    expect(html).toContain('data-initial-verdict="TRUE"');
    expect(html).toContain('data-initial-status="succeeded"');
  });

  it("displays first 8 chars of dossier id in status bar", async () => {
    const element = await DossierPage({ params: Promise.resolve({ id: VALID_UUID }) });
    const html = renderToString(element);
    expect(html).toContain("550e8400");
  });

  it("displays first 8 chars of request id in status bar", async () => {
    const element = await DossierPage({ params: Promise.resolve({ id: VALID_UUID }) });
    const html = renderToString(element);
    expect(html).toContain("req-abc-");
  });
});
