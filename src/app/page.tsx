import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { BudgetMeter } from "@/components/platform/BudgetMeter";
import { SystemMap } from "@/components/platform/SystemMap";
import { PageFrame } from "@/components/terminal/PageFrame";
import { DossierGallery } from "@/features/dossier/components/DossierGallery";
import { HealthProvider } from "@/features/health/components/HealthProvider";
import { loadHome } from "@/features/home/load";
import { PRODUCTS, type ProductId, SERVICES } from "@/platform/registry/products";

export const metadata: Metadata = { alternates: { canonical: "/" } };

/** The receipt's line order follows the dossier: sources first, bastion last, as the total. */
const LEDGER_ORDER: readonly ProductId[] = [
  "magpie",
  "inkgrid",
  "inkthread",
  "inkprint",
  "paper-trail",
  "slowquery",
  "feathers",
  "bastion",
];

const REPO_COUNT = PRODUCTS.reduce((n, p) => n + p.repos.length, 0);
const SERVICE_COUNT = Object.keys(SERVICES).length;

/**
 * The platform map (spec 21 §3.1): the brand spine, the live system map, three ways in, and the
 * most recent finished dossiers as receipts. Public and rendered per request.
 */
export default async function Home() {
  // Request-time, never prerendered at build: the gallery and the budget are live data.
  await connection();
  const { gallery, debates } = await loadHome();

  return (
    <PageFrame
      active="map"
      statusRight={`${PRODUCTS.length} products · ${SERVICE_COUNT} services · ${REPO_COUNT} repos`}
    >
      <div className="space-y-20 md:space-y-24">
        {/* Spine and ledger side by side on a desktop; on a phone the map comes before the ledger. */}
        <div className="grid gap-x-12 gap-y-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:items-center lg:gap-y-24">
          <div className="min-w-0">
            <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
              ~/muizz-lab/bastion <span className="text-accent-violet">$</span> cat receipts
              <span className="cursor-blink ml-1 text-accent-violet">▍</span>
            </p>
            <h1 className="mt-6 font-display text-[2.55rem] leading-[1.04] font-bold tracking-[-0.02em] text-balance sm:text-6xl lg:text-[4.1rem]">
              tools that hand you a <span className="text-accent-violet">receipt.</span>
            </h1>
            <p className="mt-7 max-w-xl text-[15px] leading-relaxed text-fg-muted text-pretty">
              <span className="text-foreground">
                Proof you can inspect yourself, not a claim you have to trust.
              </span>{" "}
              bastion runs all {PRODUCTS.length} muizz-lab products live and chains them into one
              dossier: evidence scraped or read exactly, signed, argued over, measured and sealed
              into an envelope anyone can re-verify. The receipt of receipts.
            </p>
          </div>
          <div className="order-last lg:order-none">
            <ReceiptLedger />
          </div>
          <div className="min-w-0 lg:col-span-2">
            <HealthProvider>
              <SystemMap />
            </HealthProvider>
          </div>
        </div>

        <section aria-labelledby="ways-in" data-section="entry-points">
          <SectionHeading id="ways-in">three ways in</SectionHeading>
          <ol className="mt-5 grid gap-4 md:grid-cols-3">
            <EntryPoint
              index={1}
              href="/dossier"
              title="run a dossier"
              blurb="Check a claim against web pages and PDFs. Every piece of evidence is signed, argued over and sealed into one envelope you can verify later."
            >
              {debates ? (
                <BudgetMeter
                  id="home-budget-debate"
                  label="debates left today"
                  left={debates.left}
                  limit={debates.limit}
                />
              ) : null}
            </EntryPoint>
            <EntryPoint
              index={2}
              href="/tools"
              title="open a workbench"
              blurb={`Operate any of the ${PRODUCTS.length} products live: scrape, read a PDF, certify, debate, find the slow query. Keep the receipt it hands back.`}
            />
            <EntryPoint
              index={3}
              href="/audit"
              title="read the audit log"
              blurb="Every gateway call, append-only, by service and request id. Rewind to any moment in time-travel."
            />
          </ol>
        </section>

        <section aria-labelledby="recent" data-section="gallery">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <SectionHeading id="recent">recent receipts</SectionHeading>
            <p className="font-mono text-xs text-fg-muted">
              the latest finished dossiers, each verifiable at its own URL
            </p>
          </div>
          <div className="mt-5">
            <DossierGallery gallery={gallery} />
          </div>
        </section>
      </div>
    </PageFrame>
  );
}

function SectionHeading({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted">
      <span aria-hidden="true" className="text-accent-violet">
        ▚{" "}
      </span>
      {children}
    </h2>
  );
}

function EntryPoint({
  index,
  href,
  title,
  blurb,
  children,
}: {
  index: number;
  href: string;
  title: string;
  blurb: string;
  children?: ReactNode;
}) {
  return (
    <li className="group relative flex flex-col rounded-[var(--radius)] border border-border bg-surface/50 p-5 transition-colors focus-within:border-accent-violet hover:border-accent-violet/60">
      <div className="flex items-baseline justify-between font-mono text-xs text-fg-muted">
        <span aria-hidden="true" className="tabular-nums">
          {String(index).padStart(2, "0")}
        </span>
        <span
          aria-hidden="true"
          className="text-base text-fg-muted transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-accent-violet"
        >
          →
        </span>
      </div>
      <h3 className="mt-3 font-display text-lg font-bold tracking-tight">
        <Link
          href={href}
          className="outline-none after:absolute after:inset-0 after:rounded-[var(--radius)] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent-violet focus-visible:after:outline-solid"
        >
          {title}
        </Link>
      </h3>
      <p className="mt-2 flex-1 text-[13px] leading-relaxed text-fg-muted text-pretty">{blurb}</p>
      {children ? <div className="mt-5">{children}</div> : null}
      <p aria-hidden="true" className="mt-4 font-mono text-xs text-fg-muted">
        <span className="text-accent-violet">$</span> open {href}
      </p>
    </li>
  );
}

function ReceiptLedger() {
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  const items = LEDGER_ORDER.map((id) => {
    const product = byId.get(id);
    if (!product) throw new Error(`home: the registry has no ${id}`);
    return product;
  });
  const total = items.at(-1);
  const lines = items.slice(0, -1);
  if (!total) throw new Error("home: an empty ledger");

  return (
    <aside
      aria-labelledby="ledger-title"
      className="receipt-torn relative bg-surface px-6 pt-5 pb-[calc(var(--tear)+1.25rem)] font-mono text-xs"
    >
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <h2 id="ledger-title">what each tool hands you</h2>
        <span aria-hidden="true">#v2</span>
      </div>
      <ol className="receipt-rule mt-3 space-y-2.5 pt-3">
        {lines.map((p, i) => (
          <li key={p.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1">
            <span aria-hidden="true" className="tabular-nums text-fg-muted">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0">
              <span translate="no" className="text-foreground">
                {p.name}
              </span>
              <span className="block text-fg-muted">{p.receipt}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-3 border-t-[3px] border-double border-border-bright pt-3">
        <p className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em]">
          <span className="text-accent-violet">total</span>
          <span translate="no" className="text-foreground normal-case tracking-normal">
            {total.name}
          </span>
        </p>
        <p className="mt-1 text-fg-muted">{total.receipt}</p>
      </div>
      <p className="receipt-rule mt-3 pt-3 text-[11px] text-fg-muted tabular-nums">
        {PRODUCTS.length} products · {REPO_COUNT} repos · {SERVICE_COUNT} live services
      </p>
    </aside>
  );
}
