import { describe, expect, it, vi } from "vitest";
import type { ToolOutcome } from "@/features/tools/outcome";
import { pollTool } from "@/features/tools/poll";

/**
 * Following a long-running thing (a debate, a leak scan, an upload's job) — spec 21 §5.1 case 5:
 * a poll stops at its terminal state, its deadline, or when the visitor leaves, and never overlaps.
 */

type Status = { status: "running" | "done" };
const RID = "req-1";

const ok = (status: Status["status"]): ToolOutcome<Status> => ({
  ok: true,
  data: { status },
  status: 200,
  requestId: RID,
});

function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

function poller(outcomes: ToolOutcome<Status>[], opts: { deadlineMs?: number; signal?: AbortSignal } = {}) {
  const c = clock();
  const call = vi.fn(async () => {
    const next = outcomes.shift();
    if (!next) throw new Error("polled past the end");
    return next;
  });
  const onData = vi.fn();
  const run = pollTool<Status>({
    call,
    isTerminal: (d) => d.status === "done",
    onData,
    intervalMs: 2_000,
    deadlineMs: opts.deadlineMs ?? 600_000,
    signal: opts.signal ?? new AbortController().signal,
    sleep: c.sleep,
    now: c.now,
  });
  return { run, call, onData, c };
}

describe("pollTool", () => {
  it("stops at the first terminal answer", async () => {
    const { run, call, onData } = poller([ok("done")]);
    expect(await run).toEqual({ kind: "done", data: { status: "done" }, requestId: RID });
    expect(call).toHaveBeenCalledTimes(1);
    expect(onData).toHaveBeenCalledWith({ status: "done" }, RID);
  });

  it("asks again every interval, handing each answer over as it arrives", async () => {
    const { run, call, onData, c } = poller([ok("running"), ok("running"), ok("done")]);
    expect((await run).kind).toBe("done");
    expect(call).toHaveBeenCalledTimes(3);
    expect(onData).toHaveBeenCalledTimes(3);
    expect(c.sleeps).toEqual([2_000, 2_000]);
  });

  it("waits as long as a 429 says (capped at a minute), then asks again", async () => {
    const { run, c } = poller([
      ok("running"),
      { ok: false, kind: "rate_limited", retryAfterS: 9, requestId: RID },
      { ok: false, kind: "rate_limited", retryAfterS: 900, requestId: RID },
      ok("done"),
    ]);
    expect((await run).kind).toBe("done");
    expect(c.sleeps).toEqual([2_000, 9_000, 60_000]);
  });

  it("rides out an asleep or unreachable answer, but not five in a row", async () => {
    const asleep: ToolOutcome<Status> = { ok: false, kind: "asleep", requestId: RID };
    const recovered = poller([asleep, asleep, ok("done")]);
    expect((await recovered.run).kind).toBe("done");

    const gone = poller([asleep, asleep, asleep, asleep, asleep]);
    expect(await gone.run).toMatchObject({ kind: "failed", failure: { kind: "asleep" } });
    expect(gone.call).toHaveBeenCalledTimes(5);
  });

  it("stops at once on any other failure, handing it back", async () => {
    const { run, call } = poller([
      ok("running"),
      { ok: false, kind: "downstream_error", status: 404, detail: "gone", requestId: RID },
    ]);
    expect(await run).toMatchObject({
      kind: "failed",
      failure: { kind: "downstream_error", status: 404 },
    });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("gives up at its deadline", async () => {
    const { run, call } = poller(
      Array.from({ length: 10 }, () => ok("running")),
      { deadlineMs: 5_000 },
    );
    expect(await run).toEqual({ kind: "timeout" });
    expect(call).toHaveBeenCalledTimes(3);
  });

  it("stops when the visitor leaves, without asking again", async () => {
    const controller = new AbortController();
    const outcomes = [ok("running"), ok("running")];
    const c = clock();
    const call = vi.fn(async () => {
      controller.abort();
      return outcomes.shift() ?? ok("running");
    });
    const end = await pollTool<Status>({
      call,
      isTerminal: (d) => d.status === "done",
      intervalMs: 2_000,
      deadlineMs: 60_000,
      signal: controller.signal,
      sleep: c.sleep,
      now: c.now,
    });
    expect(end).toEqual({ kind: "aborted" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("never overlaps: the next call starts only after the previous answer", async () => {
    let inFlight = 0;
    let most = 0;
    const outcomes = [ok("running"), ok("running"), ok("done")];
    const c = clock();
    await pollTool<Status>({
      call: async () => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return outcomes.shift() ?? ok("done");
      },
      isTerminal: (d) => d.status === "done",
      intervalMs: 2_000,
      deadlineMs: 60_000,
      signal: new AbortController().signal,
      sleep: c.sleep,
      now: c.now,
    });
    expect(most).toBe(1);
  });

  it("refuses an interval or deadline that is not a positive whole number", async () => {
    const base = {
      call: async () => ok("done"),
      isTerminal: () => true,
      signal: new AbortController().signal,
    };
    await expect(pollTool({ ...base, intervalMs: 0, deadlineMs: 1_000 })).rejects.toThrow(RangeError);
    await expect(pollTool({ ...base, intervalMs: 1_000, deadlineMs: Number.NaN })).rejects.toThrow(
      RangeError,
    );
  });
});
