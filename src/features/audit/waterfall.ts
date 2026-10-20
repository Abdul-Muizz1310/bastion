import type { AuditEventView } from "./view";

/**
 * One request's events on one time scale (spec 21 §3.2 `/audit/[requestId]`, invariant 5). The
 * gateway logs a call when it ends, so an event with a duration started that long before it was
 * logged; an event without one is an instant. Rows are ordered by start, ties by id; the span runs
 * from the earliest start to the latest end, and each bar is a share of it. Pure.
 */

export type WaterfallRow = {
  event: AuditEventView;
  /** From the request's first start to this event's start. */
  offsetMs: number;
  durationMs: number | null;
  /** Where the bar starts and how wide it is, in % of the span. */
  left: number;
  width: number;
};

export type Waterfall = {
  rows: WaterfallRow[];
  spanMs: number;
  startedAt: Date;
  endedAt: Date;
  /** The services touched, in order of first start, once each. */
  services: string[];
  /** The dossiers the request belongs to (uuid entity ids), once each. */
  dossiers: string[];
};

const PRECISION = 1e4;

/** A share of the span, in %, rounded so that float noise never pushes a bar past 100. */
function pct(part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.round((part / whole) * 100 * PRECISION) / PRECISION;
}

export function waterfall(events: readonly AuditEventView[]): Waterfall {
  if (events.length === 0) throw new RangeError("waterfall: a request with no events");

  const timed = events.map((event) => {
    const end = event.at.getTime();
    const durationMs = event.facts.ms;
    return { event, start: end - (durationMs ?? 0), end, durationMs };
  });
  timed.sort((a, b) => a.start - b.start || a.event.id - b.event.id);

  const first = Math.min(...timed.map((t) => t.start));
  const last = Math.max(...timed.map((t) => t.end));
  const spanMs = last - first;

  const rows = timed.map(({ event, start, end, durationMs }) => {
    const left = pct(start - first, spanMs);
    const width = Math.min(pct(end - start, spanMs), 100 - left);
    return { event, offsetMs: start - first, durationMs, left, width };
  });

  const services: string[] = [];
  const dossiers: string[] = [];
  for (const { event } of rows) {
    if (event.service !== null && !services.includes(event.service)) services.push(event.service);
    if (event.entity.href !== null && !dossiers.includes(event.entity.id)) {
      dossiers.push(event.entity.id);
    }
  }

  return {
    rows,
    spanMs,
    startedAt: new Date(first),
    endedAt: new Date(last),
    services,
    dossiers,
  };
}

/** A duration as the audit pages write it: ms, then seconds, minutes, hours, then days. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(`formatDuration: not a duration: ${ms}`);
  }
  if (ms < 1000) return `${Math.floor(ms)} ms`;
  if (ms < 60_000) return `${(Math.floor(ms / 10) / 100).toFixed(2)} s`;
  const seconds = Math.floor(ms / 1000);
  if (ms < 3_600_000) {
    return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, "0")} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (ms < 86_400_000) {
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${Math.floor(hours / 24)} d ${String(hours % 24).padStart(2, "0")} h`;
}

/** The axis: the start, the quarters and the end of the span (one tick when it has none). */
export function axisTicks(spanMs: number): { pct: number; label: string }[] {
  if (spanMs === 0) return [{ pct: 0, label: formatDuration(0) }];
  return [0, 25, 50, 75, 100].map((p) => ({ pct: p, label: formatDuration((spanMs * p) / 100) }));
}
