import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { StepTimeline } from "@/features/dossier/components/StepTimeline";
import { VerifyButton } from "@/features/dossier/components/VerifyButton";
import type { DossierEvent, Verdict } from "@/features/dossier/schemas";
import { getDossier, listDossierEvents } from "@/features/dossier/server/query";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToEvent(row: {
  step: string;
  status: string;
  latencyMs: number | null;
  metadata: unknown;
  at: Date | string;
}): DossierEvent {
  return {
    step: row.step as DossierEvent["step"],
    status: row.status as DossierEvent["status"],
    latency_ms: row.latencyMs,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    at: row.at instanceof Date ? row.at.toISOString() : row.at,
  };
}

export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const dossier = await getDossier(id);
  if (!dossier) {
    notFound();
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  const canVerify =
    session !== null &&
    (session.user.role === "admin" ||
      session.user.role === "editor" ||
      (session.user.role === "viewer" && dossier.userId === session.user.id));

  const eventRows = await listDossierEvents(id);
  const initialEvents = eventRows.map(rowToEvent);

  const createdAtLabel =
    dossier.createdAt instanceof Date
      ? dossier.createdAt.toISOString().slice(0, 19).replace("T", " ")
      : String(dossier.createdAt);

  const confidenceNum =
    dossier.confidence !== null && dossier.confidence !== undefined
      ? Number.parseFloat(String(dossier.confidence))
      : null;

  return (
    <PageFrame
      active="dossiers"
      statusLeft={`dossier · ${id.slice(0, 8)}`}
      statusRight={`req · ${dossier.requestId.slice(0, 8)}`}
    >
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// dossier"}</p>
          <h1 className="mt-1 font-mono text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            {dossier.claim}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-fg-muted">
            <span>
              mode · <span className="text-accent-violet">{dossier.mode}</span>
            </span>
            <span>
              sources · <span className="text-foreground">{dossier.sources.join(", ")}</span>
            </span>
            <span>created · {createdAtLabel}Z</span>
          </div>
        </div>

        <TerminalWindow
          title="$ dossier timeline"
          status={
            dossier.status === "running" || dossier.status === "pending"
              ? "yellow"
              : dossier.status === "failed"
                ? "red"
                : "green"
          }
        >
          <StepTimeline
            dossierId={id}
            initialEvents={initialEvents}
            initialStatus={dossier.status}
            initialVerdict={(dossier.verdict as Verdict | null) ?? null}
            initialConfidence={confidenceNum}
          />
        </TerminalWindow>

        <TerminalWindow title="$ verify all signatures" status="green">
          <VerifyButton dossierId={id} canVerify={canVerify} />
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
