import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { type Health, probe } from "@/platform/registry/health";
import { PRODUCTS, SERVICES } from "@/platform/registry/products";

export const revalidate = 60;

const PROBE_TIMEOUT_MS = 8_000;

// The title comes from the id alone: it never reads the record.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `service ${id}` };
}

const STATE_CLASS: Record<Health["state"], string> = {
  live: "text-success",
  asleep: "text-warning",
  down: "text-error",
};

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = PRODUCTS.find((p) => p.id === id);
  if (!product) notFound();

  const serviceId = product.services[0];
  let health: Health | null = null;
  if (serviceId !== undefined) {
    try {
      health = await probe(serviceId, PROBE_TIMEOUT_MS);
    } catch {
      // continue without health data
    }
  }
  const backendUrl = serviceId === undefined ? undefined : SERVICES[serviceId].baseUrl;
  const repo = product.repos[0];

  return (
    <PageFrame active="registry">
      <div className="space-y-6">
        <div>
          <Link href="/dashboard" className="font-mono text-xs text-fg-faint hover:text-fg-muted">
            ← registry
          </Link>
          <h1 className="mt-2 font-mono text-3xl font-semibold tracking-tight">{product.name}</h1>
          <p className="mt-1 font-mono text-sm text-fg-muted">{product.tagline}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TerminalWindow
            title="health"
            status={
              serviceId === undefined
                ? "green"
                : health?.state === "live"
                  ? "green"
                  : health?.state === "asleep"
                    ? "yellow"
                    : "red"
            }
          >
            {serviceId === undefined ? (
              <div className="text-accent-violet">no hosted backend</div>
            ) : health ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-fg-muted">status</span>
                  <span className={STATE_CLASS[health.state]}>{health.state}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-fg-muted">latency</span>
                  <span>{health.latencyMs}ms</span>
                </div>
                {health.version && (
                  <div className="flex justify-between">
                    <span className="text-fg-muted">version</span>
                    <span>{health.version}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-fg-faint">failed to fetch health</div>
            )}
          </TerminalWindow>

          <TerminalWindow title="links">
            <div className="space-y-2">
              {repo && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">repo</span>
                  <a
                    href={repo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-violet hover:underline"
                  >
                    github ↗
                  </a>
                </div>
              )}
              {backendUrl && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">backend</span>
                  <a
                    href={backendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg-faint hover:text-foreground"
                  >
                    {new URL(backendUrl).host}
                  </a>
                </div>
              )}
              {product.frontendUrl && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">frontend</span>
                  <a
                    href={product.frontendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg-faint hover:text-foreground"
                  >
                    {new URL(product.frontendUrl).host}
                  </a>
                </div>
              )}
            </div>
          </TerminalWindow>
        </div>

        <div className="flex flex-wrap gap-2">
          {product.repos.map((r) => (
            <span
              key={r.name}
              className="rounded-md border border-border bg-surface px-3 py-1 font-mono text-xs text-fg-muted"
            >
              {r.name}
            </span>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
