"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import type { InkthreadDocument } from "@/capabilities/inkthread";
import type { MagpieSource } from "@/capabilities/magpie";
import { BudgetMeter } from "@/components/platform/BudgetMeter";
import { FieldError } from "@/components/tools/FieldError";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { BUTTON, INPUT, LABEL } from "@/components/tools/styles";
import { WakeGate } from "@/components/tools/WakeGate";
import type { WakeState } from "@/components/tools/wake-model";
import { MAX_CLAIM, MODES, type Mode, ROUNDS } from "@/dossier/limits";
import { useBudgets } from "@/features/tools/BudgetProvider";
import { affordability } from "@/features/tools/budgets";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction } from "@/features/tools/use-action";
import {
  type ComposeAnswer,
  type ComposeDraft,
  type ComposeErrors,
  emptyDraft,
  runCompose,
  submitCompose,
} from "../compose";
import { DocumentPicker } from "./DocumentPicker";
import { SourcePicker } from "./SourcePicker";

/**
 * Compose a dossier (spec 21 §6.6, "Compose"): the claim, magpie's web sources and inkthread's
 * documents — each picker behind its own wake gate — the mode, and today's debates beside the run
 * button. The fields are checked when the visitor runs it (the first bad one takes focus); only the
 * debate budget, or a run already in flight, disables the button. A 202 goes to `/d/<id>`.
 */

export type ComposeSeed = {
  draft?: ComposeDraft;
  sources?: ToolOutcome<MagpieSource[]>;
  samples?: ToolOutcome<{ items: InkthreadDocument[] }>;
  submit?: ToolOutcome<ComposeAnswer>;
  gates?: { magpie?: WakeState; inkthread?: WakeState };
};

const MODE_WORDS: Readonly<Record<Mode, string>> = {
  rapid: "one round: proponent, skeptic, judge",
  standard: "two rounds: the sides answer each other once",
  adversarial: "three rounds: the hardest test, the slowest",
};

