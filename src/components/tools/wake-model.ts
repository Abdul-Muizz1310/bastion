import type { DisplayState } from "@/features/health/model";
import type { WakeAnswer } from "@/features/tools/wake";
import type { ServiceId } from "@/platform/registry/products";

/**
 * A workbench's wake gate (spec 21 §5.1, Ruling F), the pure core: each of the product's services
 * goes checking → waking (the elapsed seconds count up) → the wake route's own answer. The product
 * is ready only when every service answered live. A failed wake request reads `unknown` — never a
 * guessed state — and every end but live offers a retry. Time comes in as `now` (ms).
 */

export type ServiceWake =
  | { phase: "checking" }
  | { phase: "waking"; startedAt: number }
  | { phase: "settled"; startedAt: number; answer: WakeAnswer };

export type WakeState = {
  readonly services: readonly ServiceId[];
  readonly byService: Readonly<Partial<Record<ServiceId, ServiceWake>>>;
};

export type GateRow = { service: ServiceId; state: DisplayState; detail?: string };

export type GateView = {
  /** Every service answered live: the actions may run. */
  ready: boolean;
  /** The product's state: waking while any wake runs, else the worst settled one. */
  state: DisplayState;
  rows: GateRow[];
  /** Nothing in flight and not ready: a retry is the only way on. */
  retry: boolean;
  /** One sentence for a polite live region; it changes with the phase, not every second. */
  announcement: string;
};

export function initialWake(services: readonly ServiceId[]): WakeState {
  if (new Set(services).size !== services.length) {
    throw new RangeError("wake gate: a service is listed twice");
  }
  const byService: Partial<Record<ServiceId, ServiceWake>> = {};
  for (const service of services) byService[service] = { phase: "checking" };
  return { services: [...services], byService };
}

function assertHeld(state: WakeState, service: ServiceId): void {
  if (!state.services.includes(service)) {
    throw new RangeError(`wake gate: ${service} is not one of this gate's services`);
  }
}

function withService(state: WakeState, service: ServiceId, wake: ServiceWake): WakeState {
  return { services: state.services, byService: { ...state.byService, [service]: wake } };
}

export function wakeStarted(state: WakeState, service: ServiceId, now: number): WakeState {
  assertHeld(state, service);
  return withService(state, service, { phase: "waking", startedAt: now });
}

export function wakeAnswered(
  state: WakeState,
  service: ServiceId,
  answer: WakeAnswer,
  now: number,
): WakeState {
  assertHeld(state, service);
  const current = state.byService[service];
  const startedAt = current?.phase === "waking" ? current.startedAt : now;
  return withService(state, service, { phase: "settled", startedAt, answer });
}

/**
 * Review fix 2: a call that finds the product asleep after the gate opened puts every service back
 * to waking — the gate closes again until the wake route says live.
 */
export function rewakeAll(state: WakeState, now: number): WakeState {
  return state.services.reduce((s, service) => wakeStarted(s, service, now), state);
}

const COLD_START_MS = 1_500;

function rowOf(service: ServiceId, wake: ServiceWake | undefined, now: number): GateRow {
  if (wake === undefined || wake.phase === "checking") return { service, state: "checking" };
  if (wake.phase === "waking") {
    const seconds = Math.max(0, Math.floor((now - wake.startedAt) / 1000));
    return { service, state: "waking", detail: `${seconds} s` };
  }
  const { answer } = wake;
  switch (answer.kind) {
    case "answer":
      switch (answer.state) {
        case "live":
          return {
            service,
            state: "live",
            detail:
              answer.latencyMs < COLD_START_MS
                ? `${Math.round(answer.latencyMs)} ms`
                : `woke in ${Math.round(answer.latencyMs / 1000)} s`,
          };
        case "asleep":
          return { service, state: "asleep", detail: "did not wake within 90 s" };
        case "down":
          return { service, state: "down", detail: "not answering" };
        default:
          return assertNever(answer.state);
      }
    case "rate_limited":
      return {
        service,
        state: "unknown",
        detail: `too many wakes · retry in ${answer.retryAfterS} s`,
      };
    case "failed":
      return { service, state: "unknown", detail: "the wake request failed" };
    default:
      return assertNever(answer);
  }
}

/** Worst first, for a product whose wakes have all ended. */
const SEVERITY: Readonly<Record<"down" | "unknown" | "asleep" | "live", number>> = {
  down: 0,
  unknown: 1,
  asleep: 2,
  live: 3,
};

function settledState(rows: readonly GateRow[]): "down" | "unknown" | "asleep" | "live" {
  let worst: keyof typeof SEVERITY = "live";
  for (const row of rows) {
    const state = row.state;
    if (state === "down" || state === "unknown" || state === "asleep" || state === "live") {
      if (SEVERITY[state] < SEVERITY[worst]) worst = state;
    }
  }
  return worst;
}

function announce(name: string, state: DisplayState): string {
  switch (state) {
    case "live":
      return `${name} is live. Its actions are enabled.`;
    case "waking":
      return `Waking ${name}. A free Render service takes about a minute.`;
    case "checking":
      return `Checking ${name}.`;
    case "asleep":
      return `${name} is still asleep. Try waking it again.`;
    case "down":
      return `${name} is down. Try again later.`;
    case "unknown":
      return `${name} could not be woken. Try again.`;
    default:
      return assertNever(state);
  }
}

export function gateView(state: WakeState, name: string, now: number): GateView {
  const rows = state.services.map((service) => rowOf(service, state.byService[service], now));
  let product: DisplayState;
  if (rows.some((r) => r.state === "waking")) product = "waking";
  else if (rows.some((r) => r.state === "checking")) product = "checking";
  else product = settledState(rows);
  const ready = product === "live";
  return {
    ready,
    state: product,
    rows,
    retry: !ready && product !== "waking" && product !== "checking",
    announcement: announce(name, product),
  };
}

function assertNever(value: never): never {
  throw new TypeError(`wake gate: unexpected ${JSON.stringify(value)}`);
}
