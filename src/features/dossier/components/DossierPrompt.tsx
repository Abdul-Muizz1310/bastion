"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  type DossierCreateResponse,
  type DossierMode,
  dossierCreateResponseSchema,
} from "@/features/dossier/schemas";

const AVAILABLE_SOURCES = [
  { id: "hackernews", label: "hackernews" },
  { id: "arxiv-cs", label: "arxiv-cs" },
  { id: "weather-live", label: "weather-live" },
] as const;

const MODES: { id: DossierMode; label: string; rounds: number }[] = [
  { id: "rapid", label: "rapid", rounds: 3 },
  { id: "standard", label: "standard", rounds: 5 },
  { id: "adversarial", label: "adversarial", rounds: 8 },
];

type Props = {
  canRun: boolean;
  roleLabel: string;
};

export function DossierPrompt({ canRun, roleLabel }: Props) {
  const router = useRouter();
  const [claim, setClaim] = useState("");
  const [sources, setSources] = useState<string[]>(["hackernews"]);
  const [mode, setMode] = useState<DossierMode>("standard");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSource(id: string) {
    setSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canRun) return;
    setError(null);

    if (!claim.trim()) {
      setError("Claim is required.");
      return;
    }
    if (sources.length === 0) {
      setError("Select at least one source.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/dossiers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), sources, mode }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const message =
          typeof body?.error === "string" ? body.error : `Request failed (${response.status})`;
        setError(message);
        setSubmitting(false);
        return;
      }

      const raw = await response.json();
      const parsed = dossierCreateResponseSchema.safeParse(raw);
      if (!parsed.success) {
        setError("Malformed response from server.");
        setSubmitting(false);
        return;
      }

      const data: DossierCreateResponse = parsed.data;
      router.push(`/dossiers/${data.dossier_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 font-mono text-sm">
      <div>
        <label
          htmlFor="claim"
          className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-fg-muted"
        >
          <span className="text-accent-violet">&gt;</span> claim
        </label>
        <textarea
          id="claim"
          name="claim"
          required
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          disabled={!canRun || submitting}
          maxLength={1024}
          rows={3}
          placeholder="what should the dossier adjudicate?"
          className="w-full resize-none rounded-lg border border-border bg-background/60 px-4 py-3 font-mono text-sm text-foreground placeholder-fg-faint transition-colors focus:border-accent-violet/60 focus:outline-none focus:shadow-[0_0_0_1px_rgb(167_139_250_/_0.3),0_0_30px_rgb(167_139_250_/_0.15)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <p className="mt-1 text-right font-mono text-[10px] text-fg-faint">{claim.length}/1024</p>
      </div>

      <div>
        <p className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-fg-muted">
          <span className="text-accent-violet">&gt;</span> sources
        </p>
        <div className="flex flex-wrap gap-2">
          {AVAILABLE_SOURCES.map((s) => {
            const selected = sources.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleSource(s.id)}
                disabled={!canRun || submitting}
                className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                  selected
                    ? "border-accent-violet/60 bg-accent-violet-soft text-accent-violet"
                    : "border-border bg-background/40 text-fg-muted hover:border-accent-violet/30 hover:text-foreground"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {selected ? "[x]" : "[ ]"} {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 block font-mono text-xs uppercase tracking-[0.2em] text-fg-muted">
          <span className="text-accent-violet">&gt;</span> mode
        </p>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => {
            const selected = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                disabled={!canRun || submitting}
                className={`rounded-lg border px-3 py-2 text-center font-mono text-xs transition-colors ${
                  selected
                    ? "border-accent-violet/60 bg-accent-violet-soft text-accent-violet"
                    : "border-border bg-background/40 text-fg-muted hover:border-accent-violet/30 hover:text-foreground"
                } disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <div>{m.label}</div>
                <div className="mt-0.5 text-[10px] text-fg-faint">{m.rounds} rounds</div>
              </button>
            );
          })}
        </div>
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
          {" · read-only — you can view dossiers but not create new ones."}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canRun || submitting || !claim.trim() || sources.length === 0}
        className="w-full rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-3 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.3)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "starting dossier..." : "▸ start dossier"}
      </button>
    </form>
  );
}
