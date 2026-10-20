import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFind = vi.fn();
const mockSummaries = vi.fn();
vi.mock("@/dossier/store", () => ({
  findDossier: (...args: unknown[]) => mockFind(...args),
  loadStepSummaries: (...args: unknown[]) => mockSummaries(...args),
}));

import * as route from "@/app/api/dossiers/[id]/stream/route";
import {
  formatSseEvent,
  GET,
  maxDuration,
  STREAM_DEADLINE_MS,
  streamDossier,
} from "@/app/api/dossiers/[id]/stream/route";
import { type StepSummaryRow, summarizeRow } from "@/dossier/step-summary";
import type { StepRow } from "@/dossier/stages";
import { DOSSIER_ID, dossierRow, stepRows } from "../../../../../features/dossier/fixtures";

/**
 * Spec 21 §6.6, "The live run": the SSE route polls the dossier and a summary of its
 * `dossier_steps` rows (the dossier first) — never a stage's whole output — and sends `step` for
 * every row on the first tick and each changed row after, `status` when the status, verdict or
 * confidence change, `done` once terminal (at once for a dossier with no step rows), and `timeout`
 * once 270 s of wall-clock time have passed, however slow the reads were. It stops when the
 * client leaves.
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

/** A fake clock: sleeping moves it, and so may a slow read (`clock.advance`). */
function clock() {
  let t = Date.parse("2026-10-20T10:00:00Z");
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A config that polls `n` times, 2 s apart, before the deadline. */
function ticks(n: number, c = clock()) {
  return { pollIntervalMs: 2_000, heartbeatIntervalMs: 1_000_000, deadlineMs: n * 2_000, now: c.now, sleep: c.sleep };
}

const summarized = (rows: StepRow[]): StepSummaryRow[] => rows.map(summarizeRow);

const running = (over: Parameters<typeof dossierRow>[0] = {}) =>
  dossierRow({ status: "running", verdict: null, confidence: null, envelopeId: null, ...over });

/** Rows ok through read, seal running. */
function midRun(seal: Partial<StepRow> = {}): StepSummaryRow[] {
  return summarized(
    stepRows({
      seal: { status: "running", leaseUntil: new Date("2026-10-20T10:04:30Z"), finishedAt: null, ...seal },
      debate: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
      measure: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
      envelope: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
      record: { status: "pending", attempt: 0, startedAt: null, finishedAt: null },
    }),
  );
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
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(1)));
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

  it("then sends only the rows that changed, each with its note", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi
      .fn()
      .mockResolvedValueOnce(midRun())
      .mockResolvedValueOnce(midRun())
      .mockResolvedValueOnce(
        midRun({
          status: "ok",
          leaseUntil: new Date(0),
          finishedAt: new Date("2026-10-20T10:02:00Z"),
          output: { certified: 2, total: 2 },
        }),
      );
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(3)));
    const steps = events.filter((e) => e.type === "step");
    expect(steps).toHaveLength(9);
    expect(steps[8]?.data).toMatchObject({ stage: "seal", status: "ok", note: "certified 2 of 2" });
  });

  it("re-sends a waiting row whose next poll moved", async () => {
    const waiting = (at: string) => midRun({ status: "waiting", leaseUntil: new Date(0), notBefore: new Date(at) });
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi
      .fn()
      .mockResolvedValueOnce(waiting("2026-10-20T10:00:03Z"))
      .mockResolvedValueOnce(waiting("2026-10-20T10:00:06Z"));
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(2)));
    const seal = events.filter((e) => e.type === "step" && e.data.stage === "seal");
    expect(seal.map((e) => e.data.nextAt)).toEqual(["2026-10-20T10:00:03.000Z", "2026-10-20T10:00:06.000Z"]);
  });

  it("sends status only when the status, verdict or confidence change, with a numeric confidence", async () => {
    const dossierFn = vi
      .fn()
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(running())
      .mockResolvedValueOnce(running({ verdict: "TRUE", confidence: "0.82" }));
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(3)));
    expect(events.filter((e) => e.type === "status").map((e) => e.data)).toEqual([
      { status: "running", verdict: null, confidence: null },
      { status: "running", verdict: "TRUE", confidence: 0.82 },
    ]);
  });

  it("ends with done once terminal — after that tick's steps and status — and stops polling", async () => {
    const dossierFn = vi.fn().mockResolvedValueOnce(running()).mockResolvedValue(dossierRow());
    const stepsFn = vi.fn().mockResolvedValueOnce(midRun()).mockResolvedValue(summarized(stepRows()));
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(5)));
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
    await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(2)));
    expect(order).toEqual(["dossier", "steps", "dossier", "steps"]);
  });

  it("ends a failed dossier with done too", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running({ status: "failed" }));
    const stepsFn = vi.fn().mockResolvedValue(summarized(stepRows({ seal: { status: "error", error: "x" } })));
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(5)));
    expect(events.at(-1)?.data).toMatchObject({ status: "failed" });
  });

  it("ends with done when the dossier is deleted mid-stream", async () => {
    const dossierFn = vi.fn().mockResolvedValueOnce(running()).mockResolvedValue(null);
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(5)));
    expect(events.at(-1)).toEqual({ type: "done", data: { status: "failed", reason: "dossier_deleted" } });
  });

  it("ends a dossier with no step rows (v1) at once: nothing will ever move it (Ruling AK)", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running({ visitor: null, userId: "u1" }));
    const stepsFn = vi.fn().mockResolvedValue([]);
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, ticks(5)));
    expect(events).toEqual([
      { type: "status", data: { status: "running", verdict: null, confidence: null } },
      { type: "done", data: { status: "running", verdict: null, confidence: null, reason: "no_steps" } },
    ]);
    expect(dossierFn).toHaveBeenCalledTimes(1);
  });

  it("sends a heartbeat when the interval passes", async () => {
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { ...ticks(2), heartbeatIntervalMs: 0 }),
    );
    expect(events.some((e) => e.type === "heartbeat")).toBe(true);
  });

  it("ends with timeout 270 s after it opened, polling every 2 s — inside the 300 s budget", async () => {
    const c = clock();
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const sleeps: number[] = [];
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, {
        now: c.now,
        sleep: async (ms) => {
          sleeps.push(ms);
          await c.sleep(ms);
        },
      }),
    );
    expect(events.at(-1)?.type).toBe("timeout");
    expect(STREAM_DEADLINE_MS).toBe(270_000);
    expect(dossierFn).toHaveBeenCalledTimes(135);
    expect(new Set(sleeps)).toEqual(new Set([2_000]));
    expect(maxDuration).toBe(300);
  });

  it("ends on the wall clock, not a count: slow reads poll fewer times and still end by 270 s", async () => {
    const c = clock();
    const opened = c.now();
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn(async () => {
      c.advance(40_000); // a database that takes 40 s to answer
      return midRun();
    });
    const events = await collect(streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, { now: c.now, sleep: c.sleep }));
    expect(events.at(-1)?.type).toBe("timeout");
    expect(dossierFn.mock.calls.length).toBeLessThanOrEqual(7);
    expect(c.now() - opened).toBeLessThan(STREAM_DEADLINE_MS + 41_000);
  });

  it("never sleeps past the deadline", async () => {
    const c = clock();
    const sleeps: number[] = [];
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn(async () => {
      c.advance(1_500);
      return midRun();
    });
    await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, {
        deadlineMs: 5_000,
        now: c.now,
        sleep: async (ms) => {
          sleeps.push(ms);
          await c.sleep(ms);
        },
      }),
    );
    expect(sleeps.at(-1)).toBeLessThanOrEqual(2_000);
    expect(sleeps.every((ms) => ms >= 0)).toBe(true);
  });

  it("stops polling when the client goes away", async () => {
    const controller = new AbortController();
    const dossierFn = vi.fn().mockResolvedValue(running());
    const stepsFn = vi.fn().mockResolvedValue(midRun());
    const c = clock();
    const events = await collect(
      streamDossier(DOSSIER_ID, { dossierFn, stepsFn }, {
        ...ticks(100, c),
        signal: controller.signal,
        sleep: async (ms) => {
          await c.sleep(ms);
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

  it("is public and streams text/event-stream, uncached, from the step summaries", async () => {
    mockFind.mockResolvedValue(dossierRow());
    mockSummaries.mockResolvedValue(summarized(stepRows()));
    const res = await GET(req() as never, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    const body = await res.text();
    expect(body).toContain("event: step");
    expect(body).toContain("event: done");
    expect(mockSummaries).toHaveBeenCalledWith(DOSSIER_ID);
  });

  it("never streams an internal error's message (review round 1)", async () => {
    mockFind.mockResolvedValue(dossierRow({ status: "failed", error: "seal: stage_threw: SELECT token FROM keys" }));
    mockSummaries.mockResolvedValue(
      summarized(stepRows({ seal: { status: "error", error: "stage_threw: SELECT token FROM keys" } })),
    );
    const body = await (await GET(req() as never, ctx)).text();
    expect(body).toContain('"error":"stage_threw"');
    expect(body).not.toContain("SELECT");
  });

  it("answers 404 for an unknown dossier", async () => {
    mockFind.mockResolvedValue(null);
    const res = await GET(req() as never, ctx);
    expect(res.status).toBe(404);
  });

  it("ends with a stream_error that names nothing of the cause when the database fails mid-stream", async () => {
    mockFind.mockResolvedValueOnce(dossierRow({ status: "running" })).mockRejectedValue(new Error("password=secret"));
    mockSummaries.mockResolvedValue(summarized(stepRows()));
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
