import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A receipt, as the brand spine means it (RR-0004: "tools that hand you a receipt"): the kind of
 * receipt and its serial, the subject, itemised lines, an optional stamp, a footer, and a torn
 * bottom edge. With `href` the subject is the link and its box covers the whole card, so the link's
 * name is the subject alone.
 */

export type ReceiptLine = { label: string; value: ReactNode };
export type ReceiptTone = "pass" | "fail" | "neutral";
export type ReceiptStamp = { text: string; tone: ReceiptTone };

const STAMP_CLASS: Readonly<Record<ReceiptTone, string>> = {
  pass: "text-success",
  fail: "text-accent-rose",
  neutral: "text-warning",
};

export function ReceiptCard({
  kind,
  serial,
  title,
  lines,
  stamp,
  href,
  footer,
  headingLevel = 3,
  className = "",
}: {
  kind: string;
  serial?: string;
  title: string;
  lines: readonly ReceiptLine[];
  stamp?: ReceiptStamp;
  href?: string;
  footer?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <article
      className={`receipt-torn group relative flex h-full flex-col bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono transition-colors focus-within:bg-surface-hover hover:bg-surface-hover ${className}`}
    >
      <header className="flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <span>{kind}</span>
        {serial ? (
          <span translate="no" className="tabular-nums tracking-[0.08em] normal-case">
            #{serial}
          </span>
        ) : null}
      </header>

      <div className="receipt-rule mt-3 pt-3">
        <Heading className="line-clamp-3 break-words text-sm leading-snug text-foreground [text-wrap:pretty]">
          {href ? (
            <Link
              href={href}
              className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-4px] focus-visible:after:outline-accent-violet focus-visible:after:outline-solid"
            >
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
      </div>

      {stamp ? (
        <p
          data-tone={stamp.tone}
          className={`receipt-stamp mt-3 self-start rounded-[3px] border-2 border-current px-2 py-0.5 font-display text-xs font-bold uppercase tracking-[0.18em] ${STAMP_CLASS[stamp.tone]}`}
        >
          {stamp.text}
        </p>
      ) : null}

      <dl className="receipt-rule mt-3 space-y-1.5 pt-3 text-xs">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline gap-2">
            <dt className="shrink-0 text-fg-muted">{line.label}</dt>
            <span
              aria-hidden="true"
              className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-border-bright"
            />
            <dd className="min-w-0 truncate text-right tabular-nums text-foreground">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>

      {footer ? (
        <footer className="receipt-rule mt-auto pt-3 text-[11px] text-fg-muted">
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <span className="tabular-nums">{footer}</span>
            {href ? (
              <span
                aria-hidden="true"
                className="text-fg-muted transition-colors group-hover:text-accent-violet"
              >
                open →
              </span>
            ) : null}
          </div>
        </footer>
      ) : null}
    </article>
  );
}
