"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  type InkthreadDocument,
  type InkthreadJob,
  inkthread,
  type Reading,
} from "@/capabilities/inkthread";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { CopyButton } from "@/components/tools/CopyButton";
import { Outcome } from "@/components/tools/Outcome";
import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON_QUIET, MONO_BLOCK } from "@/components/tools/styles";
import { TableGrid } from "@/components/tools/TableGrid";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { useBudgets } from "../BudgetProvider";
import { callTool } from "../client";
import { plural } from "../format";
import { SamplePicker } from "../inkthread/SamplePicker";
import type { ToolOutcome } from "../outcome";
import { pollTool } from "../poll";
import { needsLoad } from "../run-action";
import { useAction } from "../use-action";
import { type UploadAnswer, uploadPdf } from "./upload";

/**
 * inkgrid's workbench (spec 21 §5, §5.1). inkgrid is a library with no HTTP surface of its own:
 * inkthread runs it on every document and keeps its reading — exact tables, findings, and the
 * verification report a second PDF engine wrote. Pick a sample or upload a PDF (budget `upload`;
 * the job is followed every 3 s), then read it.
 */

export type InkgridState = {
  samples?: ToolOutcome<{ items: InkthreadDocument[] }>;
  doc?: string;
  reading?: ToolOutcome<Reading>;
  upload?: ToolOutcome<UploadAnswer>;
};

const JOB_POLL_MS = 3_000;
const JOB_DEADLINE_MS = 10 * 60_000;

type JobState =
  | { phase: "idle" }
  | { phase: "following"; job: InkthreadJob | null }
  | { phase: "ended"; job: InkthreadJob | null; problem: string | null };

export function InkgridWorkbench({
  initial = {},
  doc: linked = null,
}: {
  initial?: InkgridState;
  doc?: string | null;
}) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const samples = useAction(initial.samples ?? null);
  const reading = useAction(initial.reading ?? null);
  const upload = useAction<UploadAnswer>(initial.upload ?? null);
  const [doc, setDoc] = useState<string | null>(initial.doc ?? linked);
  const [job, setJob] = useState<JobState>({ phase: "idle" });
  const fileInput = useRef<HTMLInputElement>(null);
  const following = useRef<AbortController | null>(null);
  useEffect(() => () => following.current?.abort(), []);

  const read = (id: string) => {
    setDoc(id);
    void reading.run((signal) => callTool(inkthread.reading, { documentId: id }, { signal }));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the gate opens
  useEffect(() => {
    if (!ready) return;
    if (!needsLoad(samples.outcome)) {
      // The samples came back; a reading that failed (asleep) is read again.
      if (doc !== null && needsLoad(reading.outcome)) read(doc);
      return;
    }
    void samples
      .run((signal) => callTool(inkthread.samples, {}, { signal }))
      .then((outcome) => {
        if (!needsLoad(reading.outcome)) return;
        const first = doc ?? (outcome?.ok ? (outcome.data.items[0]?.id ?? null) : null);
        if (first) read(first);
      });
  }, [ready]);

  async function uploadAndRead(file: File) {
    const answer = await upload.run((signal) => uploadPdf(file, { signal }));
    refresh();
    // A refused upload is already the action's outcome (and an asleep one re-wakes inkthread).
    if (answer === null || !answer.ok) return;
    const { document_id: id, job_id: jobId } = answer.data;
    setDoc(id);
    if (jobId === null) {
      read(id);
      return;
    }
    following.current?.abort();
    const controller = new AbortController();
    following.current = controller;
    setJob({ phase: "following", job: null });
    const end = await pollTool<InkthreadJob>({
      call: (signal) => callTool(inkthread.job, { jobId }, { signal }),
      isTerminal: (j) => j.status === "succeeded" || j.status === "failed",
      onData: (j) => setJob({ phase: "following", job: j }),
      intervalMs: JOB_POLL_MS,
      deadlineMs: JOB_DEADLINE_MS,
      signal: controller.signal,
    });
    if (end.kind === "aborted") return;
    if (end.kind === "done" && end.data.status === "succeeded") {
      setJob({ phase: "ended", job: end.data, problem: null });
      read(id);
      return;
    }
    const problem =
      end.kind === "done"
        ? `the job failed: ${end.data.error?.message ?? "no reason given"}`
        : end.kind === "timeout"
          ? "the job did not finish within 10 minutes"
          : null;
    // Ruling AI: through the action, so an asleep job poll re-wakes inkthread like any call.
    if (end.kind === "failed") upload.set(end.failure);
    setJob({ phase: "ended", job: null, problem });
  }

  const list = samples.outcome?.ok ? samples.outcome.data.items : [];

  return (
    <div className="space-y-8">
      <p className="max-w-3xl font-mono text-xs leading-relaxed text-fg-muted">
        <span className="text-foreground">inkgrid has no HTTP surface of its own:</span> this
        reading is inkthread’s, which runs inkgrid on every document and keeps its tables, findings
        and verification report.
      </p>

      <Panel id="inkgrid-document" title="the document" hint="a curated sample, or your own PDF">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <SamplePicker
                samples={list}
                value={doc}
                onChange={(id) => id && read(id)}
                disabled={!ready}
              />
              <button
                type="button"
                onClick={() => doc && read(doc)}
                disabled={!ready || doc === null || reading.busy}
                className={BUTTON_QUIET}
              >
                read the tables
              </button>
            </div>
            {samples.outcome && !samples.outcome.ok ? (
              <OutcomeNotice failure={samples.outcome} product="inkthread" />
            ) : null}
          </div>
          <div className="space-y-3">
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
                if (file) void uploadAndRead(file);
              }}
            />
            <BudgetedAction
              budget="upload"
              label="upload and read a PDF"
              busyLabel={job.phase === "following" ? "reading…" : "uploading…"}
              busy={upload.busy || job.phase === "following"}
              onRun={() => fileInput.current?.click()}
            />
            <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
              Up to 4 MB. inkthread processes the PDF and never keeps it: the bytes are dropped once
              read, and the reading goes with the document after an hour.
            </p>
            <JobLine job={job} />
            {upload.outcome && !upload.outcome.ok ? (
              <OutcomeNotice failure={upload.outcome} product="inkthread" />
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel
        id="inkgrid-reading"
        title="the reading"
        hint={
          doc ? (
            <Link
              href={`/tools/inkthread?doc=${doc}`}
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              see this document as a graph →
            </Link>
          ) : undefined
        }
      >
        <Outcome state={reading} product="inkthread" what="the reading">
          {(r, requestId) => <ReadingView reading={r} requestId={requestId} />}
        </Outcome>
      </Panel>
    </div>
  );
}

