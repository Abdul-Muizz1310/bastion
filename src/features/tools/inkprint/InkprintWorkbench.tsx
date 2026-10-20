"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type Certificate,
  type CertificateDetail,
  CORPORA,
  type DiffResult,
  inkprint,
  type LeakScanStatus,
  type VerifyResult,
} from "@/capabilities/inkprint";
import { AuditLink } from "@/components/tools/AuditLink";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { FieldError } from "@/components/tools/FieldError";
import { Outcome } from "@/components/tools/Outcome";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON_QUIET, INPUT, LABEL, MONO_BLOCK } from "@/components/tools/styles";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { useBudgets } from "../BudgetProvider";
import { callTool } from "../client";
import { plural, utc } from "../format";
import type { ToolOutcome } from "../outcome";
import { pollTool } from "../poll";
import { useAction } from "../use-action";

/**
 * inkprint's workbench (spec 21 §5, §5.1): certify text (budget `certify`), verify a certificate —
 * its manifest against its text, which the visitor may alter to watch a check fail — diff a new text
 * against a parent (budget `certify`, Ruling M), run a leak scan (budget `leakscan`, followed every
 * 3 s), and read the public key every signature verifies with.
 */

export type InkprintState = {
  certify?: ToolOutcome<Certificate>;
  verifyId?: string;
  loaded?: ToolOutcome<CertificateDetail>;
  verify?: ToolOutcome<VerifyResult>;
  diff?: ToolOutcome<DiffResult>;
  leak?: ToolOutcome<LeakScanStatus>;
};

const P = "inkprint";
const SAMPLE =
  "The fees subject to reduction upon establishment of small entity status must be paid in full until that status is established.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LEAK_POLL_MS = 3_000;
const LEAK_DEADLINE_MS = 5 * 60_000;

