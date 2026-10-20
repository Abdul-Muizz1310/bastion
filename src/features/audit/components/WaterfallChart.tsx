import Link from "next/link";
import type { KnownFields } from "../known-fields";
import { axisTicks, formatDuration, type Waterfall } from "../waterfall";
import { ActorName, EventFacts } from "./EventFacts";

/**
 * One request's events on one time scale (spec 21 §3.2 `/audit/[requestId]`). Every fact a bar
 * draws is also written: the offset of its start, its duration and status. The bars and the axis
 * are decoration, hidden from assistive tech; nothing moves.
 */

const COLUMNS =
  "grid grid-cols-1 gap-y-1.5 md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)_10.5rem] md:items-center md:gap-x-5";

function barTone(facts: KnownFields): string {
  if (facts.error !== null || (facts.status !== null && facts.status >= 500)) return "bg-error";
  if (facts.status !== null && facts.status >= 400) return "bg-warning";
  return facts.ms === null ? "bg-accent-cyan" : "bg-accent-violet";
}

function Quarters() {
  return (
    <>
      {[25, 50, 75].map((p) => (
        <span
          key={p}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-border"
          style={{ left: `${p}%` }}
        />
      ))}
    </>
  );
}

export function WaterfallChart({ waterfall }: { waterfall: Waterfall }) {
  const ticks = axisTicks(waterfall.spanMs);
  return (
    <div className="font-mono text-xs">
      <div aria-hidden="true" className={`hidden px-4 pb-2 md:grid ${COLUMNS}`}>
        <span className="text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          start · service · action
        </span>
        <div className="relative h-4">
          {ticks.map((t) => (
            <span
              key={t.pct}
              className={`absolute top-0 whitespace-nowrap text-[11px] tabular-nums text-fg-muted ${
                t.pct === 100 ? "-translate-x-full" : t.pct === 0 ? "" : "-translate-x-1/2"
              }`}
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <span className="text-[11px] uppercase tracking-[0.16em] text-fg-muted">
          result · actor
        </span>
      </div>
      <ol aria-label="events, in the order they started" className="border-t border-border-bright">
        {waterfall.rows.map(({ event, offsetMs, durationMs, left, width }) => (
          <li
            key={event.id}
            data-event={event.id}
            className={`border-b border-dashed border-border-bright px-4 py-2.5 last:border-b-0 hover:bg-surface-hover ${COLUMNS}`}
          >
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="w-[4.75rem] shrink-0 tabular-nums text-fg-muted">
                <span className="sr-only">started at </span>+{formatDuration(offsetMs)}
              </span>
              <span translate="no" className="text-accent-violet">
                {event.service ?? "no service"}
              </span>
              <span translate="no" className="text-foreground">
                {event.action}
              </span>
              <span className="min-w-0 basis-full pl-[5.375rem] break-words text-fg-muted">
                {event.entity.type}{" "}
                {event.entity.href ? (
                  <Link
                    href={event.entity.href}
                    translate="no"
                    className="underline decoration-dotted underline-offset-4 hover:text-accent-violet"
                  >
                    {event.entity.id.slice(0, 8)}
                    <span className="sr-only"> (open the dossier)</span>
                  </Link>
                ) : (
                  <span translate="no">{event.entity.id}</span>
                )}
              </span>
            </div>
            <div aria-hidden="true" className="relative h-5">
              <Quarters />
              <span className="absolute inset-x-0 top-1/2 h-px bg-border" />
              {durationMs === null ? (
                <span
                  className={`absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-[1px] ${barTone(event.facts)}`}
                  style={{ left: `min(${left}%, calc(100% - 3px))` }}
                />
              ) : (
                <span
                  className={`absolute top-1/2 h-2 min-w-[3px] -translate-y-1/2 rounded-[1px] ${barTone(event.facts)}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 md:flex-col md:gap-y-0">
              <EventFacts facts={event.facts} />
              <span className="truncate text-[11px]">
                <span className="sr-only">by </span>
                <ActorName actor={event.actor} />
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
