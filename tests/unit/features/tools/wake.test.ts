import { describe, expect, it, vi } from "vitest";
import { wakeService } from "@/features/tools/wake";

/**
 * The wake request a workbench's gate makes (spec 21 §5.1, Ruling F): the wake route's own answer,
 * parsed, or a failure that says what went wrong — never a guessed health.
 */

const health = {
  service: "inkthread",
  state: "live",
  latencyMs: 412,
  checkedAt: "2026-10-20T10:00:00.000Z",
};

const signal = () => new AbortController().signal;

describe("wakeService", () => {
  it("POSTs the wake route for the service and returns its answer", async () => {
    const fetchImpl = vi.fn(async () => Response.json(health));
    const answer = await wakeService("inkthread", signal(), fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/platform/wake/inkthread",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(answer).toEqual({ kind: "answer", state: "live", latencyMs: 412 });
  });

  it("passes an asleep or down answer through as the route gave it", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ ...health, state: "asleep" }));
    expect(await wakeService("inkthread", signal(), fetchImpl)).toMatchObject({
      kind: "answer",
      state: "asleep",
    });
  });

  it("reads a 429 as rate limited, with the route's retry-after", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "17" } }),
    );
    expect(await wakeService("inkthread", signal(), fetchImpl)).toEqual({
      kind: "rate_limited",
      retryAfterS: 17,
    });
  });

  it("waits a minute when a 429 names no usable retry-after", async () => {
    const fetchImpl = vi.fn(async () => Response.json({}, { status: 429 }));
    expect(await wakeService("inkthread", signal(), fetchImpl)).toEqual({
      kind: "rate_limited",
      retryAfterS: 60,
    });
  });

  it.each([
    ["a 500", async () => new Response("boom", { status: 500 })],
    ["a 404", async () => Response.json({ error: "unknown_service" }, { status: 404 })],
    ["a malformed body", async () => Response.json({ state: "sleepy" })],
    ["another service's answer", async () => Response.json({ ...health, service: "magpie" })],
    [
      "a network failure",
      async () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("calls %s a failed wake, never a state", async (_name, impl) => {
    const answer = await wakeService("inkthread", signal(), vi.fn(impl));
    expect(answer.kind).toBe("failed");
  });

  it("rethrows an abort", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      init.signal?.throwIfAborted();
      return Response.json(health);
    });
    await expect(wakeService("inkthread", controller.signal, fetchImpl)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
