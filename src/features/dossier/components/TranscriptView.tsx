import { Fragment } from "react";
import { citationSegments, evidenceHref, httpUrl, UNTRUSTED_REL } from "../citations";
import type { TranscriptReceiptView, TranscriptRound } from "../receipt-view";

/**
 * The debate as the receipt shows it (spec 21 §6.6): each round in order with its side, every
 * `[cert:<id>]` in an argument a link to the evidence row holding that certificate (`#e-<key>`),
 * a certificate no row holds said rather than linked, URL citations linked only when http(s), and
 * the signed transcript hash with its signature. Rendered on the server; no hooks.
 */

const SIDE_CLASS: Readonly<Record<TranscriptRound["side"], string>> = {
  proponent: "border-success",
  skeptic: "border-accent-rose",
  judge: "border-accent-violet",
};

const LINK =
  "text-accent-violet underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground";

function CertChip({
  certificateId,
  certificateKeys,
}: {
  certificateId: string;
  certificateKeys: ReadonlyMap<string, string>;
}) {
  const key = certificateKeys.get(certificateId.toLowerCase()) ?? null;
  const short = certificateId.slice(0, 8);
  if (key === null) {
    return (
      <span
        translate="no"
        className="rounded-[3px] border border-dashed border-border-bright px-1 text-fg-muted"
      >
        [cert {short} · not in this dossier’s evidence]
      </span>
    );
  }
  return (
    <a
      href={evidenceHref(key)}
      data-cite="cert"
      aria-label={`evidence ${key}, certificate ${short}`}
      translate="no"
      className="rounded-[3px] border border-accent-violet/50 bg-accent-violet-soft px-1 text-accent-violet no-underline transition-colors hover:border-accent-violet hover:text-foreground"
    >
      cert {short}
      <span aria-hidden="true"> ↓</span>
    </a>
  );
}

function Argument({
  text,
  certificateKeys,
}: {
  text: string;
  certificateKeys: ReadonlyMap<string, string>;
}) {
  return (
    <p className="mt-1.5 whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
      {citationSegments(text, certificateKeys).map((seg, i) =>
        seg.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and never reorder
          <Fragment key={i}>{seg.text}</Fragment>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: one certificate may be cited twice
          <CertChip key={i} certificateId={seg.certificateId} certificateKeys={certificateKeys} />
        ),
      )}
    </p>
  );
}

function Citations({
  citations,
  certificateKeys,
}: {
  citations: TranscriptRound["citations"];
  certificateKeys: ReadonlyMap<string, string>;
}) {
  if (citations.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-fg-muted">
      {citations.map((c, i) => {
        const url = c.type === "url" ? httpUrl(c.ref) : null;
        const key = c.type === "cert" ? (certificateKeys.get(c.ref.toLowerCase()) ?? null) : null;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: citations arrive in order and never reorder
          <li key={i} className="[overflow-wrap:anywhere]">
            cites {c.type}{" "}
            {key !== null ? (
              <a href={evidenceHref(key)} translate="no" className={LINK}>
                {c.ref.slice(0, 8)}
              </a>
            ) : url !== null ? (
              <a href={url} rel={UNTRUSTED_REL} className={LINK}>
                {c.ref}
              </a>
            ) : (
              <span translate="no" className="text-foreground">
                {c.ref}
              </span>
            )}
            {c.title ? ` — ${c.title}` : ""}
          </li>
        );
      })}
    </ul>
  );
}

export function TranscriptView({
  transcript: t,
  certificateKeys,
}: {
  transcript: TranscriptReceiptView;
  certificateKeys: ReadonlyMap<string, string>;
}) {
  return (
    <div className="space-y-5">
      <dl className="grid gap-x-6 gap-y-2 font-mono text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-fg-muted">debate</dt>
        <dd translate="no" className="text-foreground">
          {t.debateId}
        </dd>
        <dt className="text-fg-muted">verdict</dt>
        <dd className="text-foreground">
          {t.verdict.toLowerCase()} · {Math.round(t.confidence * 100)}% confidence
        </dd>
        <dt className="text-fg-muted">transcript hash</dt>
        <dd translate="no" className="break-all text-foreground tabular-nums">
          {t.hash}
        </dd>
        <dt className="text-fg-muted">signature</dt>
        <dd translate="no" className="break-all text-foreground">
          {t.signature === null ? (
            <span className="text-warning">unsigned</span>
          ) : (
            <>
              <span className="text-fg-muted">{t.signatureAlg ?? "signed"} · </span>
              {t.signature}
            </>
          )}
        </dd>
      </dl>

      {t.rounds.length === 0 ? (
        <p className="font-mono text-xs text-fg-muted">The transcript holds no rounds.</p>
      ) : (
        <ol className="space-y-3">
          {t.rounds.map((r, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: rounds are in debate order and never reorder
              key={i}
              data-side={r.side}
              className={`rounded-[3px] border-l-2 bg-surface/50 px-4 py-3 ${SIDE_CLASS[r.side]}`}
            >
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                {r.side} · round {r.round}
              </p>
              <Argument text={r.argument} certificateKeys={certificateKeys} />
              <Citations citations={r.citations} certificateKeys={certificateKeys} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
