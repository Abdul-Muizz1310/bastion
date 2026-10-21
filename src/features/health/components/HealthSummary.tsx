"use client";

import { STATE_META, TONE_TEXT } from "@/components/platform/states";
import type { ServiceId } from "@/platform/registry/products";
import { summarize } from "../model";
import { useHealthPoll } from "./HealthProvider";

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const COUNTED = ["live", "asleep", "down", "unknown"] as const;

/** One line over the map: how many services are in which state, and when that was checked. */
export function HealthSummary({ serviceIds }: { serviceIds: readonly ServiceId[] }) {
  const { snapshot, intervalMs } = useHealthPoll();
  const counts = summarize(serviceIds, snapshot);

  if (snapshot.phase === "checking") {
    return (
      <p className="font-mono text-xs text-fg-muted">
        <span className="motion-safe:animate-pulse">checking {counts.total} services…</span>
      </p>
    );
  }
  if (snapshot.phase === "error") {
    return (
      <p className="font-mono text-xs text-warning">
        status unavailable · retrying every {Math.round(intervalMs / 1000)} s
      </p>
    );
  }

  const parts = COUNTED.filter((state) => counts[state] > 0);
  return (
    <p className="font-mono text-xs text-fg-muted tabular-nums">
      <span aria-live="polite">
        {counts.total} services:{" "}
        {parts.map((state, i) => (
          <span key={state}>
            {i > 0 ? " · " : null}
            <span className={TONE_TEXT[STATE_META[state].tone]}>
              {counts[state]} {STATE_META[state].label}
            </span>
          </span>
        ))}
      </span>{" "}
      · checked {CLOCK.format(new Date(snapshot.checkedAt))} UTC
    </p>
  );
}
