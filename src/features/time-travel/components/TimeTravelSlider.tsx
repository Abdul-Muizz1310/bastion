"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auditPath } from "@/components/tools/receipt-text";
import { ActorName, EventFacts } from "@/features/audit/components/EventFacts";
import { shortRequest, utcDay, utcTime } from "@/features/audit/format";
import { formatDuration } from "@/features/audit/waterfall";
import {
  createQueryScheduler,
  positionToIso,
  type QueryScheduler,
  SLIDER_MAX,
  SLIDER_MIN,
} from "@/features/time-travel/controller";
import { createLoader } from "@/features/time-travel/load";
import { loadTimeTravelState } from "@/features/time-travel/server/query";
import {
  type TimeTravelEntityView,
  type TimeTravelView,
  typeCounts,
} from "@/features/time-travel/view";

/**
 * The time-travel dial (spec 07, spec 21 §3.2): drag to a moment and every entity the log holds is
 * rebuilt from its latest event at or before it — one DISTINCT ON query per settled drag (300 ms,
 * latest wins). The list narrows by entity type here, without a query. Nothing animates.
 */

const LINK =
  "underline decoration-dotted underline-offset-4 hover:text-accent-violet motion-safe:transition-colors";

function stamp(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return { day: utcDay(d), time: utcTime(d, false) };
}

export function TimeTravelSlider({ initial }: { initial: TimeTravelView }) {
  const [view, setView] = useState<TimeTravelView>(initial);
  const [position, setPosition] = useState(SLIDER_MAX);
  const [asOf, setAsOf] = useState(initial.asOf);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);

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

  // A drag left mid-flight when the visitor navigates away must not resolve into an unmounted
  // component.
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

  const counts = useMemo(() => typeCounts(view.entities), [view.entities]);
  // A chosen type that has nothing at this moment stays offered (at 0), so it can be cleared.
  const chips =
    type !== null && !counts.some((c) => c.type === type)
      ? [...counts, { type, count: 0 }]
      : counts;
  const shown = type === null ? view.entities : view.entities.filter((e) => e.entityType === type);
  const at = stamp(asOf);
  const atNow = position === SLIDER_MAX;
  const earliest = view.bounds.min === null ? null : stamp(view.bounds.min);

  return (
    <div className="space-y-8">
      <div className="rounded-[var(--radius)] border border-border bg-background/70 p-5 md:p-6">
        <label
          htmlFor="time-slider"
          className="block font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted"
        >
          rewind to
        </label>
        <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums sm:text-[2rem]">
          <time dateTime={asOf}>
            {at.day} <span className="text-accent-violet">·</span> {at.time}{" "}
            <span className="font-mono text-sm font-normal text-fg-muted">UTC</span>
          </time>
          {atNow && !disabled ? (
            <span className="ml-3 align-middle font-mono text-xs font-normal text-success">
              now
            </span>
          ) : null}
        </p>
        <input
          id="time-slider"
          type="range"
          min={SLIDER_MIN}
          max={SLIDER_MAX}
          value={position}
          disabled={disabled}
          aria-valuetext={`${at.day}, ${at.time} UTC`}
          onChange={(event) => onSlide(Number(event.target.value))}
          className="mt-5 h-6 w-full cursor-pointer accent-accent-violet disabled:cursor-not-allowed disabled:opacity-40"
        />
        <div className="mt-1 flex justify-between gap-4 font-mono text-[11px] tabular-nums text-fg-muted">
          <span>
            {earliest === null ? "no events yet" : `first event · ${earliest.day} ${earliest.time}`}
          </span>
          <span>now</span>
        </div>
        <p className="receipt-rule mt-5 pt-4 font-mono text-[11px] leading-relaxed text-fg-muted">
          <span className="text-accent-violet">SELECT DISTINCT ON</span> (entity_type, entity_id) …{" "}
          <span className="text-accent-violet">WHERE</span> created_at &lt;= $T{" "}
          <span className="text-accent-violet">ORDER BY</span> entity_type, entity_id, created_at
          DESC
        </p>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-error/40 bg-error/5 px-4 py-2 font-mono text-xs text-error"
        >
          {error}
        </p>
      ) : null}

      <section aria-labelledby="entities-title" className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2
            id="entities-title"
            className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted"
          >
            <span aria-hidden="true" className="text-accent-violet">
              ▚{" "}
            </span>
            what existed then
          </h2>
          <p aria-live="polite" className="font-mono text-xs text-fg-muted">
            {pending
              ? "reconstructing…"
              : type === null
                ? `${view.entities.length} ${view.entities.length === 1 ? "entity" : "entities"} at this moment`
                : `${shown.length} of ${view.entities.length} entities at this moment`}
          </p>
        </div>

        {chips.length > 0 ? (
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0 font-mono text-xs">
            <legend className="sr-only">show one entity type</legend>
            <TypeChip pressed={type === null} onPress={() => setType(null)}>
              all types <span className="tabular-nums text-fg-muted">{view.entities.length}</span>
            </TypeChip>
            {chips.map((c) => (
              <TypeChip
                key={c.type}
                pressed={type === c.type}
                onPress={() => setType(type === c.type ? null : c.type)}
              >
                <span translate="no">{c.type}</span>{" "}
                <span className="tabular-nums text-fg-muted">{c.count}</span>
              </TypeChip>
            ))}
          </fieldset>
        ) : null}

        {view.truncated ? (
          <p className="font-mono text-xs text-warning">
            More entities existed at this moment than the replay keeps: these are the first 1000.
          </p>
        ) : null}

        <div aria-busy={pending} className={pending ? "opacity-60" : undefined}>
          {shown.length === 0 ? (
            <div className="rounded-[var(--radius)] border border-border bg-surface/50 px-5 py-6 font-mono text-xs text-fg-muted">
              {view.entities.length === 0
                ? (view.message ?? "No entities at this moment.")
                : `No ${type} entities at this moment.`}
            </div>
          ) : (
            <EntityList entities={shown} asOf={asOf} />
          )}
        </div>
        {view.message && view.entities.length > 0 ? (
          <p className="font-mono text-[11px] text-fg-muted">{view.message}</p>
        ) : null}
      </section>
    </div>
  );
}

