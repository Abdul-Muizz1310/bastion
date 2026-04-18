import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { queryTraceFor } from "@/features/audit/server/query";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import type { Event as EventRow } from "@/lib/db/schema";

function formatMsDelta(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusColor(action: string): string {
  if (action.endsWith(".error")) return "text-error";
  if (action.endsWith(".ok")) return "text-success";
  if (action.startsWith("security.")) return "text-warning";
  return "text-accent-violet";
}

export default async function TracePage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;

  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    redirect(`/login?returnTo=${encodeURIComponent(`/audit/${requestId}`)}`);
  }

  const events = await queryTraceFor(session, requestId);
  if (events.length === 0) {
    notFound();
  }

  const first = new Date(events[0].createdAt);
  const last = new Date(events[events.length - 1].createdAt);
  const totalMs = last.getTime() - first.getTime();

  const services = Array.from(
    new Set(events.map((e: EventRow) => e.service).filter((s): s is string => Boolean(s))),
  );

  return (
    <PageFrame
      active="audit"
      statusLeft={`trace · ${requestId.slice(0, 8)}`}
      statusRight={`${events.length} events · ${formatMsDelta(totalMs)}`}
    >
      <div className="space-y-6">
        <div>
          <Link
            href="/audit"
            className="inline-block font-mono text-xs text-fg-muted transition-colors hover:text-accent-violet"
          >
            ← back to audit log
          </Link>
          <p className="mt-3 font-mono text-xs text-fg-faint">{"// trace"}</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            request <span className="text-accent-violet">{requestId.slice(0, 8)}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-fg-muted">
            <span>
              duration · <span className="text-foreground">{formatMsDelta(totalMs)}</span>
            </span>
            <span>events · {events.length}</span>
            <span>
              services · <span className="text-accent-violet">{services.join(", ") || "—"}</span>
            </span>
          </div>
        </div>

        <TerminalWindow title="$ trace waterfall" status="green">
          <div className="space-y-1 font-mono text-sm">
            {events.map((e: EventRow, idx: number) => {
              const delta = new Date(e.createdAt).getTime() - first.getTime();
              const metaLatency =
                typeof (e.metadata as Record<string, unknown>)?.latencyMs === "number"
                  ? ((e.metadata as Record<string, unknown>).latencyMs as number)
                  : null;
              return (
                <div
                  key={e.id}
                  className="grid grid-cols-[5rem_6rem_1fr_5rem] items-center gap-3 border-b border-border/60 py-2 last:border-b-0"
                >
                  <span className="font-mono text-[11px] text-fg-faint">
                    +{formatMsDelta(delta)}
                  </span>
                  <span className="font-mono text-xs text-accent-violet">{e.service ?? "—"}</span>
                  <span className={`font-mono text-sm ${statusColor(e.action)}`}>
                    {e.action}
                    {idx === 0 ? (
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-fg-faint">
                        · start
                      </span>
                    ) : null}
                  </span>
                  <span className="text-right font-mono text-[11px] text-fg-muted">
                    {metaLatency !== null ? `${metaLatency}ms` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
