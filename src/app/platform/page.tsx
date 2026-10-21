import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { BudgetMeter } from "@/components/platform/BudgetMeter";
import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { PageFrame } from "@/components/terminal/PageFrame";
import { HealthProvider } from "@/features/health/components/HealthProvider";
import { Commit } from "@/features/platform/components/Commit";
import { ServiceLive } from "@/features/platform/components/ServiceLive";
import { commitFact } from "@/features/platform/facts";
import { type KidFact, loadPlatform, type PlatformData } from "@/features/platform/load";
import {
  BASTION_REPO,
  type ProductRow,
  productRows,
  type ServiceRow,
  serviceRows,
} from "@/features/platform/registry-view";
import { SITE } from "@/lib/site/config";
import { pageMetadata } from "@/lib/site/metadata";
import { BUDGET_KEYS, BUDGET_NOUN } from "@/platform/budget-keys";
import { TOKEN_ISSUER, TOKEN_TTL_S } from "@/platform/gateway/token";

export const metadata: Metadata = pageMetadata(SITE, "/platform", {
  title: "platform",
  description:
    "8 products, 15 repos and 6 services in one place: what runs where and at which commit, how every call is signed, and what is left of today's budgets.",
});

/**
 * `/platform` (spec 21 §3.2): the registry in one place — the services with their live health,
 * version, commit and audience; the token contract every call carries; today's budgets; the 8
 * products and their 15 repos. Rendered per request. It shows no secret.
 */

const CONTRACT_SPEC_URL =
  "https://github.com/Abdul-Muizz1310/bastion/blob/main/docs/specs/22-platform-contract-v2.md";
const JWKS_PATH = "/.well-known/jwks.json";
const LEEWAY_S = 10;

const LINK = "underline decoration-dotted underline-offset-4 hover:text-foreground";

export default async function PlatformPage() {
  await connection();
  const data = await loadPlatform();
  const products = productRows();
  const services = serviceRows();
  const repoCount = products.reduce((n, p) => n + p.repos.length, 0);
  const counts = `${products.length} products · ${repoCount} repos · ${services.length} services`;

  return (
    <PageFrame active="platform" statusRight={counts}>
      <div className="space-y-16">
        <header className="max-w-3xl">
          <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
            ~/muizz-lab/bastion <span className="text-accent-violet">$</span> cat registry
          </p>
          <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
            platform
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-fg-muted text-pretty">
            <span className="text-foreground">{counts}, in one place.</span> What runs where and at
            which commit, how every call bastion makes is signed and who may accept it, and what is
            left of today’s budgets.
          </p>
        </header>

        <Services
          services={services}
          bastionCommit={data.bastionCommit}
          bastionHost={products.find((p) => p.id === "bastion")?.frontend?.host ?? "bastion"}
        />

        <div className="grid gap-x-10 gap-y-14 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
          <Contract kid={data.kid} />
          <Budgets budgets={data.budgets} />
        </div>

        <Products products={products} />
      </div>
    </PageFrame>
  );
}

function SectionTitle({
  id,
  children,
  hint,
}: {
  id: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h2 id={id} className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted">
        <span aria-hidden="true" className="text-accent-violet">
          ▚{" "}
        </span>
        {children}
      </h2>
      {hint ? <p className="font-mono text-xs text-fg-muted">{hint}</p> : null}
    </div>
  );
}

const SERVICE_COLUMNS =
  "lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,12rem)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,9rem)] lg:items-baseline lg:gap-x-5";

function Services({
  services,
  bastionCommit,
  bastionHost,
}: {
  services: readonly ServiceRow[];
  bastionCommit: string | null;
  bastionHost: string;
}) {
  return (
    <section aria-labelledby="services-title" data-section="services">
      <SectionTitle id="services-title" hint="live · one shared probe every 30 s">
        services
      </SectionTitle>
      <div className="mt-4 rounded-[var(--radius)] bg-surface pt-1 font-mono text-xs">
        <div
          aria-hidden="true"
          className={`hidden border-b border-border-bright px-5 py-2 text-[11px] uppercase tracking-[0.16em] text-fg-muted ${SERVICE_COLUMNS}`}
        >
          <span>service · host</span>
          <span>health</span>
          <span>version</span>
          <span>commit</span>
          <span>token audience</span>
        </div>
        <HealthProvider>
          <ol>
            {services.map((s) => (
              <ServiceLine key={s.id} id={s.id} host={s.host}>
                <ServiceLive service={s.id} repoUrl={s.repo.url} />
                <Cell label="aud">
                  <span translate="no" className="text-accent-violet">
                    {s.audience}
                  </span>
                </Cell>
              </ServiceLine>
            ))}
            <ServiceLine id="bastion" host={bastionHost}>
              <Cell label="health">
                <ServiceBadge state="live" detail="serving this page" />
              </Cell>
              <Cell label="version">
                <span className="text-fg-muted">not reported</span>
              </Cell>
              <Cell label="commit">
                <Commit commit={commitFact(bastionCommit ?? undefined, BASTION_REPO.url)} />
              </Cell>
              <Cell label="iss">
                <span className="text-fg-muted">issues every token</span>
              </Cell>
            </ServiceLine>
          </ol>
        </HealthProvider>
      </div>
    </section>
  );
}

