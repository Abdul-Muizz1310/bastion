import { type Health, probe } from "@/platform/registry/health";
import type { ServiceId } from "@/platform/registry/products";
import { listDocuments } from "../documents";
import { POLL_MS, type StageContext, type StageHandler, type StageOutcome } from "../stages";

/**
 * Stage `wake` (spec 21 §6.1): make sure the services the dossier needs are awake before the
 * expensive stages run. inkprint and paper-trail are always needed; magpie only with sources;
 * inkthread only with documents. slowquery is probed best-effort (never blocks, never fails).
 *
 * How a cold Render service wakes: the first request to it starts the boot, even if the caller gives
 * up on the answer. So each poll's 8 s `/health` probe is itself the kick; the stage then returns
 * `waiting` for POLL_MS and probes again. No separate fire-and-forget request is needed.
 *
 * The window is measured from `ctx.startedAt`, the start of the current attempt: polls keep it and a
 * retry (Ruling Q) resets it, so every attempt gets the full window. After WAKE_DEADLINE_MS the first service still not live is a
 * retryable `service_asleep:<id>` error.
 */

export const PROBE_MS = 8_000;
export const WAKE_DEADLINE_MS = 90_000;

export type WakeDeps = {
  probe: (service: ServiceId, timeoutMs: number) => Promise<Health>;
  hasDocuments: (dossierId: string) => Promise<boolean>;
};

export function requiredServices(sources: readonly string[], hasDocuments: boolean): ServiceId[] {
  const out: ServiceId[] = ["inkprint", "paper-trail"];
  if (sources.length > 0) out.push("magpie");
  if (hasDocuments) out.push("inkthread");
  return out;
}

export function wakeStage(deps: WakeDeps): StageHandler {
  return async (ctx: StageContext): Promise<StageOutcome> => {
    const required = requiredServices(ctx.dossier.sources, await deps.hasDocuments(ctx.dossier.id));
    const [results] = await Promise.all([
      Promise.all(required.map((id) => deps.probe(id, PROBE_MS))),
      // Best effort: the fleet's slowquery service is nudged awake but never waited on or failed on.
      deps.probe("slowquery", PROBE_MS).catch(() => null),
    ]);
    const live = required.filter((_, i) => results[i]?.state === "live");
    const asleep = required.filter((id) => !live.includes(id));
    if (asleep.length === 0) return { kind: "ok", output: { live } };
    if (ctx.now.getTime() - ctx.startedAt.getTime() >= WAKE_DEADLINE_MS) {
      return { kind: "error", error: `service_asleep:${asleep[0]}`, retryable: true };
    }
    return {
      kind: "waiting",
      output: { live, asleep },
      retryInMs: POLL_MS,
    };
  };
}

export const wake: StageHandler = wakeStage({
  probe,
  hasDocuments: async (id) => (await listDocuments(id)).length > 0,
});
