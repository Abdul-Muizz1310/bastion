import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFind = vi.fn();
const mockSteps = vi.fn();
vi.mock("@/dossier/store", () => ({
  findDossier: (...args: unknown[]) => mockFind(...args),
  loadSteps: (...args: unknown[]) => mockSteps(...args),
}));

import * as route from "@/app/api/dossiers/[id]/stream/route";
import { formatSseEvent, GET, maxDuration, streamDossier } from "@/app/api/dossiers/[id]/stream/route";
import type { StepRow } from "@/dossier/stages";
import { DOSSIER_ID, dossierRow, stepRows } from "../../../../../features/dossier/fixtures";

/**
 * Spec 21 §6.6, "The live run": the SSE route polls the dossier and its `dossier_steps` rows (the
 * dossier first) and sends `step` for every row on the first tick and each changed row after,
 * `status` when the status, verdict or confidence change, `done` once terminal — within its 300 s
 * budget, stopping when the client leaves.
 */

type Parsed = { type: string; data: Record<string, unknown> };

function parse(chunk: string): Parsed {
  const m = /^event: ([a-z_]+)\ndata: ([\s\S]*)\n\n$/.exec(chunk);
  if (!m) throw new Error(`not an SSE event: ${chunk}`);
  return { type: m[1] ?? "", data: JSON.parse(m[2] ?? "null") };
}

async function collect(gen: AsyncGenerator<string>): Promise<Parsed[]> {
  const out: Parsed[] = [];
  for await (const chunk of gen) out.push(parse(chunk));
  return out;
}

const fast = { pollIntervalMs: 1, heartbeatIntervalMs: 1_000_000, maxIterations: 5, sleep: async () => {} };

const running = (over: Parameters<typeof dossierRow>[0] = {}) =>
  dossierRow({ status: "running", verdict: null, confidence: null, envelopeId: null, ...over });

/** Rows ok through read, seal running. */
function midRun(seal: Partial<StepRow> = {}): StepRow[] {
  return stepRows({
    seal: { status: "running", leaseUntil: new Date("2026-10-20T10:04:30Z"), finishedAt: null, ...seal },
    debate: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
    measure: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
    envelope: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
    record: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
  });
}

describe("formatSseEvent", () => {
  it("writes one event: its type and its JSON data", () => {
    expect(formatSseEvent("status", { status: "running" })).toBe(
      'event: status\ndata: {"status":"running"}\n\n',
    );
  });
});

