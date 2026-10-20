import { describe, expect, it, vi } from "vitest";
import { POLL_MS } from "@/dossier/stages";
import { requiredServices, WAKE_DEADLINE_MS, wakeStage } from "@/dossier/stages/wake";
import type { Health } from "@/platform/registry/health";
import type { ServiceId } from "@/platform/registry/products";
import { dossier, stageCtx } from "./helpers";

function health(service: ServiceId, state: Health["state"]): Health {
  return { service, state, latencyMs: 1, checkedAt: "2026-10-20T10:00:00Z" };
}

function deps(states: Partial<Record<ServiceId, Health["state"]>>, hasDocuments = false) {
  const probe = vi.fn(async (service: ServiceId) => health(service, states[service] ?? "live"));
  return { probe, hasDocuments: async () => hasDocuments };
}

describe("requiredServices", () => {
  it("is inkprint and paper-trail alone for a bare claim", () => {
    expect(requiredServices([], false)).toEqual(["inkprint", "paper-trail"]);
  });
  it("adds magpie with sources and inkthread with documents", () => {
    expect(requiredServices(["hn"], true)).toEqual(["inkprint", "paper-trail", "magpie", "inkthread"]);
  });
});

describe("wake stage", () => {
  it("is ok when every required service is live, probing with 8 s", async () => {
    const d = deps({});
    const out = await wakeStage(d)(stageCtx({ dossier: dossier({ sources: ["hn"] }) }));
    expect(out).toEqual({ kind: "ok", output: { live: ["inkprint", "paper-trail", "magpie"] } });
    expect(d.probe).toHaveBeenCalledWith("inkprint", 8_000);
    expect(d.probe).not.toHaveBeenCalledWith("inkthread", expect.anything());
  });

  it("probes inkthread only when the dossier has documents", async () => {
    const d = deps({}, true);
    await wakeStage(d)(stageCtx());
    expect(d.probe).toHaveBeenCalledWith("inkthread", 8_000);
  });

  it("waits, reporting who is live and who is asleep", async () => {
    const out = await wakeStage(deps({ inkprint: "asleep" }))(stageCtx());
    expect(out).toEqual({
      kind: "waiting",
      output: { live: ["paper-trail"], asleep: ["inkprint"] },
      retryInMs: POLL_MS,
    });
  });

  it("errors at 90 s from the attempt's start with the asleep service", async () => {
    const startedAt = new Date("2026-10-20T10:00:00.000Z");
    const handler = wakeStage(deps({ inkprint: "down" }));
    const early = await handler(
      stageCtx({ startedAt, now: new Date(startedAt.getTime() + WAKE_DEADLINE_MS - 1) }),
    );
    expect(early.kind).toBe("waiting");
    const late = await handler(
      stageCtx({ startedAt, now: new Date(startedAt.getTime() + WAKE_DEADLINE_MS) }),
    );
    expect(late).toEqual({ kind: "error", error: "service_asleep:inkprint", retryable: true });
  });

  it("a retry (attempt 2) with an old previous output gets a full 90 s from its own start (Ruling Q)", async () => {
    const startedAt = new Date("2026-10-20T10:10:00.000Z");
    const out = await wakeStage(deps({ inkprint: "asleep" }))(
      stageCtx({
        attempt: 2,
        startedAt,
        now: new Date(startedAt.getTime() + 3_000),
        outputs: { wake: { since: "2026-10-20T10:00:00.000Z", live: [], asleep: ["inkprint"] } },
      }),
    );
    expect(out.kind).toBe("waiting");
  });

  it("never fails or waits on slowquery", async () => {
    const d = deps({ slowquery: "down" });
    expect((await wakeStage(d)(stageCtx())).kind).toBe("ok");
    const probe = vi.fn(async (s: ServiceId) => {
      if (s === "slowquery") throw new Error("boom");
      return health(s, "live");
    });
    expect((await wakeStage({ probe, hasDocuments: async () => false })(stageCtx())).kind).toBe("ok");
  });
});
