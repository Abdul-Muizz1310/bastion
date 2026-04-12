import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { getAggregatedStatus } from "@/lib/registry";
import { SERVICES } from "@/lib/services";

export const revalidate = 60;

export default async function DashboardPage() {
  let statuses: Awaited<ReturnType<typeof getAggregatedStatus>> = [];
  try {
    statuses = await getAggregatedStatus();
  } catch {
    // Render with no health data if fetch fails
  }

  const statusMap = new Map(statuses.map((s) => [s.id, s]));

  return (
    <PageFrame active="registry" statusRight="5 services">
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
          {SERVICES.map((service) => {
            const health = statusMap.get(service.id);
            const isCli = !service.backendUrl;
            const isHealthy = isCli || health?.healthy;
            const dotColor = isCli ? "bg-accent-violet" : isHealthy ? "bg-success" : "bg-error";

            return (
              <Link
                key={service.id}
                href={`/services/${service.id}`}
                className="group rounded-xl border border-border bg-surface/50 p-5 transition-all hover:border-border-bright hover:bg-surface"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="font-mono text-base font-semibold text-foreground group-hover:text-accent-violet">
                      {service.name}
                    </h2>
                    <p className="mt-1 font-mono text-xs text-fg-muted">{service.role}</p>
                  </div>
                  <span
                    className={`mt-1 h-2.5 w-2.5 rounded-full ${dotColor} ${isHealthy ? "pulse-ring" : ""}`}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  {service.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] text-fg-faint"
                    >
                      {tag}
                    </span>
                  ))}
                </div>

                {health && !isCli && (
                  <div className="mt-3 font-mono text-[11px] text-fg-faint">
                    {isHealthy ? `${health.latencyMs}ms` : (health.error ?? "unreachable")}
                    {health.version && <span className="ml-2">v{health.version}</span>}
                  </div>
                )}
                {isCli && (
                  <div className="mt-3 font-mono text-[11px] text-accent-violet">
                    CLI — see PyPI
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
