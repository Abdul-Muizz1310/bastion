"use client";

import { useEffect } from "react";
import { type MagpieSource, magpie } from "@/capabilities/magpie";
import { AuditLink } from "@/components/tools/AuditLink";
import { HELD_REASON } from "@/components/tools/held";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { useWakeReady } from "@/components/tools/WakeGate";
import { MAX_SOURCES } from "@/dossier/limits";
import { callTool } from "@/features/tools/client";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction, useFirstLoad } from "@/features/tools/use-action";

/**
 * The web sources of a new dossier (spec 21 §6.6, "Compose"): magpie's sources (`magpie.sources`),
 * loaded once magpie's wake gate is live, at most five picked. Every box is held until then (§5.1
 * invariant 1); the list read links its request id to the audit trail.
 */

export function SourcePicker({
  value,
  onChange,
  initial = null,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  initial?: ToolOutcome<MagpieSource[]> | null;
}) {
  const ready = useWakeReady();
  const sources = useAction<MagpieSource[]>(initial);
  const firstLoad = useFirstLoad();
  const load = () => void sources.run((signal) => callTool(magpie.sources, {}, { signal }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the gate opens
  useEffect(() => {
    if (ready && firstLoad(sources.outcome)) load();
  }, [ready]);

  const full = value.length >= MAX_SOURCES;
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...value.filter((v) => v !== name), name] : value.filter((v) => v !== name));

  const outcome = sources.outcome;
  return (
    <div className="space-y-3">
      {sources.busy ? (
        <p className="font-mono text-xs text-fg-muted">
          <span className="motion-safe:animate-pulse">reading magpie’s sources…</span>
        </p>
      ) : null}
      {outcome && !outcome.ok ? (
        <OutcomeNotice failure={outcome} product="magpie" onRetry={load} />
      ) : null}
      {outcome?.ok ? (
        outcome.data.length === 0 ? (
          <p className="font-mono text-xs text-fg-muted">magpie has no sources to scrape.</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {outcome.data.map((s) => {
                const checked = value.includes(s.name);
                const held = !ready || (!checked && full);
                return (
                  <li key={s.name}>
                    <label
                      className={`flex h-full gap-3 rounded-[3px] border px-3 py-2.5 font-mono text-xs transition-colors ${
                        checked
                          ? "border-accent-violet/70 bg-accent-violet-soft"
                          : "border-border-bright hover:border-fg-muted"
                      } ${held ? "cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        name="sources"
                        value={s.name}
                        checked={checked}
                        disabled={held}
                        onChange={(e) => toggle(s.name, e.target.checked)}
                        className="mt-0.5 accent-[var(--accent-violet)]"
                      />
                      <span className="min-w-0">
                        <span translate="no" className="block text-foreground">
                          {s.name}
                        </span>
                        {s.description ? (
                          <span className="block text-fg-muted">{s.description}</span>
                        ) : null}
                        <span className="block text-fg-muted tabular-nums">
                          {s.item_count} items
                          {s.last_status ? ` · last run ${s.last_status}` : " · never run"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-[11px] text-fg-muted">
              <span className="tabular-nums">
                {value.length} of at most {MAX_SOURCES} picked
                {full ? " · unpick one to pick another" : ""}
              </span>
              <AuditLink requestId={outcome.requestId} />
            </p>
          </>
        )
      ) : null}
      {ready ? null : <p className="font-mono text-[11px] text-fg-muted">{HELD_REASON}</p>}
    </div>
  );
}
