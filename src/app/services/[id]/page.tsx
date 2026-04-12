import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { checkServiceHealth } from "@/lib/registry";
import { SERVICES } from "@/lib/services";

export const revalidate = 60;

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = SERVICES.find((s) => s.id === id);
  if (!service) notFound();

  const isCli = !service.backendUrl;
  let health: Awaited<ReturnType<typeof checkServiceHealth>> | null = null;
  try {
    health = await checkServiceHealth(service.id);
  } catch {
    // continue without health data
  }

  return (
    <PageFrame active="registry">
      <div className="space-y-6">
        <div>
          <Link href="/dashboard" className="font-mono text-xs text-fg-faint hover:text-fg-muted">
            ← registry
          </Link>
          <h1 className="mt-2 font-mono text-3xl font-semibold tracking-tight">{service.name}</h1>
          <p className="mt-1 font-mono text-sm text-fg-muted">{service.role}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TerminalWindow
            title="health"
            status={isCli ? "green" : health?.healthy ? "green" : "red"}
          >
            {isCli ? (
              <div className="text-accent-violet">CLI tool — no hosted backend</div>
            ) : health ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-fg-muted">status</span>
                  <span className={health.healthy ? "text-success" : "text-error"}>
                    {health.healthy ? "healthy" : "unhealthy"}
                  </span>
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
              <div className="flex justify-between">
                <span className="text-fg-muted">repo</span>
                <a
                  href={service.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-violet hover:underline"
                >
                  github ↗
                </a>
              </div>
              {service.backendUrl && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">backend</span>
                  <a
                    href={service.backendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg-faint hover:text-foreground"
                  >
                    {new URL(service.backendUrl).host}
                  </a>
                </div>
              )}
              {service.frontendUrl && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">frontend</span>
                  <a
                    href={service.frontendUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg-faint hover:text-foreground"
                  >
                    {new URL(service.frontendUrl).host}
                  </a>
                </div>
              )}
            </div>
          </TerminalWindow>
        </div>

        <div className="flex flex-wrap gap-2">
          {service.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-border bg-surface px-3 py-1 font-mono text-xs text-fg-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </PageFrame>
  );
}