function ServiceLine({ id, host, children }: { id: string; host: string; children: ReactNode }) {
  return (
    <li
      data-service={id}
      className={`border-b border-dashed border-border-bright px-5 py-3 last:border-b-0 ${SERVICE_COLUMNS}`}
    >
      <div className="mb-2 min-w-0 lg:mb-0">
        <p translate="no" className="font-display text-sm font-bold text-foreground">
          {id}
        </p>
        <p translate="no" className="truncate text-[11px] text-fg-muted">
          {host}
        </p>
      </div>
      <dl className="contents">{children}</dl>
    </li>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 lg:block">
      <dt className="w-16 shrink-0 text-[11px] uppercase tracking-[0.16em] text-fg-muted lg:sr-only">
        {label}
      </dt>
      <dd className="min-w-0 truncate tabular-nums">{children}</dd>
    </div>
  );
}

function ContractLine({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt translate="no" className="w-14 shrink-0 text-fg-muted">
        {name}
      </dt>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-border-bright"
      />
      <dd className="min-w-0 text-right text-foreground">{children}</dd>
    </div>
  );
}

function Contract({ kid }: { kid: KidFact }) {
  return (
    <section
      aria-labelledby="contract-title"
      data-section="contract"
      className="receipt-torn relative bg-surface px-6 pt-5 pb-[calc(var(--tear)+1.25rem)] font-mono text-xs"
    >
      <div className="flex items-baseline justify-between gap-4 text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <h2 id="contract-title">the token contract</h2>
        <span aria-hidden="true">v2</span>
      </div>
      <p className="receipt-rule mt-3 pt-3 leading-relaxed text-fg-muted text-pretty">
        <span className="text-foreground">
          Every call bastion makes carries a token signed for that one service.
        </span>{" "}
        The service it names is the only one that will accept it, and it expires {TOKEN_TTL_S} s
        after it is signed.
      </p>
      <dl className="receipt-rule mt-4 space-y-2 pt-3 tabular-nums">
        <ContractLine name="alg">EdDSA · Ed25519</ContractLine>
        <ContractLine name="kid">
          {kid.kind === "ok" ? (
            <span translate="no" className="break-all text-accent-violet">
              {kid.kid}
            </span>
          ) : (
            <span className="text-error">unreadable · BASTION_KEY_ID is misconfigured</span>
          )}
        </ContractLine>
        <ContractLine name="iss">
          <span translate="no">"{TOKEN_ISSUER}"</span>
        </ContractLine>
        <ContractLine name="aud">the receiving service id · one, listed above</ContractLine>
        <ContractLine name="sub">the visitor’s daily pseudonym, or "bastion"</ContractLine>
        <ContractLine name="role">viewer · editor · admin, per capability</ContractLine>
        <ContractLine name="ttl">
          {TOKEN_TTL_S} s · exp = iat + {TOKEN_TTL_S}
        </ContractLine>
        <ContractLine name="leeway">{LEEWAY_S} s on exp and iat</ContractLine>
      </dl>
      <div className="receipt-rule mt-4 pt-3">
        <h3 className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">
          every backend checks
        </h3>
        <ul className="mt-2 space-y-1.5 leading-relaxed text-foreground/90">
          <li>
            <span aria-hidden="true" className="text-accent-violet">
              ·{" "}
            </span>
            the signature, against bastion’s published key
          </li>
          <li>
            <span aria-hidden="true" className="text-accent-violet">
              ·{" "}
            </span>
            that aud is its own service id — a token minted for another service is refused
          </li>
          <li>
            <span aria-hidden="true" className="text-accent-violet">
              ·{" "}
            </span>
            with no trusted key configured, it fails closed: 503 on every route that is not public
          </li>
        </ul>
      </div>
      <ul className="receipt-rule mt-4 space-y-1.5 pt-3">
        <li>
          <a href={JWKS_PATH} className={`text-accent-violet ${LINK}`}>
            the published key · <span translate="no">{JWKS_PATH}</span>
          </a>
        </li>
        <li>
          <a href={CONTRACT_SPEC_URL} className={`text-accent-violet ${LINK}`}>
            the contract, in full · spec 22<span aria-hidden="true"> ↗</span>
          </a>
        </li>
        <li>
          <Link href="/tools/bastion" className={`text-accent-violet ${LINK}`}>
            decode a token in the bastion workbench<span aria-hidden="true"> →</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}

function Budgets({ budgets }: { budgets: PlatformData["budgets"] }) {
  return (
    <section aria-labelledby="budgets-title" data-section="budgets">
      <SectionTitle id="budgets-title" hint="resets 00:00 UTC">
        today’s budgets
      </SectionTitle>
      <div className="mt-4 rounded-[var(--radius)] border border-border bg-background/70 p-5">
        {budgets === null ? (
          <p className="font-mono text-xs leading-relaxed text-fg-muted">
            <span className="text-warning">Today’s budgets are unavailable</span>: the budget store
            did not answer, so no number is shown and none is guessed; the gateway still enforces
            every limit.
          </p>
        ) : (
          <div className="space-y-5">
            {BUDGET_KEYS.map((key) => (
              <BudgetMeter
                key={key}
                id={`platform-budget-${key.replace(".", "-")}`}
                label={`${BUDGET_NOUN[key]} left today`}
                left={budgets[key].left}
                limit={budgets[key].limit}
              />
            ))}
          </div>
        )}
        <p className="receipt-rule mt-5 pt-3 font-mono text-[11px] leading-relaxed text-fg-muted">
          Shared by every visitor and counted before a call is made: the free models behind the
          platform allow 50 requests a day across every product.
        </p>
      </div>
    </section>
  );
}

function Products({ products }: { products: readonly ProductRow[] }) {
  return (
    <section aria-labelledby="products-title" data-section="products">
      <SectionTitle id="products-title" hint="each links to its workbench">
        products &amp; repos
      </SectionTitle>
      <ol className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {products.map((p, i) => (
          <li
            key={p.id}
            className="flex flex-col rounded-[var(--radius)] border border-border bg-surface/50 p-5 font-mono text-xs"
          >
            <div className="flex items-baseline justify-between gap-3 text-fg-muted">
              <span aria-hidden="true" className="tabular-nums">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span translate="no" className="truncate text-[11px]">
                {p.services.length === 0 ? "runs inside bastion" : `on ${p.services.join(" · ")}`}
              </span>
            </div>
            <h3 className="mt-3 font-display text-lg font-bold tracking-tight">
              <Link href={p.workbench} translate="no" className="hover:text-accent-violet">
                {p.name}
                <span className="sr-only"> workbench</span>
              </Link>
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-muted text-pretty">
              {p.tagline}
            </p>
            <dl className="receipt-rule mt-4 flex-1 space-y-3 pt-3">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">
                  {p.repos.length === 1 ? "repo" : `repos · ${p.repos.length}`}
                </dt>
                <dd>
                  <ul className="mt-1 space-y-0.5">
                    {p.repos.map((r) => (
                      <li key={r.url}>
                        <a href={r.url} translate="no" className={`text-accent-violet ${LINK}`}>
                          {r.name}
                          <span aria-hidden="true"> ↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              {p.packages.length > 0 ? (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">on PyPI</dt>
                  <dd>
                    <ul className="mt-1 space-y-0.5">
                      {p.packages.map((pkg) => (
                        <li key={pkg.url}>
                          <a href={pkg.url} translate="no" className={`text-foreground ${LINK}`}>
                            {pkg.name}
                            <span aria-hidden="true"> ↗</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              ) : null}
              {p.frontend ? (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.18em] text-fg-muted">live</dt>
                  <dd className="mt-1 break-all">
                    <a href={p.frontend.url} translate="no" className={`text-foreground ${LINK}`}>
                      {p.frontend.host}
                      <span aria-hidden="true"> ↗</span>
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
