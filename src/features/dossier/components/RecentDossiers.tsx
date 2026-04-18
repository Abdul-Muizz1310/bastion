import Link from "next/link";
import type { Dossier } from "@/lib/db/schema";

const STATUS_BADGE: Record<
  "pending" | "running" | "succeeded" | "failed",
  { label: string; classes: string }
> = {
  pending: { label: "pending", classes: "border-fg-faint/30 bg-surface text-fg-muted" },
  running: {
    label: "running",
    classes: "border-accent-violet/40 bg-accent-violet-soft text-accent-violet",
  },
  succeeded: { label: "ok", classes: "border-success/40 bg-success/10 text-success" },
  failed: { label: "failed", classes: "border-error/40 bg-error/10 text-error" },
};

function formatWhen(createdAt: Date): string {
  const delta = Date.now() - new Date(createdAt).getTime();
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function RecentDossiers({ dossiers }: { dossiers: Dossier[] }) {
  if (dossiers.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-surface/40 px-4 py-6 text-center font-mono text-xs text-fg-faint">
        no dossiers yet — start one above
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface/60">
      {dossiers.map((d) => {
        const badge = STATUS_BADGE[d.status];
        return (
          <Link
            key={d.id}
            href={`/dossiers/${d.id}`}
            className="block border-b border-border/60 px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm text-foreground">{d.claim}</p>
                <p className="mt-1 font-mono text-[11px] text-fg-faint">
                  {d.sources.join(", ")} · {d.mode} · {formatWhen(new Date(d.createdAt))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {d.verdict ? (
                  <span className="rounded border border-border/60 bg-background/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {d.verdict}
                  </span>
                ) : null}
                <span
                  className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${badge.classes}`}
                >
                  {badge.label}
                </span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
