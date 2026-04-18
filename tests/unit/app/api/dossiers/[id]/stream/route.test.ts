import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/server
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    body: unknown;
    headers: Headers;
    constructor(body?: BodyInit | null, init?: { status?: number; headers?: HeadersInit }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.headers = new Headers(init?.headers);
    }
    static json(data: unknown, init?: { status?: number }) {
      const r = new MockNextResponse(JSON.stringify(data), { status: init?.status });
      (r as unknown as { _jsonBody: unknown })._jsonBody = data;
      return r;
    }
  }
  return { NextResponse: MockNextResponse, NextRequest: class {} };
});

// Mock next/headers
const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => mockCookieGet(name),
  }),
}));

// Mock session
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Mock query helpers
const mockGetDossier = vi.fn();
const mockListEvents = vi.fn();
vi.mock("@/features/dossier/server/query", () => ({
  getDossier: (...args: unknown[]) => mockGetDossier(...args),
  listDossierEvents: (...args: unknown[]) => mockListEvents(...args),
}));

import type { Dossier } from "@/lib/db/schema";

const DOSSIER_UUID = "550e8400-e29b-41d4-a716-446655440000";

function makeDossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    id: DOSSIER_UUID,
    userId: "user-1",
    claim: "test claim",
    sources: ["hackernews"],
    mode: "standard",
    status: "running",
    verdict: null,
    confidence: null,
    requestId: "req-1",
    envelopeId: null,
    createdAt: new Date("2026-04-18T10:00:00Z"),
    updatedAt: new Date("2026-04-18T10:00:00Z"),
    ...overrides,
  };
}

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    dossierId: DOSSIER_UUID,
    step: "gather",
    status: "ok",
    latencyMs: 10,
    metadata: {},
    at: new Date("2026-04-18T10:00:01Z"),
    ...overrides,
  };
}

describe("17-sse: formatSseEvent", () => {
  it("formats a single event correctly", async () => {
    const { formatSseEvent } = await import("@/app/api/dossiers/[id]/stream/route");
    const output = formatSseEvent("state", { step: "gather", status: "ok" });
    expect(output).toBe('event: state\ndata: {"step":"gather","status":"ok"}\n\n');
  });

  it("serializes nested objects", async () => {
    const { formatSseEvent } = await import("@/app/api/dossiers/[id]/stream/route");
    const output = formatSseEvent("status", {
      status: "succeeded",
      verdict: "TRUE",
      confidence: 0.87,
    });
    expect(output).toContain("event: status");
    expect(output).toContain('"verdict":"TRUE"');
    expect(output).toContain('"confidence":0.87');
    expect(output).toMatch(/\n\n$/);
  });
});

