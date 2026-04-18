import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { queryAuditFor } from "@/features/audit/server/query";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import type { Event as EventRow } from "@/lib/db/schema";

const SERVICE_FILTERS = [
  "all",
  "bastion",
  "magpie",
  "inkprint",
  "paper-trail",
  "slowquery",
] as const;

function formatTimeAgo(createdAt: Date): string {
  const deltaMs = Date.now() - createdAt.getTime();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function shortActor(actorId: string | null): string {
  if (!actorId) return "system";
  return actorId.slice(0, 8);
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; action?: string; since?: string }>;
}) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    redirect("/login?returnTo=%2Faudit");
  }

  const { service, action, since } = await searchParams;
  const normalizedService = service && service !== "all" ? service : undefined;
  const sinceDate = since ? new Date(since) : undefined;

  const rows = await queryAuditFor(session, {
    service: normalizedService,
    actionPrefix: action,
    since: sinceDate,
  });

  const activeService = service ?? "all";

  return (
    <PageFrame
      active="audit"
      statusLeft={`audit · ${rows.length} events`}
      statusRight={`role · ${session.user.role}`}
    >
      <div className="space-y-6">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// audit_log"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Audit <span className="text-accent-violet">Log</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Append-only cross-service event log.
            {session.user.role === "viewer" ? (
              <>
                {" "}
                <span className="text-accent-violet">(scoped to your events)</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {SERVICE_FILTERS.map((f) => {
            const selected = f === activeService;
            const href = f === "all" ? "/audit" : `/audit?service=${encodeURIComponent(f)}`;
            return (
              <Link
                key={f}
                href={href}
                className={`rounded-md border px-3 py-1 font-mono text-xs transition-colors ${
                  selected
                    ? "border-accent-violet/40 bg-accent-violet-soft text-accent-violet"
                    : "border-border bg-background/60 text-fg-muted hover:border-border-bright"
                }`}
              >
                {f}
              </Link>
            );
          })}
        </div>

        <TerminalWindow title="$ bastion audit tail" status="green">
          {rows.length === 0 ? (
            <p className="py-8 text-center font-mono text-sm text-fg-faint">
              no events match these filters
            </p>
          ) : (
            <div className="overflow-hidden">
              <div className="grid grid-cols-[3rem_1fr_7rem_6rem_5rem] gap-2 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-[0.15em] text-fg-faint">
                <span>#</span>
                <span>action</span>
                <span>actor</span>
                <span>service</span>
                <span>time</span>
              </div>
              {rows.map((e: EventRow) => (
                <AuditRow key={e.id} event={e} />
              ))}
            </div>
          )}
        </TerminalWindow>

        <p className="text-center font-mono text-[11px] text-fg-faint">
          append-only · INSERT only at DB level · no UPDATE or DELETE
        </p>
      </div>
    </PageFrame>
  );
}

function AuditRow({ event }: { event: EventRow }) {
  const body = (
    <div className="grid grid-cols-[3rem_1fr_7rem_6rem_5rem] gap-2 border-b border-border px-4 py-2.5 font-mono text-sm transition-colors last:border-b-0 hover:bg-surface-hover">
      <span className="text-fg-faint">{event.id}</span>
      <span className="text-foreground">{event.action}</span>
      <span className="text-fg-muted">{shortActor(event.actorId)}</span>
      <span className="text-accent-violet">{event.service ?? "—"}</span>
      <span className="text-fg-faint">{formatTimeAgo(new Date(event.createdAt))}</span>
    </div>
  );
  if (event.requestId) {
    return (
      <Link href={`/audit/${event.requestId}`} className="block hover:bg-surface-hover">
        {body}
      </Link>
    );
  }
  return body;
}
