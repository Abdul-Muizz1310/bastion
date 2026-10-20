"use client";

import Link from "next/link";
import type { ReceiptTone } from "@/components/receipts/ReceiptCard";
import { auditPath } from "@/components/tools/receipt-text";
import { type SlipFacts, slipView } from "../slip-view";
import { useLiveDossier } from "./LiveDossier";

/**
 * The verdict slip (spec 21 §6.6, "The live card"): the stamp once the debate has spoken, the
 * confidence, and what the dossier holds. Rendered from the server's facts; inside the live island
 * it follows the stream, and a new stamp or status is announced politely.
 */

const STAMP_CLASS: Readonly<Record<ReceiptTone, string>> = {
  pass: "text-success",
  fail: "text-accent-rose",
  neutral: "text-warning",
};

export function VerdictSlip({ facts, requestId }: { facts: SlipFacts; requestId: string }) {
  const live = useLiveDossier();
  const view = slipView(facts, live?.following ? live.state : null);
  const status = view.lines.find(([label]) => label === "status")?.[1] ?? "";
  return (
    <aside
      aria-label="the verdict"
      className="receipt-torn relative bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-xs"
    >
      <p className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <span>verdict</span>
        <span translate="no" className="tracking-[0.08em] normal-case">
          #{facts.id.slice(0, 8)}
        </span>
      </p>
      <div className="receipt-rule mt-3 pt-3">
        {view.stamp ? (
          <p
            data-tone={view.stamp.tone}
            className={`receipt-stamp inline-block rounded-[3px] border-2 border-current px-3 py-1 font-display text-lg font-bold uppercase tracking-[0.18em] ${STAMP_CLASS[view.stamp.tone]}`}
          >
            {view.stamp.text}
          </p>
        ) : (
          <p className="text-fg-muted">{view.noVerdict}</p>
        )}
      </div>
      <dl className="receipt-rule mt-4 space-y-1.5 pt-3">
        {view.lines.map(([label, value]) => (
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
          href={auditPath(requestId)}
          className="text-fg-muted underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-violet"
        >
          every call it made · audit trail<span aria-hidden="true"> →</span>
        </Link>
        {view.verifyLink ? (
          <a
            href="#verify-title"
            className="text-accent-violet underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
          >
            verify everything<span aria-hidden="true"> ↓</span>
          </a>
        ) : null}
      </p>
      <p aria-live="polite" className="sr-only">
        {live?.following
          ? `the dossier is ${status}${view.stamp ? `; verdict ${view.stamp.text}` : ""}`
          : ""}
      </p>
    </aside>
  );
}
