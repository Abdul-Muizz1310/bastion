import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { PageFrame } from "@/components/terminal/PageFrame";
import { ReadLimited } from "@/features/audit/components/ReadLimited";
import { WaterfallChart } from "@/features/audit/components/WaterfallChart";
import { auditHref, REQUEST_ID, TRACE_LIMIT } from "@/features/audit/filters";
import { shortRequest, utcDay, utcTime } from "@/features/audit/format";
import { allowRead } from "@/features/audit/read-limit";
import { requestTrace } from "@/features/audit/server/query";
import { formatDuration, waterfall } from "@/features/audit/waterfall";

/**
 * `/audit/[requestId]` (spec 21 §3.2): one request's waterfall across services — every event that
 * carries the id, ordered by when it started, on one time scale. A malformed id or one with no
 * events is a 404. Rendered per request.
 */

type Params = Promise<{ requestId: string }>;

/**
 * Titled from the id alone: the title never reads the database. A trace is one request's log, not
 * a page anyone searches for, so it stays out of search; it still previews when shared.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { requestId } = await params;
  return { title: `request ${shortRequest(requestId)}`, robots: { index: false } };
}

export default async function TracePage({ params }: { params: Params }) {
  const { requestId } = await params;
  if (!REQUEST_ID.test(requestId)) notFound();
  await connection();
  const allowance = await allowRead("audit");
  if (!allowance.ok) return <Limited requestId={requestId} {...allowance} />;
  const trace = await requestTrace(requestId);
  if (trace.events.length === 0) notFound();

  const w = waterfall(trace.events);
  const count = trace.events.length;

  return (
    <PageFrame
      active="audit"
      statusLeft={`trace · ${shortRequest(requestId)}`}
      statusRight={`${count} events · ${formatDuration(w.spanMs)}`}
    >
      <div className="space-y-10">
        <header>
          <p className="font-mono text-xs text-fg-muted">
            <Link href="/audit" className="transition-colors hover:text-accent-violet">
              ~/audit
            </Link>{" "}
            <span aria-hidden="true" className="text-accent-violet">
              $
            </span>{" "}
            <span aria-hidden="true" translate="no">
              trace {shortRequest(requestId)}
            </span>
          </p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-fg-muted">
            one request, across services
          </p>
          <h1 className="mt-2 font-display text-[1.9rem] leading-[1.1] font-bold tracking-[-0.01em] sm:text-[2.5rem]">
            request{" "}
            <span translate="no" className="text-accent-violet">
              {shortRequest(requestId)}
            </span>
          </h1>
          <p translate="no" className="mt-2 font-mono text-xs break-all text-fg-muted">
            {requestId}
          </p>

          <dl className="mt-6 grid max-w-4xl grid-cols-2 gap-x-8 gap-y-3 font-mono text-xs sm:grid-cols-4">
            <Fact label="span">{formatDuration(w.spanMs)}</Fact>
            <Fact label="events">
              {count} events{trace.truncated ? ` (the first ${TRACE_LIMIT})` : ""}
            </Fact>
            <Fact label="started">
              <time dateTime={w.startedAt.toISOString()}>
                {utcDay(w.startedAt)} · {utcTime(w.startedAt)} UTC
              </time>
            </Fact>
            <Fact label="services">
              <span translate="no">
                {w.services.length === 0 ? "none" : w.services.join(" → ")}
              </span>
            </Fact>
          </dl>

          {w.dossiers.length > 0 ? (
            <p className="mt-6 font-mono text-xs text-fg-muted">
              this request ran{" "}
              {w.dossiers.map((id, i) => (
                <span key={id}>
                  {i > 0 ? ", " : null}
                  <Link
                    href={`/d/${id}`}
                    className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
                  >
                    dossier <span translate="no">{id.slice(0, 8)}</span>
                    <span aria-hidden="true"> →</span>
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </header>

        <section aria-labelledby="waterfall-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2
              id="waterfall-title"
              className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted"
            >
              <span aria-hidden="true" className="text-accent-violet">
                ▚{" "}
              </span>
              the waterfall
            </h2>
            <p className="max-w-xl font-mono text-xs text-fg-muted">
              a call is logged when it ends, so its bar runs back from there by its duration
            </p>
          </div>
          {trace.truncated ? (
            <p className="mt-3 font-mono text-xs text-warning">
              This request logged more than {TRACE_LIMIT} events; these are the first {TRACE_LIMIT}.
            </p>
          ) : null}
          <div className="mt-4 rounded-[var(--radius)] bg-surface pt-3">
            <WaterfallChart waterfall={w} />
          </div>
          <p className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs">
            <Link
              href={auditHref({ request: requestId })}
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              these events in the log<span aria-hidden="true"> →</span>
            </Link>
            <Link
              href="/audit"
              className="text-fg-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              the whole log
            </Link>
          </p>
        </section>
      </div>
    </PageFrame>
  );
}

/** Ruling AL: the visitor's reads are spent — say so, read nothing, keep the way back. */
function Limited({
  requestId,
  retryAfterS,
  limit,
}: {
  requestId: string;
  retryAfterS: number;
  limit: number;
}) {
  return (
    <PageFrame active="audit" statusLeft={`trace · ${shortRequest(requestId)}`}>
      <div className="space-y-8">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-fg-muted">
            one request, across services
          </p>
          <h1 className="mt-2 font-display text-[1.9rem] leading-[1.1] font-bold tracking-[-0.01em] sm:text-[2.5rem]">
            request{" "}
            <span translate="no" className="text-accent-violet">
              {shortRequest(requestId)}
            </span>
          </h1>
        </header>
        <ReadLimited retryAfterS={retryAfterS} limit={limit} />
        <p className="font-mono text-xs">
          <Link
            href="/audit"
            className="text-fg-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            the whole log
          </Link>
        </p>
      </div>
    </PageFrame>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">{label}</dt>
      <dd className="mt-1 tabular-nums text-foreground">{children}</dd>
    </div>
  );
}