function JobLine({ job }: { job: JobState }) {
  if (job.phase === "idle") return null;
  if (job.phase === "following") {
    return (
      <p className="font-mono text-xs text-fg-muted" aria-live="polite">
        inkthread is reading it ·{" "}
        {job.job ? `${job.job.status}${job.job.stage ? ` · ${job.job.stage}` : ""}` : "queued"} ·
        checking every 3 s
      </p>
    );
  }
  return job.problem ? <p className="font-mono text-xs text-warning">{job.problem}</p> : null;
}

/** Defects grouped by code: how many, on which pages. */
function defectGroups(r: Reading): { code: string; count: number; pages: number[] }[] {
  const groups = new Map<string, { count: number; pages: Set<number> }>();
  for (const d of r.verification.defects) {
    const g = groups.get(d.code) ?? { count: 0, pages: new Set<number>() };
    g.count += 1;
    g.pages.add(d.page);
    groups.set(d.code, g);
  }
  return [...groups].map(([code, g]) => ({
    code,
    count: g.count,
    pages: [...g.pages].sort((a, b) => a - b),
  }));
}

function ReadingView({ reading: r, requestId }: { reading: Reading; requestId: string }) {
  const v = r.verification;
  const groups = defectGroups(r);
  return (
    <div className="space-y-8">
      <WithReceipt
        receipt={
          <ToolReceipt
            kind="inkgrid verification"
            serial={r.doc_sha256.slice(0, 8)}
            title={`${plural(v.checked, "page")} checked by a second engine`}
            stamp={
              v.ok
                ? { text: "agrees", tone: "pass" }
                : { text: plural(v.disagreements, "disagreement"), tone: "neutral" }
            }
            lines={[
              { label: "engine", value: v.engine },
              { label: "pages checked", value: String(v.checked) },
              { label: "disagreements", value: String(v.disagreements) },
              { label: "tables", value: String(r.tables.length) },
              { label: "inkgrid", value: r.inkgrid_version },
            ]}
            extra={[
              `document sha256: ${r.doc_sha256}`,
              ...v.defects.map((d) => `page ${d.page} ${d.code}: ${d.message}`),
            ]}
            requestId={requestId}
          />
        }
      >
        <div className="space-y-4 font-mono text-xs leading-relaxed">
          <p className="text-foreground">
            {v.ok
              ? `Every page agrees: ${v.engine} read the same characters as inkgrid.`
              : `${v.engine} disagrees with inkgrid ${plural(v.disagreements, "time")}:`}
          </p>
          {groups.length > 0 ? (
            <ul className="space-y-0.5 text-fg-muted">
              {groups.map((g) => (
                <li key={g.code}>
                  <span className="text-warning">{g.code}</span> ×{g.count} ·{" "}
                  {g.pages.length === 1 ? "page" : "pages"} {g.pages.join(", ")}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-fg-muted">
            findings:{" "}
            {r.findings.length === 0
              ? "none"
              : r.findings
                  .map((f) => `${f.code} (${f.severity}${f.page ? `, p. ${f.page}` : ""})`)
                  .join(" · ")}
          </p>
          <p className="text-fg-muted">
            {r.tables.length === 0
              ? "inkgrid found no tables in this document."
              : `${plural(r.tables.length, "table")}, each exactly as read: open one to see its cells and its text.`}
          </p>
        </div>
      </WithReceipt>

      {r.tables.length > 0 ? (
        <div className="space-y-3">
          {r.tables.map((t, i) => {
            const shape = `${plural(t.header_rows, "header row")} · ${plural(t.rows.length - t.header_rows, "data row")}`;
            return (
              <details
                key={t.id}
                data-table={t.id}
                open={i === 0}
                className="group rounded-[3px] border border-border open:border-border-bright"
              >
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-3 py-2.5 font-mono text-xs transition-colors hover:bg-surface-hover">
                  <span className="text-foreground">
                    <span
                      aria-hidden="true"
                      className="mr-2 inline-block text-accent-violet transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                    table <span translate="no">{t.id}</span> · page {t.page}
                  </span>
                  <span className="text-fg-muted">{shape}</span>
                </summary>
                <div className="space-y-3 border-t border-border p-3">
                  <TableGrid
                    rows={t.rows}
                    headerRows={t.header_rows}
                    caption={`table ${t.id} · page ${t.page} · ${shape}`}
                  />
                  <div className="space-y-2">
                    <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                      the exact text, as Markdown
                    </p>
                    <pre className={MONO_BLOCK}>{t.markdown}</pre>
                    <CopyButton text={t.markdown} label={`table ${t.id} as Markdown`} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
