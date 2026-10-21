import { describe, expect, it } from "vitest";
import {
  type DisplayState,
  nodeHealth,
  parseStatusResponse,
  StatusParseError,
  type StatusSnapshot,
  summarize,
} from "@/features/health/model";

/**
 * Spec 21 §3/§4, Task 11: the home map shows each product's health from GET /api/platform/status.
 * Health is live | asleep | down per service; "checking" (before the first answer) and "unknown"
 * (no answer for that service) are display states. A product with no backend service runs inside
 * bastion, which is serving the page, so it is live.
 */

const AT = "2026-10-20T10:00:00.000Z";

function body(services: unknown[]) {
  return { services, timestamp: AT };
}

function health(service: string, state: string, latencyMs = 120) {
  return { service, state, latencyMs, checkedAt: AT };
}

function ok(...entries: ReturnType<typeof health>[]): StatusSnapshot {
  return parseStatusResponse(body(entries));
}

describe("parseStatusResponse", () => {
  it("parses the status route's body into an ok snapshot keyed by service", () => {
    const snapshot = parseStatusResponse(
      body([
        { ...health("magpie", "live", 212), version: "1.4.0", commitSha: "abc1234" },
        health("inkprint", "asleep", 8000),
      ]),
    );
    expect(snapshot.phase).toBe("ok");
    if (snapshot.phase !== "ok") throw new Error("unreachable");
    expect(snapshot.checkedAt).toBe(AT);
    expect(snapshot.services.magpie).toEqual({
      service: "magpie",
      state: "live",
      latencyMs: 212,
      version: "1.4.0",
      commitSha: "abc1234",
      checkedAt: AT,
    });
    expect(snapshot.services.inkprint?.state).toBe("asleep");
  });

  it.each([
    ["a non-object", "nope"],
    ["null", null],
    ["no services array", { timestamp: AT }],
    ["no timestamp", { services: [] }],
    ["an unknown state", body([health("magpie", "waking")])],
    ["a negative latency", body([health("magpie", "live", -1)])],
    ["a missing service id", body([{ state: "live", latencyMs: 1, checkedAt: AT }])],
  ])("refuses %s with a StatusParseError", (_name, input) => {
    expect(() => parseStatusResponse(input)).toThrow(StatusParseError);
  });

  it("refuses the same service twice: one answer per service", () => {
    expect(() =>
      parseStatusResponse(body([health("magpie", "live"), health("magpie", "down")])),
    ).toThrow(StatusParseError);
  });
});

describe("nodeHealth", () => {
  it("is live with no services: the product runs inside bastion, which served this page", () => {
    expect(nodeHealth([], { phase: "checking" })).toEqual({
      state: "live",
      detail: "serving this page",
    });
    expect(nodeHealth([], { phase: "error", checkedAt: AT })).toEqual({
      state: "live",
      detail: "serving this page",
    });
  });

  it("is checking until the first answer arrives", () => {
    expect(nodeHealth(["magpie"], { phase: "checking" })).toEqual({ state: "checking" });
  });

  it("is unknown when the status request failed — never a guess", () => {
    expect(nodeHealth(["magpie"], { phase: "error", checkedAt: AT })).toEqual({
      state: "unknown",
    });
  });

  it("is unknown when the answer has no entry for the service", () => {
    expect(nodeHealth(["feathers-demo"], ok(health("magpie", "live")))).toEqual({
      state: "unknown",
    });
  });

  it.each<[string, DisplayState, string | undefined]>([
    ["live", "live", "212 ms"],
    ["asleep", "asleep", undefined],
    ["down", "down", undefined],
  ])("reports a single %s service, with its latency only when live", (state, expected, detail) => {
    const result = nodeHealth(["magpie"], ok(health("magpie", state, 212)));
    expect(result).toEqual(detail ? { state: expected, detail } : { state: expected });
  });

  it("reports the worst of several services: down > unknown > asleep > live", () => {
    const snap = ok(
      health("magpie", "live"),
      health("inkprint", "asleep"),
      health("paper-trail", "down"),
    );
    expect(nodeHealth(["magpie", "inkprint"], snap).state).toBe("asleep");
    expect(nodeHealth(["magpie", "inkprint", "paper-trail"], snap).state).toBe("down");
    expect(nodeHealth(["magpie", "slowquery"], snap).state).toBe("unknown");
    expect(nodeHealth(["inkprint", "slowquery"], snap).state).toBe("unknown");
    // A repeated id is one service: it keeps the single-service latency detail.
    expect(nodeHealth(["magpie", "magpie"], snap)).toEqual({ state: "live", detail: "120 ms" });
    expect(nodeHealth(["magpie", "inkthread"], ok(health("magpie", "live"), health("inkthread", "live")))).toEqual({
      state: "live",
    });
  });

  it("rounds a fractional latency for display", () => {
    expect(nodeHealth(["magpie"], ok(health("magpie", "live", 211.6))).detail).toBe("212 ms");
  });
});

describe("summarize", () => {
  const all = ["paper-trail", "magpie", "inkprint", "inkthread", "slowquery", "feathers-demo"];

  it("counts every service as checking before the first answer", () => {
    expect(summarize(all, { phase: "checking" })).toEqual({
      total: 6,
      live: 0,
      asleep: 0,
      down: 0,
      unknown: 0,
      checking: 6,
    });
  });

  it("counts every service as unknown after a failed request", () => {
    expect(summarize(all, { phase: "error", checkedAt: AT }).unknown).toBe(6);
  });

  it("counts each service's state; a service with no entry is unknown", () => {
    const snap = ok(
      health("paper-trail", "live"),
      health("magpie", "live"),
      health("inkprint", "asleep"),
      health("inkthread", "down"),
      health("slowquery", "asleep"),
    );
    expect(summarize(all, snap)).toEqual({
      total: 6,
      live: 2,
      asleep: 2,
      down: 1,
      unknown: 1,
      checking: 0,
    });
  });
});
