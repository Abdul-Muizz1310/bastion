"use client";

import { useEffect, useRef, useState } from "react";
import { type InkthreadDocument, inkthread } from "@/capabilities/inkthread";
import { AuditLink } from "@/components/tools/AuditLink";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { HELD_REASON, whenLive } from "@/components/tools/held";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { BUTTON_QUIET } from "@/components/tools/styles";
import { useWakeReady } from "@/components/tools/WakeGate";
import { MAX_DOCUMENTS } from "@/dossier/limits";
import { useBudgets } from "@/features/tools/BudgetProvider";
import { callTool } from "@/features/tools/client";
import { type UploadAnswer, uploadPdf } from "@/features/tools/inkgrid/upload";
import { docLabel } from "@/features/tools/inkthread/SamplePicker";
import type { ToolOutcome } from "@/features/tools/outcome";
import { useAction, useFirstLoad } from "@/features/tools/use-action";
import type { PickedDocument } from "../compose";

/**
 * The documents of a new dossier (spec 21 §6.6, "Compose"): inkthread's samples, or a PDF the
 * visitor uploads (`POST /api/uploads`, budget `upload`), at most three together, behind
 * inkthread's wake gate. Ruling X: before any upload control the form says the dossier is public
 * and that the passages it quotes from a PDF — an uploaded one included — become part of it, while
 * inkthread never keeps the PDF's bytes (DR-0029). The upload is read by the dossier's own read
 * stage, which waits on its job; nothing here follows it.
 */

export function DocumentPicker({
  value,
  onChange,
  initial = null,
  initialUpload = null,
}: {
  value: readonly PickedDocument[];
  onChange: (next: PickedDocument[]) => void;
  initial?: ToolOutcome<{ items: InkthreadDocument[] }> | null;
  initialUpload?: ToolOutcome<UploadAnswer> | null;
}) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const samples = useAction<{ items: InkthreadDocument[] }>(initial);
  const upload = useAction<UploadAnswer>(initialUpload);
  const firstLoad = useFirstLoad();
  const fileInput = useRef<HTMLInputElement>(null);
  const [held, setHeld] = useState(false);
  const load = () => void samples.run((signal) => callTool(inkthread.samples, {}, { signal }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the gate opens
  useEffect(() => {
    if (ready && firstLoad(samples.outcome)) load();
  }, [ready]);

  const full = value.length >= MAX_DOCUMENTS;
  const latest = useRef(value);
  latest.current = value;

  const toggleSample = (doc: InkthreadDocument, on: boolean) =>
    onChange(
      on
        ? [
            ...value.filter((v) => v.documentId !== doc.id),
            { documentId: doc.id, kind: "sample", jobId: null, label: docLabel(doc) },
          ]
        : value.filter((v) => v.documentId !== doc.id),
    );

  async function send(file: File) {
    const answer = await upload.run((signal) => uploadPdf(file, { signal }));
    refresh();
    if (answer === null || !answer.ok) return;
    const { document_id: documentId, job_id: jobId } = answer.data;
    const current = latest.current;
    if (current.some((d) => d.documentId === documentId)) return;
    onChange([...current, { documentId, kind: "upload", jobId, label: file.name }]);
  }

  // Invariant 1: the OS file dialog can outlive the gate, so its answer checks the gate too.
  const pick = whenLive(
    ready,
    (file: File) => {
      setHeld(false);
      void send(file);
    },
    () => setHeld(true),
  );

  const uploads = value.filter((d) => d.kind === "upload");
  const list = samples.outcome?.ok ? samples.outcome.data.items : [];

  return (
    <div className="space-y-5">
      <div
        data-notice="public-dossier"
        className="rounded-[3px] border border-warning/40 bg-background px-4 py-3 font-mono text-xs leading-relaxed"
      >
        <p className="font-semibold text-warning">A dossier is public.</p>
        <p className="mt-1 text-fg-muted">
          Anyone with its link can read it, and it joins the home page once it finishes. The
          passages it quotes from a PDF — one you upload included — become part of it: in the
          evidence table, drawn on their pages, and in the receipts bundle anyone can download.
          inkthread reads an upload and never keeps the PDF’s bytes; its pages and graph are gone
          after an hour, but the quoted passages stay. Upload only what you are happy to publish.
        </p>
      </div>

      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted">
          inkthread’s samples
        </p>
        {samples.busy ? (
          <p className="font-mono text-xs text-fg-muted">
            <span className="motion-safe:animate-pulse">reading inkthread’s samples…</span>
          </p>
        ) : null}
        {samples.outcome && !samples.outcome.ok ? (
          <OutcomeNotice failure={samples.outcome} product="inkthread" onRetry={load} />
        ) : null}
        {samples.outcome?.ok ? (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {list.map((doc) => {
                const checked = value.some((v) => v.documentId === doc.id);
                const off = !ready || (!checked && full);
                return (
                  <li key={doc.id}>
                    <label
                      className={`flex h-full gap-3 rounded-[3px] border px-3 py-2.5 font-mono text-xs transition-colors ${
                        checked
                          ? "border-accent-violet/70 bg-accent-violet-soft"
                          : "border-border-bright hover:border-fg-muted"
                      } ${off ? "cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        name="documents"
                        value={doc.id}
                        checked={checked}
                        disabled={off}
                        onChange={(e) => toggleSample(doc, e.target.checked)}
                        className="mt-0.5 accent-[var(--accent-violet)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-foreground [overflow-wrap:anywhere]">
                          {docLabel(doc)}
                        </span>
                        <span className="block text-fg-muted tabular-nums">
                          sample{doc.stats ? ` · ${doc.stats.nodes} elements` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <AuditLink requestId={samples.outcome.requestId} />
          </>
        ) : null}
      </div>

      <div className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted">
          your own PDF
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) pick(file);
          }}
        />
        <BudgetedAction
          budget="upload"
          label="upload a PDF"
          busyLabel="uploading…"
          busy={upload.busy}
          disabled={full}
          onRun={() => fileInput.current?.click()}
        />
        <p
          aria-live="polite"
          data-held-notice="upload"
          className="font-mono text-[11px] text-warning"
        >
          {!ready && held ? `The PDF was not uploaded. ${HELD_REASON}` : ""}
        </p>
        <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
          Up to 4 MB. The dossier’s read stage waits for inkthread to finish reading it.
          {full ? ` ${MAX_DOCUMENTS} documents are picked: remove one to add another.` : ""}
        </p>
        {upload.outcome && !upload.outcome.ok ? (
          <OutcomeNotice failure={upload.outcome} product="inkthread" />
        ) : null}
        {uploads.length > 0 ? (
          <ul className="space-y-2">
            {uploads.map((d) => (
              <li
                key={d.documentId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[3px] border border-accent-violet/50 bg-accent-violet-soft px-3 py-2 font-mono text-xs"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="text-foreground">{d.label}</span>
                  <span className="block text-fg-muted" translate="no">
                    upload · {d.documentId.slice(0, 8)}
                    {d.jobId === null
                      ? " · already read by inkthread"
                      : " · inkthread is reading it"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v.documentId !== d.documentId))}
                  aria-label={`remove ${d.label}`}
                  className={BUTTON_QUIET}
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {ready ? null : <p className="font-mono text-[11px] text-fg-muted">{HELD_REASON}</p>}
    </div>
  );
}
