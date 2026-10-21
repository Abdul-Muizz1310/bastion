import type { Metadata } from "next";
import { connection } from "next/server";
import { PageFrame } from "@/components/terminal/PageFrame";
import { STAGES } from "@/dossier/stages";
import { ComposeForm } from "@/features/dossier/components/ComposeForm";
import { STAGE_INFO } from "@/features/dossier/timeline-view";
import { BudgetProvider } from "@/features/tools/BudgetProvider";
import { loadBudgets } from "@/features/tools/load";
import { SITE } from "@/lib/site/config";
import { pageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = pageMetadata(SITE, "/dossier", {
  title: "compose a dossier",
  description:
    "Check one claim against the web and your PDFs. Each piece of evidence is signed, debated, measured and sealed into one envelope anyone can re-verify.",
});

/**
 * `/dossier` (spec 21 §3, §6.6): compose a dossier — a claim checked against web sources and PDFs.
 * Rendered per request with today's budgets (an unreadable budget store is not the page's failure:
 * the run button stays enabled and says so). The run itself happens at `/d/<id>`.
 */
export default async function ComposePage() {
  await connection();
  const budgets = await loadBudgets();

  return (
    <PageFrame active="dossier" statusRight="every dossier is public">
      <div className="space-y-14">
        <header className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center">
          <div className="min-w-0">
            <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
              ~/muizz-lab/bastion <span className="text-accent-violet">$</span> dossier --compose
            </p>
            <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
              compose a dossier
            </h1>
            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-fg-muted text-pretty">
              <span className="text-foreground">
                Check one claim against the web and your PDFs — and keep the receipt.
              </span>{" "}
              Every piece of evidence is scraped or read exactly, signed by inkprint, argued over by
              paper-trail, measured by slowquery and sealed into one envelope that anyone can
              re-verify at the dossier’s own URL.
            </p>
          </div>
          <aside
            aria-labelledby="stages-title"
            className="receipt-torn bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-xs"
          >
            <h2 id="stages-title" className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">
              what the run does
            </h2>
            <ol className="receipt-rule mt-3 space-y-1.5 pt-3">
              {STAGES.map((stage, i) => (
                <li key={stage} className="grid grid-cols-[1.75rem_4.5rem_minmax(0,1fr)] gap-x-1">
                  <span aria-hidden="true" className="tabular-nums text-fg-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-foreground">{stage}</span>
                  <span className="text-fg-muted">{STAGE_INFO[stage].does}</span>
                </li>
              ))}
            </ol>
          </aside>
        </header>

        <BudgetProvider initial={budgets}>
          <ComposeForm />
        </BudgetProvider>
      </div>
    </PageFrame>
  );
}
