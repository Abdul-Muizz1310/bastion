import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock cookies()
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock forbidden() / unauthorized() with sentinel throws
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_CALLED");
  }),
  unauthorized: vi.fn(() => {
    throw new Error("UNAUTHORIZED_CALLED");
  }),
}));

// Mock session module
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Mock audit write (rbac logs denials)
vi.mock("@/lib/audit/write", () => ({
  appendEvent: vi.fn().mockResolvedValue(1),
}));

// Mock the replay query the page seeds its first render from
const mockGetTimeTravelState = vi.fn();
vi.mock("@/lib/audit/replay", () => ({
  getTimeTravelState: (...args: unknown[]) => mockGetTimeTravelState(...args),
}));

// The Server Action the client slider calls is never invoked during SSR, but it
// must not drag the DB client into the module graph of this test.
vi.mock("@/features/time-travel/server/query", () => ({
  loadTimeTravelState: vi.fn(),
}));

import TimeTravelPage from "@/app/(app)/time-travel/page";

const MIN = new Date("2026-01-01T00:00:00.000Z");
const MAX = new Date("2026-01-11T00:00:00.000Z");

function primeReplay(overrides: Record<string, unknown> = {}) {
  mockGetTimeTravelState.mockResolvedValue({
    entities: [
      {
        entityType: "dossier",
        entityId: "dossier-42",
        service: "bastion",
        state: { status: "succeeded" },
        lastAction: "dossier.completed",
        lastEventAt: new Date("2026-01-10T09:00:00.000Z"),
      },
    ],
    bounds: { min: MIN, max: MAX },
    ...overrides,
  });
}

function adminSession() {
  return {
    sid: "sess-1",
    user: { id: "admin-1", email: "a@x.com", role: "admin" as const, name: null },
  };
}

function editorSession() {
  return {
    sid: "sess-2",
    user: { id: "editor-1", email: "e@x.com", role: "editor" as const, name: null },
  };
}

function viewerSession() {
  return {
    sid: "sess-3",
    user: { id: "viewer-1", email: "v@x.com", role: "viewer" as const, name: null },
  };
}

describe("TimeTravelPage (admin-gated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeReplay();
  });

  it("case 9: renders for admin session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(adminSession());
    const element = await TimeTravelPage();
    const html = renderToString(element);
    expect(html).toContain("Time");
    expect(html).toContain("Travel");
    expect(html).toContain("rewind to");
  });

  it("case 2: seeds the first render from a real replay query at the current moment", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(adminSession());
    const before = Date.now();
    const element = await TimeTravelPage();
    const after = Date.now();

    expect(mockGetTimeTravelState).toHaveBeenCalledTimes(1);
    const [options] = mockGetTimeTravelState.mock.calls[0];
    expect(options.asOf).toBeInstanceOf(Date);
    expect(options.asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(options.asOf.getTime()).toBeLessThanOrEqual(after);

    const html = renderToString(element);
    expect(html).toContain("dossier-42");
    expect(html).toContain("dossier.completed");
  });

  it("no longer renders the static mockup placeholder", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(adminSession());
    const html = renderToString(await TimeTravelPage());
    expect(html).not.toContain("drag slider to rewind");
    expect(html).not.toContain("state reconstructed from append-only events");
  });

  it("case 9b: an empty event table renders the disabled-slider message", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(adminSession());
    primeReplay({ entities: [], bounds: { min: null, max: MAX }, message: "No audit data yet." });
    const html = renderToString(await TimeTravelPage());
    expect(html).toContain("No audit data yet.");
    expect(html).toContain("disabled");
  });

  it("case 10: throws forbidden() for editor session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(editorSession());
    const { forbidden } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("FORBIDDEN_CALLED");
    expect(forbidden).toHaveBeenCalled();
  });

  it("case 11: throws forbidden() for viewer session", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(viewerSession());
    const { forbidden } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("FORBIDDEN_CALLED");
    expect(forbidden).toHaveBeenCalled();
  });

  it("case 12: throws unauthorized() when no session", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { unauthorized } = await import("next/navigation");
    await expect(TimeTravelPage()).rejects.toThrow("UNAUTHORIZED_CALLED");
    expect(unauthorized).toHaveBeenCalled();
  });

  it("case 11b: viewer denial is audit-logged with time-travel.view action", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue(viewerSession());
    const { appendEvent } = await import("@/lib/audit/write");
    try {
      await TimeTravelPage();
    } catch {
      // expected
    }
    expect(appendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "security.denied",
        entityType: "rbac",
        entityId: "time-travel.view",
        actorId: "viewer-1",
      }),
    );
  });
});
