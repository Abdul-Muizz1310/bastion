"use client";

import { AuditLink } from "@/components/tools/AuditLink";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { BUTTON, BUTTON_QUIET } from "@/components/tools/styles";
import { CHECK_STATES, type Check, type CheckItem } from "@/dossier/checks";
import { documentAnchor, evidenceHref } from "../citations";
import { STATE_WORDS, useVerify } from "./verify-context";

/**
 * "Verify everything" (spec 21 §6.5, §6.6): re-checks every receipt live, without trusting bastion,
 * and shows every check it returns — `steps` included — each state written out (pass · fail ·
 * unavailable · expired; colour and glyph are never the only signal), its detail and its items. A
 * legacy dossier shows its honest note and no checks. Beside it, the receipts bundle to download.
 */

const CHECK_WHAT: Readonly<Record<Check["name"], string>> = {
  certificates: "each certificate re-checked with inkprint, its text against its signature",
  transcript: "the debate transcript re-fetched, re-hashed and its signature checked",
  envelope: "the envelope's signature and everything it names",
  perf: "the perf receipt recomputed from what is stored",
  audit: "the audit digest recomputed from bastion's append-only log",
  documents: "each document's graph re-fetched from inkthread",
  steps: "the runner's step rows, one per stage",
};

export function VerifyPanel({
  dossierId,
  evidenceKeys = {},
  documentIds = [],
}: {
  dossierId: string;
  /** Certificate id → the evidence key holding it, so an item links to its row. */
  evidenceKeys?: Readonly<Record<string, string>>;
  documentIds?: readonly string[];
}) {
  const { busy, outcome, run } = useVerify();
  const keyOf = (ref: string) => evidenceKeys[ref] ?? evidenceKeys[ref.toLowerCase()];
  const linkOf = (check: Check, item: CheckItem): string | null => {
    if (check.name === "certificates") {
      const key = keyOf(item.ref);
      return key === undefined ? null : evidenceHref(key);
    }
    if (check.name === "documents" && documentIds.includes(item.ref)) {
      return `#${documentAnchor(item.ref)}`;
    }
    return null;
  };

  return (
    <div className="space-y-5">
      <p className="max-w-3xl font-mono text-xs leading-relaxed text-fg-muted">
        Every signature and hash is checked again now against the service that issued it — inkprint,
        paper-trail, inkthread — and the perf and audit receipts are recomputed from bastion’s
        append-only log. Nothing is taken from this page. It takes up to two minutes when a service
        has to wake.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={busy}
          aria-busy={busy || undefined}
          className={BUTTON}
        >
          {busy ? "verifying…" : outcome?.ok ? "verify everything again" : "verify everything"}
        </button>
        <a
          href={`/api/dossiers/${dossierId}/receipts`}
          download={`dossier-${dossierId}.receipts.json`}
          className={BUTTON_QUIET}
        >
          download receipts
          <span aria-hidden="true"> ↓</span>
        </a>
      </div>
      <p aria-live="polite" className="sr-only">
        {busy
          ? "verifying every receipt…"
          : outcome === null
            ? ""
            : outcome.ok
              ? "the verification is ready"
              : "the verification did not come back"}
      </p>

      {outcome === null ? null : !outcome.ok ? (
        <OutcomeNotice failure={outcome} product="bastion" />
      ) : outcome.data.legacy ? (
        <p className="rounded-[3px] border border-border-bright px-4 py-3 font-mono text-xs text-foreground">
          {outcome.data.note}.{" "}
          <span className="text-fg-muted">
            It was made before bastion kept receipts, so there is nothing to re-check.
          </span>
        </p>
      ) : (
        <div className="space-y-3">
          <p className="font-mono text-xs text-foreground tabular-nums">
            {summary(outcome.data.checks)}
          </p>
          <ul className="divide-y divide-border rounded-[3px] border border-border">
            {outcome.data.checks.map((check) => (
              <CheckRow key={check.name} check={check} linkOf={linkOf} />
            ))}
          </ul>
          <AuditLink requestId={outcome.requestId} />
        </div>
      )}
    </div>
  );
}

function summary(checks: readonly Check[]): string {
  const counts = CHECK_STATES.map((s) => [s, checks.filter((c) => c.state === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  return `${checks.length} ${checks.length === 1 ? "check" : "checks"}: ${counts.join(" · ")}`;
}

function CheckRow({
  check,
  linkOf,
}: {
  check: Check;
  linkOf: (check: Check, item: CheckItem) => string | null;
}) {
  const words = STATE_WORDS[check.state];
  return (
    <li data-check={check.name} data-state={check.state} className="px-4 py-3 font-mono text-xs">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-semibold text-foreground">{check.name}</span>
        <span className={words.tone}>
          <span aria-hidden="true">{words.glyph} </span>
          {words.word}
        </span>
        <span className="text-fg-muted">{CHECK_WHAT[check.name]}</span>
      </p>
      <p className="mt-1 leading-relaxed break-words text-foreground/90">{check.detail}</p>
      {check.items && check.items.length > 0 ? (
        <ul className="mt-2 space-y-1 border-l border-border-bright pl-3">
          {check.items.map((item) => {
            const href = linkOf(check, item);
            const itemWords = STATE_WORDS[item.state];
            return (
              <li key={item.ref} data-item-state={item.state} className="break-words">
                <span className={itemWords.tone}>
                  <span aria-hidden="true">{itemWords.glyph} </span>
                  {itemWords.word}
                </span>{" "}
                {href ? (
                  <a
                    href={href}
                    translate="no"
                    className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
                  >
                    {item.ref.slice(0, 8)}
                  </a>
                ) : (
                  <span translate="no" className="text-foreground">
                    {item.ref.slice(0, 8)}
                  </span>
                )}{" "}
                <span className="text-fg-muted">— {item.detail}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
