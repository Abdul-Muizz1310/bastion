import Link from "next/link";
import { auditPath } from "@/components/tools/receipt-text";
import { serial, shortRequest, utcDay, utcTime } from "../format";
import type { AuditEventView } from "../view";
import { ActorName, EventFacts } from "./EventFacts";

/**
 * The log as a roll of receipts (spec 21 §3.2): one line per event, newest first — serial, time,
 * service, action and entity, the known fields, the actor's pseudonym and the request's trail. On a
 * phone each line wraps into a short stack; from md up the lines align in columns.
 */

const COLUMNS =
  "md:grid md:grid-cols-[5rem_7.25rem_7rem_minmax(0,1fr)_10rem_8rem_6rem] md:items-baseline md:gap-x-4";

export function AuditRoll({ events }: { events: readonly AuditEventView[] }) {
  return (
    <div className="font-mono text-xs">
      <div
        aria-hidden="true"
        className={`hidden border-b border-border-bright px-4 pb-2 text-[11px] uppercase tracking-[0.16em] text-fg-muted ${COLUMNS}`}
      >
        <span>serial</span>
        <span>time · utc</span>
        <span>service</span>
        <span>action · entity</span>
        <span>result</span>
        <span>actor</span>
        <span className="text-right">trail</span>
      </div>
      {byDay(events).map((group) => (
        <section key={`${group.day}:${group.events[0]?.id}`} aria-label={`events on ${group.day}`}>
          <h3 className="flex items-center gap-3 px-4 pt-4 pb-1 text-[11px] uppercase tracking-[0.18em] text-fg-muted">
            <span aria-hidden="true" className="h-px w-6 bg-border-bright" />
            <span className="tabular-nums">{group.day}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border-bright" />
          </h3>
          <ol>
            {group.events.map((event) => (
              <AuditLine key={event.id} event={event} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** Consecutive events of one UTC day, in the order given. */
function byDay(events: readonly AuditEventView[]): { day: string; events: AuditEventView[] }[] {
  const groups: { day: string; events: AuditEventView[] }[] = [];
  for (const event of events) {
    const day = utcDay(event.at);
    const last = groups.at(-1);
    if (last?.day === day) last.events.push(event);
    else groups.push({ day, events: [event] });
  }
  return groups;
}

function AuditLine({ event }: { event: AuditEventView }) {
  return (
    <li
      data-event={event.id}
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dashed border-border-bright px-4 py-2.5 last:border-b-0 hover:bg-surface-hover ${COLUMNS}`}
    >
      <span translate="no" className="tabular-nums text-fg-muted">
        {serial(event.id)}
      </span>
      <time dateTime={event.at.toISOString()} className="tabular-nums text-foreground/90">
        {utcTime(event.at)}
      </time>
      <span translate="no" className="text-accent-violet">
        {event.service ?? <span className="text-fg-muted">no service</span>}
      </span>
      <span className="min-w-0 basis-full md:basis-auto">
        <span translate="no" className="text-foreground">
          {event.action}
        </span>{" "}
        <span className="text-fg-muted md:block">
          <span className="sr-only">on </span>
          {event.entity.type}{" "}
          {event.entity.href ? (
            <Link
              href={event.entity.href}
              translate="no"
              className="text-fg-muted underline decoration-dotted underline-offset-4 hover:text-accent-violet"
            >
              {event.entity.id.slice(0, 8)}
              <span className="sr-only"> (open the dossier)</span>
            </Link>
          ) : (
            <span translate="no" className="break-words">
              {event.entity.id}
            </span>
          )}
        </span>
      </span>
      <EventFacts facts={event.facts} />
      <span className="truncate">
        <span className="sr-only">by </span>
        <ActorName actor={event.actor} />
      </span>
      <span className="md:text-right">
        {event.requestId ? (
          <Link
            href={auditPath(event.requestId)}
            className="tabular-nums text-fg-muted underline decoration-dotted underline-offset-4 hover:text-accent-violet"
          >
            <span className="sr-only">request </span>
            <span translate="no">{shortRequest(event.requestId)}</span>
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
}
