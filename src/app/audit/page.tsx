import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { PageFrame } from "@/components/terminal/PageFrame";
import { AppendOnly } from "@/features/audit/components/AppendOnly";
import { AuditFilterForm } from "@/features/audit/components/AuditFilterForm";
import { AuditRoll } from "@/features/audit/components/AuditRoll";
import { ReadLimited } from "@/features/audit/components/ReadLimited";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_SERVICES,
  type AuditFilters,
  auditHref,
  type FilterProblem,
  hasFilters,
  type SearchParams,
} from "@/features/audit/filters";
import { serial } from "@/features/audit/format";
import { type AuditState, loadAudit } from "@/features/audit/load";
import type { AuditPage as Page } from "@/features/audit/view";

export const metadata: Metadata = { title: "audit log" };

/**
 * `/audit` (spec 21 §3.2): the open, append-only log. Every visitor reads every event — nothing is
 * scoped to who is looking — newest first, 50 a page, filtered by service, action prefix and
 * request id. Rendered per request.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const state = await loadAudit(await searchParams);
  const filters = state.kind === "refused" ? {} : state.query.filters;

  return (
    <PageFrame active="audit" statusLeft={statusLeft(state)} statusRight="append-only · public">
      <div className="space-y-12">
        <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,23rem)] lg:items-start">
          <header className="min-w-0">
            <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
              ~/muizz-lab/bastion <span className="text-accent-violet">$</span> tail -f audit.log
            </p>
            <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
              audit log
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-fg-muted text-pretty">
              <span className="text-foreground">
                Everything bastion did, for anyone, in the order it happened.
              </span>{" "}
              Every gateway call and every step of every dossier lands here with its service, status
              and time — and the visitor behind it as a daily pseudonym, never an address. Everyone
              reads the same log. Open a request to see its waterfall across services, or{" "}
              <Link
                href="/time-travel"
                className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
              >
                rewind it
              </Link>{" "}
              to any moment.
            </p>
          </header>
          <AppendOnly />
        </div>

        <section aria-labelledby="filters-title" className="space-y-3">
          <h2 id="filters-title" className="sr-only">
            filters
          </h2>
          <AuditFilterForm filters={filters} />
        </section>

        <section aria-labelledby="roll-title">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2
              id="roll-title"
              className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted"
            >
              <span aria-hidden="true" className="text-accent-violet">
                ▚{" "}
              </span>
              the roll
            </h2>
            <p className="font-mono text-xs text-fg-muted">
              newest first · {AUDIT_PAGE_SIZE} a page
              {state.kind !== "refused" && hasFilters(state.query.filters)
                ? ` · ${describeFilters(state.query.filters)}`
                : ""}
            </p>
          </div>
          <div className="mt-4">
            <Roll state={state} />
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function statusLeft(state: AuditState): string {
  if (state.kind !== "ok") return "audit";
  const { events } = state.page;
  const first = events[0];
  const last = events.at(-1);
  return first && last
    ? `audit · ${events.length} events · ${serial(first.id)}–${serial(last.id)}`
    : "audit · 0 events";
}

function describeFilters(filters: AuditFilters): string {
  return [
    filters.service === undefined ? null : `service ${filters.service}`,
    filters.action === undefined ? null : `action ${filters.action}`,
    filters.request === undefined ? null : `request ${filters.request}`,
  ]
    .filter((s): s is string => s !== null)
    .join(" · ");
}

function Roll({ state }: { state: AuditState }) {
  switch (state.kind) {
    case "refused":
      return <Refused problems={state.problems} />;
    case "limited":
      return <ReadLimited retryAfterS={state.retryAfterS} limit={state.limit} />;
    case "unavailable":
      return (
        <Notice tone="error" title="the log is unavailable right now">
          The database did not answer, so nothing could be read. Try again in a moment.
        </Notice>
      );
    case "ok":
      return <Paged page={state.page} filters={state.query.filters} before={state.query.before} />;
    default:
      return assertNever(state);
  }
}

function Paged({
  page,
  filters,
  before,
}: {
  page: Page;
  filters: AuditFilters;
  before: number | null;
}) {
  const filtered = hasFilters(filters);
  if (page.events.length === 0) {
    return (
      <Notice
        tone="muted"
        title={
          before !== null
            ? `nothing older than ${serial(before)}`
            : filtered
              ? "no events match"
              : "no events yet"
        }
      >
        {filtered ? (
          <>
            Nothing in the log matches {describeFilters(filters)}.{" "}
            <Link
              href="/audit"
              className="text-accent-violet underline decoration-dotted underline-offset-4"
            >
              clear filters
            </Link>
          </>
        ) : before !== null ? (
          "This is past the start of the log."
        ) : (
          "The log is empty: nothing has called the gateway or run a dossier yet."
        )}
      </Notice>
    );
  }

  return (
    <div>
      <div
        className={`bg-surface pt-1 ${page.older === null ? "rounded-[var(--radius)]" : "receipt-torn rounded-t-[var(--radius)] pb-[var(--tear)]"}`}
      >
        <AuditRoll events={page.events} />
      </div>
      <nav
        aria-label="pages of the log"
        className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 font-mono text-xs"
      >
        <span>
          {before !== null ? (
            <Link
              href={auditHref(filters)}
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              <span aria-hidden="true">↑ </span>newest
            </Link>
          ) : null}
        </span>
        {page.older !== null ? (
          <Link
            href={auditHref(filters, page.older)}
            className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            older than {serial(page.older)}
            <span aria-hidden="true"> →</span>
          </Link>
        ) : (
          <span className="text-fg-muted">
            — {filtered ? "no older matching events" : "start of the log"} —
          </span>
        )}
      </nav>
    </div>
  );
}

const PROBLEM_WORDS: Readonly<Record<FilterProblem["reason"], string>> = {
  unknown: "is not a filter",
  repeated: "is given more than once",
  malformed: "is not a value the log accepts",
};

const ACCEPTS: Readonly<Record<string, string>> = {
  service: `one of ${AUDIT_SERVICES.join(", ")}`,
  action: "a prefix of lowercase letters, digits, dots, dashes and underscores, up to 64",
  request: "a whole request id: letters, digits and . _ : -, up to 128",
  before: "an event id",
};

function Refused({ problems }: { problems: readonly FilterProblem[] }) {
  return (
    <Notice tone="error" title="these filters were not applied">
      <ul className="mt-1 space-y-1">
        {problems.map((p) => (
          <li key={`${p.param}:${p.reason}`}>
            <code translate="no" className="text-foreground">
              {p.param}
            </code>{" "}
            {PROBLEM_WORDS[p.reason]}
            {p.reason === "unknown" ? (
              <span className="text-fg-muted">
                {" "}
                — the log filters by service, action and request
              </span>
            ) : ACCEPTS[p.param] ? (
              <span className="text-fg-muted"> — it takes {ACCEPTS[p.param]}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-3">
        Nothing was read.{" "}
        <Link
          href="/audit"
          className="text-accent-violet underline decoration-dotted underline-offset-4"
        >
          clear filters
        </Link>
      </p>
    </Notice>
  );
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "muted" | "error";
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-[var(--radius)] border px-5 py-4 font-mono text-xs leading-relaxed ${
        tone === "error" ? "border-error/40 bg-error/5" : "border-border bg-surface/50"
      }`}
    >
      <p className={tone === "error" ? "text-error" : "text-foreground"}>{title}</p>
      <div className="mt-1.5 text-fg-muted">{children}</div>
    </div>
  );
}

function assertNever(value: never): never {
  throw new TypeError(`audit: unexpected state ${JSON.stringify(value)}`);
}