export function InkprintWorkbench({ initial = {} }: { initial?: InkprintState }) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const certify = useAction(initial.certify ?? null);
  const loaded = useAction(initial.loaded ?? null);
  const verify = useAction(initial.verify ?? null);
  const diff = useAction(initial.diff ?? null);
  const leak = useAction(initial.leak ?? null);
  const [text, setText] = useState(SAMPLE);
  const [author, setAuthor] = useState("a bastion visitor");
  const [verifyId, setVerifyId] = useState(initial.verifyId ?? "");
  const [verifyText, setVerifyText] = useState("");
  const [parentId, setParentId] = useState("");
  const [diffText, setDiffText] = useState("");
  const [scanId, setScanId] = useState("");
  const [corpora, setCorpora] = useState<readonly string[]>(CORPORA);
  const [leakNote, setLeakNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    Partial<Record<"certify" | "verify" | "diff" | "leak", string>>
  >({});
  const fail = (form: "certify" | "verify" | "diff" | "leak", message: string, field: string) => {
    setErrors((e) => ({ ...e, [form]: message }));
    document.getElementById(`${ids}-${field}`)?.focus();
  };
  const clear = (form: "certify" | "verify" | "diff" | "leak") =>
    setErrors((e) => ({ ...e, [form]: undefined }));
  const following = useRef<AbortController | null>(null);
  useEffect(() => () => following.current?.abort(), []);
  const ids = useId();

  const runCertify = async () => {
    if (text.trim() === "") return fail("certify", "Write some text to certify.", "text");
    if (author.trim() === "") return fail("certify", "Name an author.", "author");
    clear("certify");
    const outcome = await certify.run((signal) =>
      callTool(inkprint.certify, { text, author }, { signal }),
    );
    refresh();
    if (outcome?.ok) {
      // The new certificate is the one to verify, diff against and scan next.
      setVerifyId(outcome.data.id);
      setParentId(outcome.data.id);
      setScanId(outcome.data.id);
      setDiffText(`${text} (edited)`);
    }
  };

  const loadCertificate = async () => {
    if (!UUID.test(verifyId)) return fail("verify", "Paste a certificate id (a UUID).", "verify");
    clear("verify");
    verify.set(null);
    const outcome = await loaded.run((signal) =>
      callTool(inkprint.certificate, { id: verifyId }, { signal }),
    );
    if (outcome?.ok) setVerifyText(outcome.data.text);
  };

  const runVerify = () => {
    if (!loaded.outcome?.ok) return;
    const manifest = loaded.outcome.data.manifest;
    void verify.run((signal) =>
      callTool(inkprint.verify, { manifest, text: verifyText }, { signal }),
    );
  };

  const runDiff = () => {
    if (!UUID.test(parentId))
      return fail("diff", "Paste the parent certificate’s id (a UUID).", "parent");
    if (diffText === "") return fail("diff", "Write the new text to compare.", "diff-text");
    clear("diff");
    void diff
      .run((signal) => callTool(inkprint.diff, { parent_id: parentId, text: diffText }, { signal }))
      .then(() => refresh());
  };

  const runLeak = async () => {
    if (!UUID.test(scanId)) return fail("leak", "Paste a certificate id (a UUID).", "scan");
    if (corpora.length === 0) return fail("leak", "Choose at least one corpus.", "scan");
    clear("leak");
    setLeakNote(null);
    following.current?.abort();
    const controller = new AbortController();
    following.current = controller;
    const chosen = CORPORA.filter((c) => corpora.includes(c));
    const started = await leak.run(async (signal) => {
      const created = await callTool(
        inkprint.leakScan,
        { certificate_id: scanId, corpora: chosen },
        { signal },
      );
      if (!created.ok) return created;
      const end = await pollTool<LeakScanStatus>({
        call: (s) => callTool(inkprint.leakScanStatus, { id: created.data.scan_id }, { signal: s }),
        isTerminal: (s) => s.status === "complete" || s.status === "error",
        onData: (s) =>
          setLeakNote(`scan ${s.scan_id.slice(0, 8)} · ${s.status} · checking every 3 s`),
        intervalMs: LEAK_POLL_MS,
        deadlineMs: LEAK_DEADLINE_MS,
        signal: AbortSignal.any([signal, controller.signal]),
      });
      if (end.kind === "done")
        return { ok: true, data: end.data, status: 200, requestId: end.requestId };
      if (end.kind === "failed") return end.failure;
      return {
        ok: false,
        kind: "unreachable",
        detail: end.kind === "timeout" ? "the scan did not finish within 5 minutes" : "stopped",
        requestId: created.requestId,
      };
    });
    refresh();
    if (started) setLeakNote(null);
  };

  return (
    <div className="space-y-8">
      <Panel
        id="inkprint-certify"
        title="certify text"
        hint="Ed25519-signed, with a C2PA-aligned manifest"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-text`} className={LABEL}>
              text
            </label>
            <textarea
              id={`${ids}-text`}
              aria-describedby={`${ids}-certify-error`}
              name="text"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-author`} className={LABEL}>
              author
            </label>
            <input
              id={`${ids}-author`}
              aria-describedby={`${ids}-certify-error`}
              name="author"
              autoComplete="off"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className={INPUT}
            />
          </div>
        </div>
        <BudgetedAction
          budget="certify"
          label="certify"
          busyLabel="certifying…"
          busy={certify.busy}
          onRun={() => void runCertify()}
        />
        <FieldError id={`${ids}-certify-error`} message={errors.certify ?? null} />
        <Outcome state={certify} product={P} what="the certificate">
          {(cert, requestId) => <CertificateView cert={cert} requestId={requestId} />}
        </Outcome>
      </Panel>

      <div className="grid gap-8 xl:grid-cols-2">
        <Panel
          id="inkprint-verify"
          title="verify a certificate"
          hint="alter the text to watch a check fail"
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor={`${ids}-verify`} className={LABEL}>
                certificate id
              </label>
              <input
                id={`${ids}-verify`}
                aria-describedby={`${ids}-verify-error`}
                name="certificate"
                autoComplete="off"
                spellCheck={false}
                placeholder="2b9f6a1e-4c3d-…"
                value={verifyId}
                onChange={(e) => setVerifyId(e.target.value.trim())}
                className={INPUT}
              />
            </div>
            <button
              type="button"
              onClick={() => void loadCertificate()}
              disabled={!ready || loaded.busy}
              className={BUTTON_QUIET}
            >
              load it
            </button>
          </div>
          <FieldError id={`${ids}-verify-error`} message={errors.verify ?? null} />
          <Outcome state={loaded} product={P} what="the certificate">
            {(cert, requestId) => (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor={`${ids}-verify-text`} className={LABEL}>
                    its text — as certified, or as you change it
                  </label>
                  <textarea
                    id={`${ids}-verify-text`}
                    rows={3}
                    value={verifyText}
                    onChange={(e) => setVerifyText(e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <button
                    type="button"
                    onClick={runVerify}
                    disabled={!ready || verify.busy}
                    className={BUTTON_QUIET}
                  >
                    verify
                  </button>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {verifyText === cert.text
                      ? "the text as certified"
                      : "the text has been changed"}
                  </span>
                  <AuditLink requestId={requestId} />
                </div>
              </div>
            )}
          </Outcome>
          <Outcome state={verify} product={P} what="the verification">
            {(result, requestId) => (
              <VerifyView result={result} id={verifyId} requestId={requestId} />
            )}
          </Outcome>
        </Panel>

        <Panel
          id="inkprint-diff"
          title="diff against a parent"
          hint="SimHash and embedding distance"
        >
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-parent`} className={LABEL}>
              parent certificate id
            </label>
            <input
              id={`${ids}-parent`}
              aria-describedby={`${ids}-diff-error`}
              name="parent"
              autoComplete="off"
              spellCheck={false}
              placeholder="2b9f6a1e-4c3d-…"
              value={parentId}
              onChange={(e) => setParentId(e.target.value.trim())}
              className={INPUT}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-diff-text`} className={LABEL}>
              new text
            </label>
            <textarea
              id={`${ids}-diff-text`}
              aria-describedby={`${ids}-diff-error`}
              rows={3}
              value={diffText}
              onChange={(e) => setDiffText(e.target.value)}
              className={INPUT}
            />
          </div>
          <BudgetedAction
            budget="certify"
            label="diff against the parent"
            busyLabel="comparing…"
            busy={diff.busy}
            onRun={runDiff}
          />
          <FieldError id={`${ids}-diff-error`} message={errors.diff ?? null} />
          <Outcome state={diff} product={P} what="the diff">
            {(d, requestId) => (
              <ToolReceipt
                kind="inkprint diff"
                serial={parentId.slice(0, 8) || undefined}
                title={`${d.verdict} · ${d.overlap_pct} % overlap`}
                stamp={{ text: d.verdict, tone: "neutral" }}
                lines={[
                  { label: "verdict", value: d.verdict },
                  { label: "overlap", value: `${d.overlap_pct} %` },
                  { label: "simhash distance", value: `${d.hamming} bits` },
                  { label: "cosine", value: d.cosine.toFixed(4) },
                  { label: "changed spans", value: String(d.changed_spans.length) },
                ]}
                requestId={requestId}
              />
            )}
          </Outcome>
        </Panel>
      </div>

      <div className="grid gap-8 xl:grid-cols-2">
        <Panel
          id="inkprint-leak"
          title="leak scan"
          hint="is this certified text in a public training corpus?"
        >
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-scan`} className={LABEL}>
              certificate id
            </label>
            <input
              id={`${ids}-scan`}
              aria-describedby={`${ids}-leak-error`}
              name="scan"
              autoComplete="off"
              spellCheck={false}
              placeholder="2b9f6a1e-4c3d-…"
              value={scanId}
              onChange={(e) => setScanId(e.target.value.trim())}
              className={INPUT}
            />
          </div>
          <fieldset className="flex flex-wrap gap-x-5 gap-y-2">
            <legend className={`${LABEL} mb-1.5`}>corpora</legend>
            {CORPORA.map((c) => (
              <label key={c} className="flex items-center gap-2 font-mono text-xs text-foreground">
                <input
                  type="checkbox"
                  checked={corpora.includes(c)}
                  onChange={(e) =>
                    setCorpora((now) =>
                      e.target.checked ? [...now, c] : now.filter((x) => x !== c),
                    )
                  }
                  className="accent-[var(--accent-violet)]"
                />
                <span translate="no">{c}</span>
              </label>
            ))}
          </fieldset>
          <BudgetedAction
            budget="leakscan"
            label="run a leak scan"
            busyLabel="scanning…"
            busy={leak.busy}
            onRun={() => void runLeak()}
          />
          <FieldError id={`${ids}-leak-error`} message={errors.leak ?? null} />
          {leakNote ? (
            <p className="font-mono text-xs text-fg-muted" aria-live="polite">
              {leakNote}
            </p>
          ) : null}
          <Outcome state={leak} product={P} what="the leak scan">
            {(s, requestId) => <LeakView scan={s} requestId={requestId} />}
          </Outcome>
        </Panel>

        <PublicKeyPanel />
      </div>
    </div>
  );
}

function CertificateView({ cert, requestId }: { cert: Certificate; requestId: string }) {
  return (
    <WithReceipt
      receipt={
        <ToolReceipt
          kind="inkprint certificate"
          serial={cert.id.slice(0, 8)}
          title={`${plural(cert.content_len, "character")} by ${cert.author}`}
          stamp={{ text: "signed", tone: "pass" }}
          lines={[
            { label: "content hash", value: cert.content_hash },
            { label: "signature", value: `Ed25519 · ${cert.signature.slice(0, 16)}…` },
            { label: "issued", value: utc(cert.issued_at) },
            { label: "simhash", value: String(cert.simhash) },
          ]}
          extra={[
            `certificate: ${cert.id}`,
            `signature: ${cert.signature}`,
            `content hash: ${cert.content_hash}`,
          ]}
          requestId={requestId}
        />
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_8.5rem]">
        <dl className="min-w-0 space-y-2.5 font-mono text-xs">
          <div>
            <dt className="text-fg-muted">certificate</dt>
            <dd translate="no" className="break-all text-foreground">
              {cert.id}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">signature (Ed25519, base64)</dt>
            <dd translate="no" className="break-all text-foreground">
              {cert.signature}
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">content hash (sha256 of the canonical text)</dt>
            <dd translate="no" className="break-all text-foreground">
              {cert.content_hash}
            </dd>
          </div>
        </dl>
        <figure className="space-y-1">
          {/* biome-ignore lint/performance/noImgElement: inkprint's QR PNG through the gateway */}
          <img
            src={`/api/tools/inkprint.qr?id=${encodeURIComponent(cert.id)}`}
            alt={`QR code for certificate ${cert.id.slice(0, 8)}`}
            width={136}
            height={136}
            loading="lazy"
            className="rounded-[3px] border border-border bg-white p-1"
          />
          <figcaption className="font-mono text-[10px] text-fg-muted">scan to verify</figcaption>
        </figure>
      </div>
      <details className="mt-4">
        <summary className="cursor-pointer font-mono text-[11px] text-fg-muted hover:text-foreground">
          the C2PA manifest
        </summary>
        <pre className={`${MONO_BLOCK} mt-2`}>{JSON.stringify(cert.manifest, null, 2)}</pre>
      </details>
    </WithReceipt>
  );
}

function VerifyView({
  result,
  id,
  requestId,
}: {
  result: VerifyResult;
  id: string;
  requestId: string;
}) {
  const checks = Object.entries(result.checks);
  return (
    <ToolReceipt
      kind="inkprint verification"
      serial={id.slice(0, 8) || undefined}
      title={result.valid ? "the certificate holds" : "the certificate does not hold"}
      stamp={result.valid ? { text: "valid", tone: "pass" } : { text: "invalid", tone: "fail" }}
      lines={checks.map(([name, value]) => ({
        label: name,
        value: value === true ? "✓ pass" : value === false ? "✕ fail" : JSON.stringify(value),
      }))}
      extra={result.warnings.map((w) => `warning: ${w}`)}
      requestId={requestId}
    />
  );
}

function LeakView({ scan, requestId }: { scan: LeakScanStatus; requestId: string }) {
  return (
    <ToolReceipt
      kind="inkprint leak scan"
      serial={scan.scan_id.slice(0, 8)}
      title={`${plural(scan.hit_count, "hit")} across ${plural(scan.corpora.length, "corpus", "corpora")}`}
      stamp={
        scan.hit_count === 0
          ? { text: "not found", tone: "pass" }
          : { text: plural(scan.hit_count, "hit"), tone: "neutral" }
      }
      lines={[
        ...scan.results.map((r) => ({
          label: r.corpus,
          value: `${plural(r.hit_count, "hit")} · ${r.status}${r.snapshot ? ` · ${r.snapshot}` : ""}`,
        })),
        {
          label: "confidence",
          value: scan.confidence === null ? "none" : scan.confidence.toFixed(2),
        },
      ]}
      requestId={requestId}
    />
  );
}

/** The PEM every inkprint signature verifies with — a raw text answer, so read without a schema. */
function PublicKeyPanel() {
  const ready = useWakeReady();
  const [state, setState] = useState<
    | { phase: "idle" }
    | { phase: "busy" }
    | { phase: "ok"; pem: string; requestId: string }
    | { phase: "failed"; status: number }
  >({ phase: "idle" });
  const load = async () => {
    setState({ phase: "busy" });
    try {
      const res = await fetch("/api/tools/inkprint.publicKey", { cache: "no-store" });
      const body = await res.text();
      const requestId = res.headers.get("x-request-id") ?? "";
      if (res.ok && body.includes("-----BEGIN PUBLIC KEY-----"))
        setState({ phase: "ok", pem: body, requestId });
      else setState({ phase: "failed", status: res.status });
    } catch {
      setState({ phase: "failed", status: 0 });
    }
  };
  return (
    <Panel id="inkprint-key" title="the public key" hint="every signature above verifies with it">
      <button
        type="button"
        onClick={() => void load()}
        disabled={!ready || state.phase === "busy"}
        className={BUTTON_QUIET}
      >
        show inkprint’s public key
      </button>
      <div aria-live="polite">
        {state.phase === "ok" ? (
          <div className="space-y-2">
            <pre className={MONO_BLOCK}>{state.pem}</pre>
            {state.requestId ? <AuditLink requestId={state.requestId} /> : null}
          </div>
        ) : state.phase === "failed" ? (
          <p className="font-mono text-xs text-warning">
            inkprint did not hand over its key (
            {state.status === 0 ? "no answer" : `HTTP ${state.status}`}).
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
