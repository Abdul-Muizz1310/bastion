import Link from "next/link";
import type { Dossier } from "@/lib/db/schema";
import type { DossierReceiptView } from "../receipt-view";
import type { SlipFacts } from "../slip-view";
import { VerdictSlip } from "./VerdictSlip";

/**
 * The top of a dossier (spec 21 §6.6): the claim as the page's heading, what the dossier is (status,
 * mode, when, what it read), and beside it the verdict slip — stamped once the debate has spoken.
 * Nothing that says who composed it. Rendered on the server.
 */

const WHEN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function confidenceOf(d: Pick<Dossier, "confidence">): number | null {
  if (d.confidence === null) return null;
  const n = Number(d.confidence);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

/** The slip's facts as the server read them (the live island may move some on). */
export function slipFacts(dossier: Dossier, view: DossierReceiptView): SlipFacts {
  return {
    id: dossier.id,
    status: dossier.status,
    verdict: dossier.verdict,
    confidence: confidenceOf(dossier),
    evidence: {
      items: view.evidence.length,
      certified: view.evidence.filter((e) => e.certificateId !== null).length,
    },
    documents: view.documents.length,
    envelopeId: dossier.envelopeId,
    mode: dossier.mode,
  };
}

export function DossierHeader({ dossier, view }: { dossier: Dossier; view: DossierReceiptView }) {
  return (
    <header className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
      <div className="min-w-0">
        <p className="font-mono text-xs text-fg-muted">
          <Link href="/dossier" className="transition-colors hover:text-accent-violet">
            ~/dossier
          </Link>{" "}
          <span aria-hidden="true" className="text-accent-violet">
            $
          </span>{" "}
          <span aria-hidden="true" translate="no">
            open {dossier.id.slice(0, 8)}
          </span>
        </p>
        <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-fg-muted">
          the claim
        </p>
        <h1 className="mt-2 font-display text-[1.65rem] leading-[1.2] font-bold tracking-[-0.01em] break-words text-pretty sm:text-[2.1rem]">
          {dossier.claim}
        </h1>
        <dl className="mt-6 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs">
          <div className="flex gap-2">
            <dt className="text-fg-muted">composed</dt>
            <dd className="tabular-nums">{WHEN.format(dossier.createdAt)} UTC</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">web sources</dt>
            <dd translate="no">
              {dossier.sources.length === 0 ? "none" : dossier.sources.join(" · ")}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-fg-muted">dossier</dt>
            <dd translate="no" className="break-all">
              {dossier.id}
            </dd>
          </div>
        </dl>
      </div>

      <VerdictSlip facts={slipFacts(dossier, view)} requestId={dossier.requestId} />
    </header>
  );
}
