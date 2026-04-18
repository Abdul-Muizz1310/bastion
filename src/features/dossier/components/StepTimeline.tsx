"use client";

import { useEffect, useState } from "react";
import type { DossierEvent, DossierStatus, DossierStep, Verdict } from "@/features/dossier/schemas";
import { dossierEventSchema } from "@/features/dossier/schemas";

const STEPS: { key: DossierStep; label: string }[] = [
  { key: "gather", label: "gather" },
  { key: "seal", label: "seal" },
  { key: "adjudicate", label: "adjudicate" },
  { key: "measure", label: "measure" },
  { key: "envelope", label: "envelope" },
  { key: "record", label: "record" },
];

type StepState = {
  status: "pending" | "running" | "ok" | "error";
  latencyMs: number | null;
  error?: string;
};

function deriveStepStates(events: DossierEvent[]): Record<DossierStep, StepState> {
  const out: Record<DossierStep, StepState> = {
    gather: { status: "pending", latencyMs: null },
    seal: { status: "pending", latencyMs: null },
    adjudicate: { status: "pending", latencyMs: null },
    measure: { status: "pending", latencyMs: null },
    envelope: { status: "pending", latencyMs: null },
    record: { status: "pending", latencyMs: null },
  };
  for (const ev of events) {
    const prev = out[ev.step];
    if (ev.status === "started" && prev.status === "pending") {
      out[ev.step] = { status: "running", latencyMs: null };
    } else if (ev.status === "ok") {
      out[ev.step] = { status: "ok", latencyMs: ev.latency_ms };
    } else if (ev.status === "error") {
      out[ev.step] = {
        status: "error",
        latencyMs: ev.latency_ms,
        error: typeof ev.metadata?.error === "string" ? (ev.metadata.error as string) : undefined,
      };
    }
  }
  return out;
}

const DOT_COLOR: Record<StepState["status"], string> = {
  pending: "bg-fg-faint",
  running: "bg-accent-violet pulse-ring",
  ok: "bg-success",
  error: "bg-error",
};

type Props = {
  dossierId: string;
  initialEvents: DossierEvent[];
  initialStatus: DossierStatus;
  initialVerdict: Verdict | null;
  initialConfidence: number | null;
};

export function StepTimeline({
  dossierId,
  initialEvents,
  initialStatus,
  initialVerdict,
  initialConfidence,
}: Props) {
  const [events, setEvents] = useState<DossierEvent[]>(initialEvents);
  const [status, setStatus] = useState<DossierStatus>(initialStatus);
  const [verdict, setVerdict] = useState<Verdict | null>(initialVerdict);
  const [confidence, setConfidence] = useState<number | null>(initialConfidence);

  useEffect(() => {
    if (status === "succeeded" || status === "failed") return;

    const source = new EventSource(`/api/dossiers/${dossierId}/stream`);

    source.addEventListener("state", (e) => {
      try {
        const parsed = dossierEventSchema.parse(JSON.parse((e as MessageEvent).data));
        setEvents((prev) => [...prev, parsed]);
      } catch {
        // Ignore malformed payloads — never let a bad event crash the UI.
      }
    });

    source.addEventListener("status", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        if (typeof data.status === "string") setStatus(data.status as DossierStatus);
        if (data.verdict === null || typeof data.verdict === "string") {
          setVerdict(data.verdict as Verdict | null);
        }
        if (data.confidence === null || typeof data.confidence === "number") {
          setConfidence(data.confidence as number | null);
        } else if (typeof data.confidence === "string") {
          const n = Number.parseFloat(data.confidence);
          setConfidence(Number.isFinite(n) ? n : null);
        }
      } catch {
        // ignore
      }
    });

    source.addEventListener("done", () => {
      source.close();
    });

    return () => source.close();
  }, [dossierId, status]);

  const states = deriveStepStates(events);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-fg-muted">pipeline</span>
        <VerdictBadge status={status} verdict={verdict} confidence={confidence} />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full border-collapse font-mono text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.15em] text-fg-faint">
              <th className="px-4 py-2">step</th>
              <th className="px-4 py-2">status</th>
              <th className="px-4 py-2 text-right">latency</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map(({ key, label }) => {
              const s = states[key];
              return (
                <tr key={key} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2.5 text-accent-violet">{label}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${DOT_COLOR[s.status]}`}
                      />
                      <span
                        className={
                          s.status === "error"
                            ? "text-error"
                            : s.status === "pending"
                              ? "text-fg-faint"
                              : "text-foreground"
                        }
                      >
                        {s.status}
                      </span>
                      {s.error ? (
                        <span className="ml-2 text-xs text-fg-muted">{s.error}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-fg-muted">
                    {s.latencyMs !== null ? `${s.latencyMs}ms` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VerdictBadge({
  status,
  verdict,
  confidence,
}: {
  status: DossierStatus;
  verdict: Verdict | null;
  confidence: number | null;
}) {
  if (status === "running" || status === "pending") {
    return (
      <span className="flex items-center gap-2 font-mono text-xs text-fg-muted">
        <span className="pulse-ring inline-block h-2 w-2 rounded-full bg-accent-violet" />
        running
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-lg border border-error/30 bg-error/10 px-3 py-1 font-mono text-xs uppercase text-error">
        failed
      </span>
    );
  }
  if (!verdict) {
    return (
      <span className="rounded-lg border border-fg-faint/30 px-3 py-1 font-mono text-xs uppercase text-fg-muted">
        {status}
      </span>
    );
  }
  const color =
    verdict === "TRUE"
      ? "border-success/40 bg-success/10 text-success"
      : verdict === "FALSE"
        ? "border-error/40 bg-error/10 text-error"
        : "border-warning/40 bg-warning/10 text-warning";
  return (
    <span
      className={`flex items-center gap-2 rounded-lg border px-3 py-1 font-mono text-xs uppercase ${color}`}
    >
      <span>{verdict}</span>
      {confidence !== null ? (
        <span className="text-fg-muted">· {(confidence * 100).toFixed(0)}%</span>
      ) : null}
    </span>
  );
}
