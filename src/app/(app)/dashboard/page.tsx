import type { Metadata } from "next";
import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { type Health, probe } from "@/platform/registry/health";
import { PRODUCTS, type ServiceId } from "@/platform/registry/products";

export const revalidate = 60;

export const metadata: Metadata = { title: "platform services" };

const PROBE_TIMEOUT_MS = 8_000;

/** One probe per service, even when two products share it (inkgrid is served by inkthread). */
async function probeAll(): Promise<Map<ServiceId, Health>> {
  const ids = [...new Set(PRODUCTS.flatMap((p) => p.services))];
  const results = await Promise.all(ids.map((id) => probe(id, PROBE_TIMEOUT_MS)));
  return new Map(results.map((h) => [h.service, h]));
}

function dotColor(hosted: boolean, health: Health | undefined): string {
  if (!hosted) return "bg-accent-violet";
  if (health?.state === "live") return "bg-success";
  if (health?.state === "asleep") return "bg-warning";
  return "bg-error";
}

export default async function DashboardPage() {
  let healthByService = new Map<ServiceId, Health>();
  try {
    healthByService = await probeAll();
  } catch {
    // Render with no health data if probing fails
  }

  return (
    <PageFrame active="registry" statusRight={`${PRODUCTS.length} products`}>
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// service_registry"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Platform <span className="text-accent-violet">Services</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Live health and status for all portfolio services.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((product) => {
            const serviceId = product.services[0];
            const hosted = serviceId !== undefined;
            const health = hosted ? healthByService.get(serviceId) : undefined;
            const isLive = health?.state === "live";

            return (
              <Link
                key={product.id}
                href={`/services/${product.id}`}
                className="group rounded-xl border border-border bg-surface/50 p-5 transition-all hover:border-border-bright hover:bg-surface"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-mono text-base font-semibold text-foreground group-hover:text-accent-violet">
                      {product.name}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-fg-muted">{product.tagline}</p>
                  </div>
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full ${dotColor(hosted, health)} ${isLive ? "pulse-ring" : ""}`}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {product.repos.map((repo) => (
                    <span
                      key={repo.name}
                      className="rounded-md border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-fg-faint"
                    >
                      {repo.name}
                    </span>
                  ))}
                </div>

                {health && (
                  <div className="mt-3 font-mono text-[11px] text-fg-faint">
                    {isLive ? `${health.latencyMs}ms` : health.state}
                    {health.version && <span className="ml-2">v{health.version}</span>}
                  </div>
                )}
                {!hosted && (
                  <div className="mt-3 font-mono text-[11px] text-accent-violet">
                    no hosted backend
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </PageFrame>
  );
}