function TypeChip({
  pressed,
  onPress,
  children,
}: {
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPress}
      className={`rounded-[calc(var(--radius)*0.6)] border px-3 py-1.5 motion-safe:transition-colors ${
        pressed
          ? "border-accent-violet/60 bg-accent-violet-soft text-accent-violet"
          : "border-border-bright text-foreground hover:border-fg-muted"
      }`}
    >
      {children}
    </button>
  );
}

const COLUMNS =
  "md:grid md:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.1fr)_9rem_8rem_5.5rem] md:items-baseline md:gap-x-4";

function EntityList({
  entities,
  asOf,
}: {
  entities: readonly TimeTravelEntityView[];
  asOf: string;
}) {
  const asOfMs = Date.parse(asOf);
  return (
    <div className="rounded-[var(--radius)] bg-surface pt-1 font-mono text-xs">
      <div
        aria-hidden="true"
        className={`hidden border-b border-border-bright px-4 pt-2 pb-2 text-[11px] uppercase tracking-[0.16em] text-fg-muted ${COLUMNS}`}
      >
        <span>type</span>
        <span>entity · service</span>
        <span>last event</span>
        <span>when</span>
        <span>actor</span>
        <span className="text-right">trail</span>
      </div>
      <ol aria-label="entities as they stood">
        {entities.map((e) => {
          const seen = Date.parse(e.lastEventAt);
          const ago = Number.isFinite(asOfMs - seen) ? Math.max(0, asOfMs - seen) : null;
          return (
            <li
              key={`${e.entityType}:${e.entityId}`}
              data-entity={`${e.entityType}:${e.entityId}`}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dashed border-border-bright px-4 py-2.5 last:border-b-0 ${COLUMNS}`}
            >
              <span
                translate="no"
                className="text-[11px] uppercase tracking-[0.14em] text-accent-cyan"
              >
                {e.entityType}
              </span>
              <span className="min-w-0 basis-full md:basis-auto">
                {e.href ? (
                  <Link href={e.href} translate="no" className={`text-foreground ${LINK}`}>
                    {e.entityId.slice(0, 8)}
                    <span className="sr-only"> (open the dossier)</span>
                  </Link>
                ) : (
                  <span translate="no" className="break-all text-foreground">
                    {e.entityId}
                  </span>
                )}{" "}
                <span translate="no" className="text-accent-violet">
                  {e.service ?? ""}
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span translate="no" className="text-foreground/90">
                  {e.lastAction}
                </span>
                <EventFacts facts={e.facts} />
              </span>
              <time dateTime={e.lastEventAt} className="tabular-nums text-fg-muted">
                {ago === null ? e.lastEventAt : `${formatDuration(ago)} before`}
              </time>
              <span className="truncate">
                <span className="sr-only">by </span>
                <ActorName actor={e.actor} />
              </span>
              <span className="md:text-right">
                {e.requestId ? (
                  <Link
                    href={auditPath(e.requestId)}
                    className={`tabular-nums text-fg-muted ${LINK}`}
                  >
                    <span className="sr-only">request </span>
                    <span translate="no">{shortRequest(e.requestId)}</span>
                    <span aria-hidden="true"> →</span>
                  </Link>
                ) : (
                  <span className="text-fg-muted">
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">no request id</span>
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
