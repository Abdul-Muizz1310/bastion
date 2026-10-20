import Link from "next/link";
import type { Product } from "@/platform/registry/products";
import { WORKBENCHES } from "../catalog";

/**
 * The top of a workbench (spec 21 §5.1): where you are, the product's name and tagline, and its
 * spec §5 row as a slip — what you operate here and the receipt you are handed.
 */
export function WorkbenchHeader({ product }: { product: Product }) {
  const row = WORKBENCHES[product.id];
  return (
    <header className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end">
      <div className="min-w-0">
        <p className="font-mono text-xs text-fg-muted">
          <Link href="/tools" className="transition-colors hover:text-accent-violet">
            ~/tools
          </Link>{" "}
          <span aria-hidden="true" className="text-accent-violet">
            $
          </span>{" "}
          <span aria-hidden="true">open {product.id}</span>
        </p>
        <h1
          translate="no"
          className="mt-4 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl"
        >
          {product.name}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-fg-muted text-pretty">
          {product.tagline}
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-fg-muted">
          {product.repos.map((r) => (
            <li key={r.name}>
              <a
                href={r.url}
                className="underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
              >
                {r.name}
                <span aria-hidden="true"> ↗</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <dl className="receipt-torn bg-surface px-5 pt-4 pb-[calc(var(--tear)+1rem)] font-mono text-xs">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">operate</dt>
          <dd className="mt-1 leading-relaxed text-foreground">{row.operate}</dd>
        </div>
        <div className="receipt-rule mt-3 pt-3">
          <dt className="text-[11px] uppercase tracking-[0.2em] text-fg-muted">receipt shown</dt>
          <dd className="mt-1 leading-relaxed text-accent-violet">{row.receipt}</dd>
        </div>
      </dl>
    </header>
  );
}
