import Link from "next/link";
import type { ReceiptTone } from "@/components/receipts/ReceiptCard";
import { auditPath } from "@/components/tools/receipt-text";
import type { Dossier } from "@/lib/db/schema";
import type { DossierReceiptView } from "../receipt-view";

/**
 * The top of a dossier (spec 21 §6.6): the claim as the page's heading, what the dossier is (status,
 * mode, when, what it read), and beside it the verdict slip — stamped once the debate has spoken.
 * Nothing that says who composed it. Rendered on the server.
 */

const STAMP: Readonly<Record<NonNullable<Dossier["verdict"]>, ReceiptTone>> = {
  TRUE: "pass",
  FALSE: "fail",
  INCONCLUSIVE: "neutral",
};

const STAMP_CLASS: Readonly<Record<ReceiptTone, string>> = {
  pass: "text-success",
  fail: "text-accent-rose",
  neutral: "text-warning",
};

const STATUS_WORDS: Readonly<Record<Dossier["status"], string>> = {
  pending: "queued",
  running: "running",
  succeeded: "sealed",
  failed: "stopped",
};

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

export function DossierHeader({ dossier, view }: { dossier: Dossier; view: DossierReceiptView }) {
  const confidence = confidenceOf(dossier);
  const certified = view.evidence.filter((e) => e.certificateId !== null).length;
  const lines: [string, string][] = [
    ["status", STATUS_WORDS[dossier.status]],
    ["confidence", confidence === null ? "—" : `${Math.round(confidence * 100)} %`],
    ["evidence", `${view.evidence.length} items · ${certified} certified`],
    ["documents", view.documents.length === 0 ? "none" : `${view.documents.length} PDF`],
    ["envelope", dossier.envelopeId === null ? "not sealed" : dossier.envelopeId.slice(0, 8)],
    ["mode", dossier.mode],
  ];
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

      <aside
        aria-label="the verdict"
        className="receipt-torn relative bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-xs"
      >
        <p className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          <span>verdict</span>
          <span translate="no" className="tracking-[0.08em] normal-case">
            #{dossier.id.slice(0, 8)}
          </span>
        </p>
        <div className="receipt-rule mt-3 pt-3">
          {dossier.verdict ? (
            <p
              data-tone={STAMP[dossier.verdict]}
              className={`receipt-stamp inline-block rounded-[3px] border-2 border-current px-3 py-1 font-display text-lg font-bold uppercase tracking-[0.18em] ${STAMP_CLASS[STAMP[dossier.verdict]]}`}
            >
              {dossier.verdict.toLowerCase()}
            </p>
          ) : (
            <p className="text-fg-muted">
              {dossier.status === "failed"
                ? "no verdict: the run stopped before the debate finished."
                : "no verdict yet: the debate has not finished."}
            </p>
          )}
        </div>
        <dl className="receipt-rule mt-4 space-y-1.5 pt-3">
          {lines.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="shrink-0 text-fg-muted">{label}</dt>
              <span
                aria-hidden="true"
                className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-border-bright"
              />
              <dd className="min-w-0 truncate text-right tabular-nums text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="receipt-rule mt-3 flex flex-wrap justify-between gap-x-4 gap-y-1 pt-3 text-[11px]">
          <Link
            href={auditPath(dossier.requestId)}
            className="text-fg-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-violet"
          >
            every call it made · audit trail<span aria-hidden="true"> →</span>
          </Link>
          {dossier.status === "succeeded" || dossier.status === "failed" ? (
            <a
              href="#verify-title"
              className="text-accent-violet underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
            >
              verify everything<span aria-hidden="true"> ↓</span>
            </a>
          ) : null}
        </p>
      </aside>
    </header>
  );
}
