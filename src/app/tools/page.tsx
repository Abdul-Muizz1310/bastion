import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { HealthProvider } from "@/features/health/components/HealthProvider";
import { WORKBENCH_ORDER, WORKBENCHES } from "@/features/tools/catalog";
import { ProductHealth } from "@/features/tools/components/ProductHealth";
import { SITE } from "@/lib/site/config";
import { pageMetadata } from "@/lib/site/metadata";
import { PRODUCTS, type Product } from "@/platform/registry/products";

export const metadata: Metadata = pageMetadata(SITE, "/tools", {
  title: "workbenches",
  description:
    "Operate each muizz-lab product live through bastion's gateway, rate-limited, budgeted and audited, and keep the receipt it hands back.",
});

/**
 * `/tools` (spec 21 §5.1): the eight workbenches in dossier order, each with its live health (the
 * shared 30 s status poll), what it operates and the receipt it hands back.
 */
export default function ToolsIndex() {
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const products = WORKBENCH_ORDER.map((id) => {
    const product = byId.get(id);
    if (!product) throw new Error(`tools: the registry has no ${id}`);
    return product;
  });

  return (
    <PageFrame active="tools" statusRight={`${products.length} workbenches · every call audited`}>
      <div className="space-y-12">
        <header className="max-w-3xl">
          <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
            ~/muizz-lab/bastion <span className="text-accent-violet">$</span> ls tools
          </p>
          <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
            workbenches
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-fg-muted text-pretty">
            <span className="text-foreground">
              Operate every product live and keep what it hands back.
            </span>{" "}
            Each workbench wakes its service, calls it through bastion’s gateway — rate-limited,
            budgeted, audited — and shows the receipt: a hash, a signature, a plan, a PR.
          </p>
        </header>

        <HealthProvider>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {products.map((p, i) => (
              <WorkbenchCard key={p.id} product={p} index={i + 1} />
            ))}
          </ol>
        </HealthProvider>
      </div>
    </PageFrame>
  );
}

function WorkbenchCard({ product, index }: { product: Product; index: number }) {
  const row = WORKBENCHES[product.id];
  return (
    <li className="group relative flex flex-col rounded-[var(--radius)] border border-border bg-surface/50 p-5 transition-colors focus-within:border-accent-violet hover:border-accent-violet/60">
      <div className="flex items-baseline justify-between gap-3 font-mono text-xs text-fg-muted">
        <span aria-hidden="true" className="tabular-nums">
          {String(index).padStart(2, "0")}
        </span>
        <ProductHealth services={product.services} />
      </div>
      <h2 className="mt-3 font-display text-lg font-bold tracking-tight">
        <Link
          href={`/tools/${product.id}`}
          translate="no"
          className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius)] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent-violet focus-visible:after:outline-solid"
        >
          {product.name}
          <span className="sr-only"> workbench</span>
        </Link>
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-fg-muted text-pretty">
        {product.tagline}
      </p>
      <dl className="receipt-rule mt-4 flex-1 space-y-2.5 pt-3 font-mono text-xs">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">operate</dt>
          <dd className="mt-0.5 leading-relaxed text-foreground/90">{row.operate}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">receipt</dt>
          <dd className="mt-0.5 leading-relaxed text-accent-violet">{row.receipt}</dd>
        </div>
      </dl>
      <p
        aria-hidden="true"
        className="mt-4 font-mono text-xs text-fg-muted transition-colors group-hover:text-accent-violet"
      >
        <span className="text-accent-violet">$</span> open /tools/{product.id} →
      </p>
    </li>
  );
}
