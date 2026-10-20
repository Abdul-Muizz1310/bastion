import { documentAnchor, evidenceHref, UNTRUSTED_REL } from "../citations";
import type { EvidenceRowView } from "../receipt-view";
import { CertVerifyState } from "./verify-context";

/**
 * The evidence table (spec 21 §6.5, §6.6): one row per evidence item, anchored at `e-<key>` so the
 * transcript's citations land on it — product, locator, the excerpt bastion stored (exactly what
 * verification binds to the certified text), the certificate linking to inkprint's public page,
 * and its state once "verify everything" has run. Rendered on the server; only the verify state is
 * the browser's.
 */

const LINK =
  "text-accent-violet underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground";

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EvidenceTable({ rows }: { rows: readonly EvidenceRowView[] }) {
  if (rows.length === 0) {
    return (
      <p className="font-mono text-xs text-fg-muted">
        no evidence was sealed for this dossier: nothing was gathered or read, or the run stopped
        first.
      </p>
    );
  }
  return (
    <section
      aria-label="evidence, scrollable"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must be reachable by keyboard
      tabIndex={0}
      className="relative -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0"
    >
      <table className="w-full min-w-[46rem] border-collapse font-mono text-xs">
        <caption className="sr-only">
          The evidence the debate saw: each item with its product, where it came from, the excerpt
          kept, its inkprint certificate and its state once verified.
        </caption>
        <thead>
          <tr className="border-b border-border-bright text-left text-[11px] uppercase tracking-[0.16em] text-fg-muted">
            <th scope="col" className="py-2 pr-3 font-normal">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-normal">
              product
            </th>
            <th scope="col" className="py-2 pr-3 font-normal">
              from
            </th>
            <th scope="col" className="py-2 pr-3 font-normal">
              excerpt
            </th>
            <th scope="col" className="py-2 pr-3 font-normal">
              certificate
            </th>
            <th scope="col" className="py-2 font-normal">
              verified
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              id={row.anchor}
              className="border-b border-border align-top transition-colors target:bg-accent-violet-soft"
            >
              <td className="py-3 pr-3 tabular-nums text-fg-muted">
                <a href={evidenceHref(row.key)} className="hover:text-accent-violet">
                  E{row.n}
                </a>
              </td>
              <td className="py-3 pr-3">
                <span translate="no" className="text-foreground">
                  {row.product}
                </span>
                {row.kind ? <span className="block text-fg-muted">{row.kind}</span> : null}
              </td>
              <td className="max-w-[14rem] py-3 pr-3 [overflow-wrap:anywhere]">
                <Locator row={row} />
              </td>
              <td className="max-w-[26rem] py-3 pr-3">
                <Excerpt row={row} />
              </td>
              <td className="py-3 pr-3">
                {row.certificateId && row.certificateUrl ? (
                  <a
                    href={row.certificateUrl}
                    title={row.certificateId}
                    translate="no"
                    className={`${LINK} tabular-nums`}
                  >
                    {row.certificateId.slice(0, 8)}
                    <span className="sr-only">, open the certificate on inkprint</span>
                    <span aria-hidden="true"> ↗</span>
                  </a>
                ) : (
                  <span className="text-fg-muted">not certified</span>
                )}
              </td>
              <td className="py-3 whitespace-nowrap">
                {row.certificateId ? (
                  <CertVerifyState certificateId={row.certificateId} />
                ) : (
                  <span className="text-fg-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Locator({ row }: { row: EvidenceRowView }) {
  if (row.document) {
    const { documentId, page, title } = row.document;
    return (
      <>
        <span className="block text-foreground">{row.title}</span>
        <a href={`#${documentAnchor(documentId, page)}`} className={LINK}>
          {title ?? documentId.slice(0, 8)} · page {page}
        </a>
      </>
    );
  }
  if (row.link) {
    return (
      <>
        <a href={row.link} rel={UNTRUSTED_REL} className={LINK}>
          {row.title || host(row.link)}
        </a>
        <span className="block text-fg-muted" translate="no">
          {host(row.link)}
        </span>
      </>
    );
  }
  return <span className="text-foreground">{row.title || "no source recorded"}</span>;
}

function Excerpt({ row }: { row: EvidenceRowView }) {
  if (row.excerpt === null || row.excerpt === "") {
    return <span className="text-fg-muted">no excerpt stored</span>;
  }
  if (row.kind === "table") {
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre text-[11px] leading-relaxed text-foreground/90">
        {row.excerpt}
      </pre>
    );
  }
  return (
    <p className="leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">{row.excerpt}</p>
  );
}
