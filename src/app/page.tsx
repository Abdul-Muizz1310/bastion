import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/terminal/PageFrame";
import { RecentDossiers } from "@/features/dossier/components/RecentDossiers";
import { listRecentDossiers } from "@/features/dossier/server/query";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  // Request-time, never prerendered at build: the list is live data. (In v1 the session
  // cookie made this page dynamic; with no sign-in, connection() has to say so.)
  await connection();
  // Public (spec 21 §2): every visitor sees the same recent dossiers.
  const recent = await listRecentDossiers(null, 8);

  return (
    <PageFrame active="home" statusRight={`${recent.length} recent dossiers`}>
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// bastion // dossier console"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
            initiate a <span className="text-accent-violet">dossier</span>
          </h1>
          <p className="mt-3 max-w-2xl font-mono text-sm text-fg-muted">
            The dossier pipeline produces a cryptographically sealed, auditable artifact from a
            claim you define. Every piece of evidence is signed, every debate citation is pinned,
            every audit event is appended. The output is a time-sealed receipt you can verify months
            later.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Step index={1} title="gather" description="magpie scrapes selected sources live" />
          <Step index={2} title="seal" description="inkprint signs every evidence item" />
          <Step
            index={3}
            title="adjudicate"
            description="paper-trail debates with grounded citations"
          />
        </div>

        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fg-muted">
            <span className="text-accent-violet">&gt;</span> recent dossiers
          </p>
          <RecentDossiers dossiers={recent} />
        </div>
      </div>
    </PageFrame>
  );
}

function Step({
  index,
  title,
  description,
}: {
  index: number;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/60 p-4 transition-colors hover:border-accent-violet/30">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
        step 0{index}
      </p>
      <p className="mt-1 font-mono text-sm font-semibold text-accent-violet">{title}</p>
      <p className="mt-1 font-mono text-xs text-fg-muted">{description}</p>
    </div>
  );
}