describe("17-sse: streamDossierEvents generator", () => {
  const initial = makeDossier({ status: "running" });

  async function collect(gen: AsyncGenerator<string, void, unknown>): Promise<string[]> {
    const out: string[] = [];
    for await (const chunk of gen) out.push(chunk);
    return out;
  }

  const fastConfig = {
    pollIntervalMs: 1,
    heartbeatIntervalMs: 1_000_000,
    maxIterations: 3,
    sleep: () => Promise.resolve(),
  };

  it("case 10: emits state event for historical events on first tick", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const events = [
      makeEvent({ step: "gather", at: new Date("2026-04-18T10:00:01Z") }),
      makeEvent({ step: "seal", at: new Date("2026-04-18T10:00:02Z") }),
    ];
    const getDossierFn = vi
      .fn()
      .mockResolvedValue(makeDossier({ status: "succeeded", verdict: "TRUE", confidence: "0.90" }));
    const listEventsFn = vi
      .fn()
      .mockResolvedValueOnce(events)
      .mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(DOSSIER_UUID, initial, { getDossierFn, listEventsFn }, fastConfig),
    );

    const stateEvents = chunks.filter((c) => c.startsWith("event: state"));
    expect(stateEvents).toHaveLength(2);
    expect(stateEvents[0]).toContain("gather");
    expect(stateEvents[1]).toContain("seal");
  });

  it("case 11: emits status event when dossier status changes", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi
      .fn()
      .mockResolvedValueOnce(makeDossier({ status: "running" }))
      .mockResolvedValueOnce(
        makeDossier({ status: "succeeded", verdict: "TRUE", confidence: "0.90" }),
      );
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(DOSSIER_UUID, initial, { getDossierFn, listEventsFn }, fastConfig),
    );

    const statusEvents = chunks.filter((c) => c.startsWith("event: status"));
    expect(statusEvents).toHaveLength(1);
    expect(statusEvents[0]).toContain('"status":"succeeded"');
    expect(statusEvents[0]).toContain('"verdict":"TRUE"');
  });

  it("case 12: emits done event when status becomes terminal and stops", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi.fn().mockResolvedValue(
      makeDossier({ status: "succeeded", verdict: "FALSE", confidence: "0.75" }),
    );
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(DOSSIER_UUID, initial, { getDossierFn, listEventsFn }, fastConfig),
    );

    const doneEvents = chunks.filter((c) => c.startsWith("event: done"));
    expect(doneEvents).toHaveLength(1);
    expect(doneEvents[0]).toContain('"status":"succeeded"');
    // Generator should stop after done (no further iterations)
    expect(getDossierFn).toHaveBeenCalledTimes(1);
  });

  it("case 12b: emits done when status is failed", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi.fn().mockResolvedValue(makeDossier({ status: "failed" }));
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(DOSSIER_UUID, initial, { getDossierFn, listEventsFn }, fastConfig),
    );
    expect(chunks.some((c) => c.includes('event: done'))).toBe(true);
  });

  it("case 13: emits heartbeat when interval elapses", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi.fn().mockResolvedValue(makeDossier({ status: "running" }));
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(
        DOSSIER_UUID,
        initial,
        { getDossierFn, listEventsFn },
        { pollIntervalMs: 0, heartbeatIntervalMs: 0, maxIterations: 2, sleep: () => Promise.resolve() },
      ),
    );

    const heartbeats = chunks.filter((c) => c.startsWith("event: heartbeat"));
    expect(heartbeats.length).toBeGreaterThan(0);
  });

  it("case 14: emits timeout event after maxIterations", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi.fn().mockResolvedValue(makeDossier({ status: "running" }));
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(
        DOSSIER_UUID,
        initial,
        { getDossierFn, listEventsFn },
        { pollIntervalMs: 0, heartbeatIntervalMs: 1_000_000, maxIterations: 2, sleep: () => Promise.resolve() },
      ),
    );

    const timeoutEvents = chunks.filter((c) => c.startsWith("event: timeout"));
    expect(timeoutEvents).toHaveLength(1);
  });

  it("emits done if dossier is deleted mid-stream", async () => {
    const { streamDossierEvents } = await import("@/app/api/dossiers/[id]/stream/route");
    const getDossierFn = vi.fn().mockResolvedValue(null);
    const listEventsFn = vi.fn().mockResolvedValue([]);

    const chunks = await collect(
      streamDossierEvents(DOSSIER_UUID, initial, { getDossierFn, listEventsFn }, fastConfig),
    );
    const done = chunks.find((c) => c.startsWith("event: done"));
    expect(done).toBeDefined();
    expect(done).toContain("dossier_deleted");
  });
});

describe("17-sse: GET route auth + 404", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("case 7: returns 401 when no session", async () => {
    mockCookieGet.mockReturnValue(undefined);
    mockGetSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dossiers/[id]/stream/route");
    const req = {} as any;
    const res = await GET(req, { params: Promise.resolve({ id: DOSSIER_UUID }) });
    expect(res.status).toBe(401);
    expect(mockGetDossier).not.toHaveBeenCalled();
  });

  it("case 8: returns 404 when dossier does not exist", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue({
      sid: "s1",
      user: { id: "u1", email: "u@x.com", role: "admin", name: null },
    });
    mockGetDossier.mockResolvedValue(null);
    const { GET } = await import("@/app/api/dossiers/[id]/stream/route");
    const req = {} as any;
    const res = await GET(req, { params: Promise.resolve({ id: DOSSIER_UUID }) });
    expect(res.status).toBe(404);
  });

  it("case 9: returns text/event-stream for valid request", async () => {
    mockCookieGet.mockReturnValue({ value: "valid-cookie" });
    mockGetSession.mockResolvedValue({
      sid: "s1",
      user: { id: "u1", email: "u@x.com", role: "admin", name: null },
    });
    mockGetDossier.mockResolvedValue(makeDossier({ status: "succeeded", verdict: "TRUE" }));
    mockListEvents.mockResolvedValue([]);
    const { GET } = await import("@/app/api/dossiers/[id]/stream/route");
    const req = {} as any;
    const res = (await GET(req, {
      params: Promise.resolve({ id: DOSSIER_UUID }),
    })) as unknown as Response;
    // Valid stream responses aren't wrapped in MockNextResponse — they return a real Response
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });
});
