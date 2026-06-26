"use client";

import { useState } from "react";
import { StepTimeline } from "@/features/dossier/components/StepTimeline";
import { dossierCreateResponseSchema } from "@/features/dossier/schemas";

// A one-click integrated demo: a fixed claim run through all five services via
// the gateway. The heavy lifting (pipeline, SSE, live step rendering) is the
// same machinery the dossier console uses — this just kicks it off and mounts
// the live timeline inline.
const DEMO_CLAIM =
  "Scrape a fresh Hacker News headline and adjudicate whether it holds up to scrutiny.";
const DEMO_SOURCES = ["hackernews"];
const DEMO_MODE = "rapid";

const STEPS = [
  { name: "magpie", label: "Scrape HN article" },
  { name: "inkprint", label: "Sign C2PA certificate" },
  { name: "paper-trail", label: "Run AI debate" },
  { name: "slowquery", label: "Capture slow queries" },
  { name: "audit", label: "Collect audit trail" },
];

type Props = {
  canRun: boolean;
  roleLabel: string;
};

export function RunDemoButton({ canRun, roleLabel }: Props) {
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (!canRun || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/dossiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: DEMO_CLAIM, sources: DEMO_SOURCES, mode: DEMO_MODE }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === "string" ? body.error : `Request failed (${response.status})`;
        setError(message);
        setSubmitting(false);
        return;
      }

      const parsed = dossierCreateResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        setError("Malformed response from server.");
        setSubmitting(false);
        return;
      }

      setDossierId(parsed.data.dossier_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  if (dossierId) {
    return (
      <StepTimeline
        dossierId={dossierId}
        initialEvents={[]}
        initialStatus="running"
        initialVerdict={null}
        initialConfidence={null}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {STEPS.map((step, i) => (
          <div
            key={step.name}
            className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3"
          >
            <span className="font-mono text-xs text-fg-faint">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="text-fg-faint">▶</span>
            <div className="flex-1">
              <span className="font-mono text-sm font-semibold">{step.name}</span>
              <span className="ml-2 font-mono text-xs text-fg-muted">{step.label}</span>
            </div>
            <span className="rounded-md border border-border px-2 py-0.5 font-mono text-[10px] text-fg-faint">
              pending
            </span>
          </div>
        ))}
      </div>

      {error ? (
        <p className="rounded-lg border border-error/30 bg-error/5 px-4 py-2 font-mono text-xs text-error">
          {error}
        </p>
      ) : null}

      {!canRun ? (
        <p className="rounded-lg border border-fg-faint/20 bg-surface px-4 py-2 font-mono text-xs text-fg-muted">
          {"// role: "}
          <span className="text-accent-violet">{roleLabel}</span>
          {" · read-only — running the demo requires admin or editor."}
        </p>
      ) : null}

      <button
        type="button"
        onClick={start}
        disabled={!canRun || submitting}
        className="w-full rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "starting demo..." : "▶ Run end-to-end platform demo"}
      </button>

      <p className="text-center font-mono text-[11px] text-fg-faint">
        requires admin or editor role · calls all services via gateway
      </p>
    </div>
  );
}