export function ComposeForm({ initial = {} }: { initial?: ComposeSeed }) {
  const router = useRouter();
  const { budgets, refresh } = useBudgets();
  const [draft, setDraft] = useState<ComposeDraft>(initial.draft ?? emptyDraft());
  const [errors, setErrors] = useState<ComposeErrors>({});
  const submit = useAction<ComposeAnswer>(initial.submit ?? null);
  const claimRef = useRef<HTMLTextAreaElement>(null);
  const evidenceRef = useRef<HTMLFieldSetElement>(null);
  const ids = { claim: useId(), claimError: useId(), evidenceError: useId(), reason: useId() };

  const debates = budgets?.debate ?? null;
  const spent = affordability(debates, 1) === "short";
  const set = (patch: Partial<ComposeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    const { errors: found } = await runCompose(draft, {
      submit: (body) => submit.run((signal) => submitCompose(body, { signal })),
      navigate: (url) => router.push(url),
      refreshBudgets: refresh,
    });
    setErrors(found);
    if (found.claim) claimRef.current?.focus();
    else if (found.evidence) evidenceRef.current?.focus();
  }

  const claimLength = draft.claim.trim().length;

  return (
    <form noValidate onSubmit={run} className="space-y-12">
      <Step index={1} title="the claim" hint="one sentence that can be true or false">
        <div className="space-y-1.5">
          <label htmlFor={ids.claim} className={LABEL}>
            claim to check
          </label>
          <textarea
            ref={claimRef}
            id={ids.claim}
            name="claim"
            rows={3}
            value={draft.claim}
            onChange={(e) => set({ claim: e.target.value })}
            aria-invalid={errors.claim ? true : undefined}
            aria-describedby={ids.claimError}
            placeholder="The 2025 fee schedule doubled the outgoing wire transfer charge…"
            className={`${INPUT} resize-y leading-relaxed`}
          />
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <FieldError id={ids.claimError} message={errors.claim ?? null} />
            <p
              className={`ml-auto font-mono text-[11px] tabular-nums ${
                claimLength > MAX_CLAIM ? "text-warning" : "text-fg-muted"
              }`}
            >
              {claimLength} / {MAX_CLAIM}
            </p>
          </div>
        </div>
      </Step>

      <fieldset
        ref={evidenceRef}
        tabIndex={-1}
        aria-describedby={ids.evidenceError}
        className="min-w-0 space-y-12 outline-none"
      >
        <legend className="sr-only">what the dossier reads: web sources, documents, or both</legend>
        <Step index={2} title="web sources" hint="magpie scrapes up to 5 items from each, live">
          <WakeGate name="magpie" services={["magpie"]} initial={initial.gates?.magpie}>
            <SourcePicker
              value={draft.sources}
              onChange={(sources) => set({ sources })}
              initial={initial.sources ?? null}
            />
          </WakeGate>
        </Step>

        <Step
          index={3}
          title="documents"
          hint="inkthread reads them exactly; inkgrid reads their tables"
        >
          <WakeGate name="inkthread" services={["inkthread"]} initial={initial.gates?.inkthread}>
            <DocumentPicker
              value={draft.documents}
              onChange={(documents) => set({ documents })}
              initial={initial.samples ?? null}
            />
          </WakeGate>
        </Step>
        <FieldError id={ids.evidenceError} message={errors.evidence ?? null} />
      </fieldset>

      <Step index={4} title="mode" hint="how long paper-trail argues">
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">mode</legend>
          {MODES.map((mode) => (
            <ModeOption
              key={mode}
              mode={mode}
              checked={draft.mode === mode}
              onChange={() => set({ mode })}
            />
          ))}
        </fieldset>
      </Step>

      <div className="space-y-4 border-t border-dashed border-border-bright pt-8">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <button
            type="submit"
            disabled={spent || submit.busy}
            aria-busy={submit.busy || undefined}
            aria-describedby={spent ? ids.reason : undefined}
            className={`${BUTTON} min-h-11 px-6 text-sm`}
          >
            {submit.busy ? "starting the run…" : "run the dossier"}
            <span aria-hidden="true">→</span>
          </button>
          <div className="min-w-56 flex-1 sm:max-w-80">
            {debates === null ? (
              <p className="font-mono text-[11px] text-fg-muted">
                today’s debates budget could not be read · the server still reserves one when you
                run it
              </p>
            ) : (
              <BudgetMeter
                id="compose-budget-debate"
                label="debates left today"
                left={debates.left}
                limit={debates.limit}
              />
            )}
          </div>
        </div>
        {spent ? (
          <p id={ids.reason} className="font-mono text-xs text-warning">
            No debates left today — budgets reset at 00:00 UTC. They share the free model quota
            between every visitor.
          </p>
        ) : null}
        <p className="max-w-2xl font-mono text-[11px] leading-relaxed text-fg-muted">
          Running it spends one of today’s debates. The dossier opens at its own public URL and runs
          on its own; that page shows each stage live and, once sealed, the receipt.
        </p>
        <p aria-live="polite" className="sr-only">
          {submit.busy ? "starting the dossier…" : ""}
        </p>
        {submit.outcome && !submit.outcome.ok ? (
          <OutcomeNotice failure={submit.outcome} product="bastion" />
        ) : null}
      </div>
    </form>
  );
}

function Step({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-8 gap-y-4 lg:grid-cols-[12rem_minmax(0,1fr)]"
    >
      <header className="font-mono">
        <p aria-hidden="true" className="text-xs tabular-nums text-accent-violet">
          {String(index).padStart(2, "0")}
        </p>
        <h2 id={id} className="mt-1 font-display text-lg font-bold tracking-tight">
          {title}
        </h2>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{hint}</p>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ModeOption({
  mode,
  checked,
  onChange,
}: {
  mode: Mode;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  const rounds = ROUNDS[mode];
  return (
    <div
      className={`relative rounded-[3px] border px-3 py-2.5 font-mono text-xs transition-colors focus-within:border-accent-violet ${
        checked
          ? "border-accent-violet/70 bg-accent-violet-soft"
          : "border-border-bright hover:border-fg-muted"
      }`}
    >
      <input
        id={id}
        type="radio"
        name="mode"
        value={mode}
        checked={checked}
        onChange={onChange}
        className="peer absolute top-3 left-3 accent-[var(--accent-violet)]"
      />
      <label htmlFor={id} className="block cursor-pointer pl-6">
        <span className="block text-foreground">
          {mode} · {rounds} {rounds === 1 ? "round" : "rounds"}
        </span>
        <span className="block text-fg-muted">{MODE_WORDS[mode]}</span>
      </label>
    </div>
  );
}
