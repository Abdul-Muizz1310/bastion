"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createQueryScheduler,
  positionToIso,
  type QueryScheduler,
  SLIDER_MAX,
  SLIDER_MIN,
} from "@/features/time-travel/controller";
import { createLoader } from "@/features/time-travel/load";
import { loadTimeTravelState } from "@/features/time-travel/server/query";
import type { TimeTravelView } from "@/features/time-travel/view";

export function TimeTravelSlider({ initial }: { initial: TimeTravelView }) {
  const [view, setView] = useState<TimeTravelView>(initial);
  const [position, setPosition] = useState(SLIDER_MAX);
  const [asOf, setAsOf] = useState(initial.asOf);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = view.bounds.min === null;
  const schedulerRef = useRef<QueryScheduler | null>(null);

  if (schedulerRef.current === null) {
    schedulerRef.current = createQueryScheduler({
      load: createLoader(loadTimeTravelState),
      onResult: (next) => {
        setError(null);
        setView(next);
      },
      onError: setError,
      onPending: setPending,
    });
  }

  // A drag left mid-flight when the user navigates away must not resolve into
  // an unmounted component.
  useEffect(() => () => schedulerRef.current?.cancel(), []);

  const onSlide = useCallback(
    (next: number) => {
      setPosition(next);
      const nextAsOf = positionToIso(next, view.bounds);
      setAsOf(nextAsOf);
      schedulerRef.current?.schedule(nextAsOf);
    },
    [view.bounds],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label
          htmlFor="time-slider"
          className="block font-mono text-xs uppercase tracking-[0.15em] text-fg-muted"
        >
          rewind to
        </label>
        <input
          id="time-slider"
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          value={position}
          disabled={disabled}
          onChange={(event) => onSlide(Number(event.target.value))}
          className="w-full accent-accent-violet disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="flex justify-between font-mono text-[11px] text-fg-faint">
          <span>{view.bounds.min ?? "no events"}</span>
          <span className="text-accent-violet">now</span>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background/40 p-4">
        <p className="font-mono text-xs text-fg-muted">
          <span className="text-accent-violet">as of</span> {asOf}
        </p>
        <p className="mt-1 font-mono text-[11px] text-fg-faint">
          SELECT DISTINCT ON (entity_type, entity_id) … WHERE created_at &lt;= $T
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-error/30 bg-error/5 px-4 py-2 font-mono text-xs text-error">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="font-mono text-xs text-fg-muted">
          {pending
            ? "querying…"
            : `${view.entities.length} ${view.entities.length === 1 ? "entity" : "entities"} at selected time`}
        </p>

        {view.entities.length === 0 ? (
          <div className="rounded-lg border border-border bg-background/40 p-6 text-center">
            <p className="font-mono text-sm text-fg-faint">
              {view.message ?? "No entities at this timestamp."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            {view.entities.map((entity) => (
              <div
                key={`${entity.entityType}:${entity.entityId}`}
                className="grid grid-cols-[7rem_1fr_9rem] gap-2 border-b border-border px-4 py-2.5 font-mono text-xs last:border-b-0"
              >
                <span className="text-accent-violet">{entity.entityType}</span>
                <span className="truncate text-foreground">{entity.entityId}</span>
                <span className="truncate text-fg-muted">{entity.lastAction}</span>
              </div>
            ))}
          </div>
        )}

        {view.message && view.entities.length > 0 ? (
          <p className="font-mono text-[11px] text-fg-faint">{view.message}</p>
        ) : null}
      </div>
    </div>
  );
}
