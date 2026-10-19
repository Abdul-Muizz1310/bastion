import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Spy on connection(): the page must wait for a request before it reads the database.
const mockConnection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => mockConnection(),
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

describe("TimeTravelPage (public)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeReplay();
  });

  it("case 9: renders for an anonymous visitor — no sign-in, no role", async () => {
    const element = await TimeTravelPage();
    const html = renderToString(element);
    expect(html).toContain("Time");
    expect(html).toContain("Travel");
    expect(html).toContain("rewind to");
  });

  it("case 2: seeds the first render from a real replay query at the current moment", async () => {
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
    const html = renderToString(await TimeTravelPage());
    expect(html).not.toContain("drag slider to rewind");
    expect(html).not.toContain("state reconstructed from append-only events");
  });

  it("case 9b: an empty event table renders the disabled-slider message", async () => {
    primeReplay({ entities: [], bounds: { min: null, max: MAX }, message: "No audit data yet." });
    const html = renderToString(await TimeTravelPage());
    expect(html).toContain("No audit data yet.");
    expect(html).toContain("disabled");
  });

  it("is rendered per request, never prerendered at build: connection() precedes the query", async () => {
    await TimeTravelPage();
    expect(mockConnection).toHaveBeenCalledTimes(1);
    expect(mockConnection.mock.invocationCallOrder[0]).toBeLessThan(
      mockGetTimeTravelState.mock.invocationCallOrder[0],
    );
  });

  it("no longer claims the page is admin-only", async () => {
    const html = renderToString(await TimeTravelPage());
    expect(html).not.toMatch(/admin only/i);
  });
});