describe("streamDossier", () => {
  it("sends every step row and the status on the first tick", async () => {
    const dossierFn = vi.fn().mockResolvedValueOnce(running()).mockResolvedValue(dossierRow());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 1 }));
    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((e) => e.data.stage)).toEqual([
      "wake",
      "gather",
      "read",
      "seal",
      "debate",
      "measure",
      "envelope",
      "record",
    ]);
    expect(steps[3]?.data).toMatchObject({ status: "running", leaseUntil: "2026-10-20T10:04:30.000Z", nextAt: null });
    expect(events.find((e) => e.type === "status")?.data).toEqual({
      status: "running",
      verdict: null,
      confidence: null,
    });
  });

  it("then sends only the rows that changed", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi
      .fn()
      .mockResolvedValueOnce(midRun())
      .mockResolvedValueOnce(midRun())
      .mockResolvedValueOnce(
        midRun({ status: "ok", leaseUntil: new Date(0), finishedAt: new Date("2026-10-20T10:02:00Z"), output: { certified: 2, total: 2 } }),
      );
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 3 }));
    const steps = events.filter((e) => e.type === "step");
    expect(steps).toHaveLength(9);
    expect(steps[8]?.data).toMatchObject({ stage: "seal", status: "ok", note: "certified 2 of 2" });
  });

  it("re-sends a waiting row whose next poll moved", async () => {
    const waiting = (at: string) =>
      midRun({ status: "waiting", leaseUntil: new Date(0), notBefore: new Date(at) });
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi
      .fn()
      .mockResolvedValueOnce(waiting("2026-10-20T10:00:03Z"))
      .mockResolvedValueOnce(waiting("2026-10-20T10:00:06Z"));
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 2 }));
    const seal = events.filter((e) => e.type === "step" && e.data.stage === "seal");
    expect(seal.map((e) => e.data.nextAt)).toEqual(["2026-10-20T10:00:03.000Z", "2026-10-20T10:00:06.000Z"]);
  });

  it("never sends a stage's output, only its note", async () => {
    const big = "x".repeat(50_000);
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(
      stepRows({ gather: { output: [{ key: "w-a", text: big }] }, seal: { status: "running", finishedAt: null } }),
    );
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 1 }));
    expect(JSON.stringify(events)).not.toContain(big);
  });

  it("sends status only when the status, verdict or confidence change, with a numeric confidence", async () => {
    const dossierFn = vi
      .fn()
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(running({ verdict: "TRUE", confidence: "0.82" }));
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 3 }));
    expect(events.filter((e) => e.type === "status").map((e) => e.data)).toEqual([
      { status: "running", verdict: null, confidence: null },
      { status: "running", verdict: "TRUE", confidence: 0.82 },
    ]);
  });

  it("ends with done once terminal — after that tick's steps and status — and stops polling", async () => {
    const dossierFn = vi.fn().mockResolvedValueOnce(running()).mockResolvedValue(dossierRow());
    const stepsFn = vi.fn().mockResolvedValueOnce(midRun()).mockResolvedValue(stepRows());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, fast));
    expect(events.at(-1)).toEqual({
      type: "done",
      data: { status: "succeeded", verdict: "TRUE", confidence: 0.82 },
    });
    expect(events.at(-2)?.type).toBe("status");
    const lastSteps = events.slice(-7, -2);
    expect(lastSteps.every((e) => e.type === "step" && e.data.status === "ok")).toBe(true);
    expect(dossierFn).toHaveBeenCalledTimes(2);
  });

  it("reads the dossier before the steps on every tick, so a terminal status never outruns its step", async () => {
    const order: string[] = [];
    const dossierFn = vi.fn(async () => {
      order.push("dossier");
      return running();
    });
    const stepsFn = vi.fn(async () => {
      order.push("steps");
      return midRun();
    });
    await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, maxIterations: 2 }));
    expect(order).toEqual(["dossier", "steps", "dossier", "steps"]);
  });

  it("ends a failed dossier with done too", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running({ status: "failed" }));
    const stepsFn = vi.fn().mockResolvedValue(stepRows({ seal: { status: "error", error: "x" } }));
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, fast));
    expect(events.at(-1)?.data).toMatchObject({ status: "failed" });
  });

  it("ends with done when the dossier is deleted mid-stream", async () => {
    const dossierFn = vi.fn().mockResolvedValueOnce(running()).mockResolvedValue(null);
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, fast));
    expect(events.at(-1)).toEqual({ type: "done", data: { status: "failed", reason: "dossier_deleted" } });
  });

  it("follows a v1 dossier (no step rows) by its status alone", async () => {
    const dossierFn = vi.fn().mockResolvedValue(dossierRow({ status: "succeeded" }));
    const stepsFn = vi.fn().mockResolvedValue([]);
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, fast));
    expect(events.map((e) => e.type)).toEqual(["status", "done"]);
  });

  it("sends a heartbeat when the interval passes", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...fast, heartbeatIntervalMs: 0, maxIterations: 2 }),
    );
    expect(events.some((e) => e.type === "heartbeat")).toBe(true);
  });

  it("ends with timeout after its polls, and by default polls 140 times 2 s apart (within 300 s)", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const sleeps: number[] = [];
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, {
        heartbeatIntervalMs: 1_000_000,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    );
    expect(events.at(-1)?.type).toBe("timeout");
    expect(dossierFn).toHaveBeenCalledTimes(140);
    expect(new Set(sleeps)).toEqual(new Set([2_000]));
    expect(140 * 2_000).toBeLessThan(maxDuration * 1000);
    expect(maxDuration).toBe(300);
  });

  it("stops polling when the client goes away", async () => {
    const controller = new AbortController();
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, {
        ...fast,
        maxIterations: 100,
        signal: controller.signal,
        sleep: async () => {
          if (dossierFn.mock.calls.length === 2) controller.abort();
        },
      }),
    );
    expect(dossierFn).toHaveBeenCalledTimes(2);
    expect(events.some((e) => e.type === "timeout")).toBe(false);
  });
});

describe("GET /api/dossiers/[id]/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const ctx = { params: Promise.resolve({ id: DOSSIER_ID }) };
  const req = () => new Request(`http://x/api/dossiers/${DOSSIER_ID}/stream`);

  it("is public and streams text/event-stream, uncached", async () => {
    mockFind.mockResolvedValue(dossierRow());
    mockSteps.mockResolvedValue(stepRows());
    const res = await GET(req() as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const body = await res.text();
    expect(body).toContain("event: step");
    expect(body).toContain("event: done");
  });

  it("answers 404 for an unknown dossier", async () => {
    mockFind.mockResolvedValue(null);
    const res = await GET(req() as never, ctx);
    expect(res.status).toBe(404);
  });

  it("ends with a stream_error that names nothing of the cause when the database fails mid-stream", async () => {
    mockFind.mockResolvedValueOnce(dossierRow({ status: "running" })).mockRejectedValue(new Error("password=secret"));
    mockSteps.mockResolvedValue(stepRows());
    const res = await GET(req() as never, ctx);
    const body = await res.text();
    expect(body).toContain('event: stream_error\ndata: {"error":"stream_error"}');
    expect(body).not.toContain("secret");
  });

  it("keeps a 300 s budget and no v1 dossier_events reader", () => {
    expect(maxDuration).toBe(300);
    expect(Object.keys(route)).not.toContain("streamDossierEvents");
  });
});
