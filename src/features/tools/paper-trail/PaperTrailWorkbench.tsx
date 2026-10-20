"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  type Debate,
  type DebateList,
  MAX_DEBATE_ROUNDS,
  paperTrail,
} from "@/capabilities/paper-trail";
import type { ReceiptTone } from "@/components/receipts/ReceiptCard";
import { AuditLink } from "@/components/tools/AuditLink";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { FieldError } from "@/components/tools/FieldError";
import { Outcome } from "@/components/tools/Outcome";
import { Panel, WithReceipt } from "@/components/tools/Panel";
import { BUTTON_QUIET, INPUT, LABEL } from "@/components/tools/styles";
import { ToolReceipt } from "@/components/tools/ToolReceipt";
import { useWakeReady } from "@/components/tools/WakeGate";
import { useBudgets } from "../BudgetProvider";
import { callTool, getRoute } from "../client";
import { plural, utc } from "../format";
import type { ToolOutcome } from "../outcome";
import { pollTool } from "../poll";
import { needsLoad } from "../run-action";
import { useAction } from "../use-action";
import { type TranscriptCheck, transcriptCheckSchema } from "./check-result";
import { readRounds } from "./rounds";

/**
 * paper-trail's workbench (spec 21 §5, §5.1): debate a claim (budget `debate`), then follow it with
 * `paper-trail.debateGet` every 2 s until it is done or failed, the rounds shown as they arrive; or
 * open a recent debate. The receipt — `transcript_hash` and the Ed25519 signature — is checked live
 * by bastion against paper-trail's published key, and only a real check reads as a pass.
 */

export type PaperTrailState = {
  debate?: ToolOutcome<Debate>;
  following?: boolean;
  check?: ToolOutcome<TranscriptCheck>;
  recent?: ToolOutcome<DebateList>;
};

const P = "paper-trail";
const POLL_MS = 2_000;
const DEADLINE_MS = 10 * 60_000;
const DEFAULT_CLAIM = "The USPTO basic filing fee for a utility patent is 350 dollars.";

const VERDICT_TONE: Readonly<Record<string, ReceiptTone>> = {
  TRUE: "pass",
  FALSE: "fail",
  INCONCLUSIVE: "neutral",
};

export function PaperTrailWorkbench({ initial = {} }: { initial?: PaperTrailState }) {
  const ready = useWakeReady();
  const { refresh } = useBudgets();
  const creating = useAction<{ debate_id: string }>(null);
  const debate = useAction(initial.debate ?? null);
  const check = useAction(initial.check ?? null);
  const recent = useAction(initial.recent ?? null);
  const [following, setFollowing] = useState(initial.following ?? false);
  const [note, setNote] = useState<string | null>(null);
  const [claim, setClaim] = useState(DEFAULT_CLAIM);
  const [rounds, setRounds] = useState(1);
  const [claimError, setClaimError] = useState<string | null>(null);
  const follow = useRef<AbortController | null>(null);
  useEffect(() => () => follow.current?.abort(), []);
  const ids = useId();

  const runCheck = (id: string) =>
    void check.run((signal) =>
      getRoute(
        `/api/platform/transcript-check?id=${encodeURIComponent(id)}`,
        transcriptCheckSchema,
        {
          signal,
        },
      ),
    );

  const open = async (id: string) => {
    follow.current?.abort();
    const controller = new AbortController();
    follow.current = controller;
    check.set(null);
    setNote(null);
    setFollowing(true);
    const end = await pollTool<Debate>({
      call: (signal) => callTool(paperTrail.debateGet, { id }, { signal }),
      isTerminal: (d) => d.status === "done" || d.status === "error",
      onData: (d, requestId) => debate.set({ ok: true, data: d, status: 200, requestId }),
      intervalMs: POLL_MS,
      deadlineMs: DEADLINE_MS,
      signal: controller.signal,
    });
    if (end.kind === "aborted") return;
    setFollowing(false);
    if (end.kind === "failed") debate.set(end.failure);
    if (end.kind === "timeout") {
      setNote("Stopped following after 10 minutes. Open it again from the recent debates.");
    }
    if (end.kind === "done" && end.data.status === "done") runCheck(id);
  };

  const start = async () => {
    if (claim.trim() === "") {
      setClaimError("Write the claim to debate.");
      document.getElementById(`${ids}-claim`)?.focus();
      return;
    }
    setClaimError(null);
    const created = await creating.run((signal) =>
      callTool(paperTrail.debate, { claim, max_rounds: rounds }, { signal }),
    );
    refresh();
    if (created?.ok) void open(created.data.debate_id);
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the gate opens
  useEffect(() => {
    if (!ready || !needsLoad(recent.outcome)) return;
    void recent.run((signal) => callTool(paperTrail.list, { limit: 5 }, { signal }));
  }, [ready]);

  const current = debate.outcome?.ok ? debate.outcome.data : null;

  return (
    <div className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Panel id="pt-debate" title="debate a claim" hint="a proponent, a skeptic and a judge">
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-claim`} className={LABEL}>
              claim
            </label>
            <textarea
              id={`${ids}-claim`}
              name="claim"
              aria-describedby={`${ids}-claim-error`}
              rows={3}
              maxLength={2000}
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              className={INPUT}
            />
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div className="space-y-1.5">
              <label htmlFor={`${ids}-rounds`} className={LABEL}>
                rounds
              </label>
              <select
                id={`${ids}-rounds`}
                value={rounds}
                onChange={(e) => setRounds(Number(e.target.value))}
                className={`${INPUT} w-24`}
              >
                {Array.from({ length: MAX_DEBATE_ROUNDS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <BudgetedAction
              budget="debate"
              label="start the debate"
              busyLabel="starting…"
              busy={creating.busy || following}
              onRun={() => void start()}
            />
          </div>
          <FieldError id={`${ids}-claim-error`} message={claimError} />
          <p className="font-mono text-[11px] leading-relaxed text-fg-muted">
            Each debate spends the free model quota every visitor shares, so there are a few a day.
            A recent debate costs nothing to open.
          </p>
          {creating.outcome && !creating.outcome.ok ? (
            <Outcome state={creating} product={P} what="the debate">
              {() => null}
            </Outcome>
          ) : null}
        </Panel>

        <Panel id="pt-recent" title="recent debates" hint="open one: no budget spent">
          <Outcome state={recent} product={P} what="the recent debates">
            {(page, requestId) =>
              page.items.length === 0 ? (
                <div className="space-y-3">
                  <p className="font-mono text-xs text-fg-muted">No debates yet.</p>
                  <AuditLink requestId={requestId} />
                </div>
              ) : (
                <div className="space-y-3">
                  <ul className="space-y-2">
                    {page.items.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          onClick={() => void open(d.id)}
                          disabled={!ready}
                          className="w-full rounded-[3px] border border-border px-3 py-2 text-left font-mono text-xs transition-colors hover:border-fg-muted hover:bg-surface-hover disabled:cursor-not-allowed"
                        >
                          <span className="line-clamp-2 text-foreground">{d.claim}</span>
                          <span className="mt-1 block text-fg-muted">
                            {d.verdict ?? d.status} · {utc(d.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <AuditLink requestId={requestId} />
                </div>
              )
            }
          </Outcome>
        </Panel>
      </div>

      <Panel
        id="pt-rounds"
        title="the debate"
        hint={following ? "rounds appear as they finish · checking every 2 s" : undefined}
      >
        {debate.outcome === null ? (
          <p className="font-mono text-xs text-fg-muted">Start a debate or open a recent one.</p>
        ) : null}
        {note ? <p className="font-mono text-xs text-warning">{note}</p> : null}
        <Outcome state={{ busy: false, outcome: debate.outcome }} product={P} what="the debate">
          {(d) => <DebateView debate={d} following={following} />}
        </Outcome>
      </Panel>

      {current?.status === "done" || check.outcome !== null ? (
        <Panel
          id="pt-receipt"
          title="the receipt, checked live"
          hint="recomputed and verified now, by bastion"
        >
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => current && runCheck(current.id)}
              disabled={!ready || current === null || check.busy}
              className={BUTTON_QUIET}
            >
              check it again
            </button>
          </div>
          <Outcome state={check} product={P} what="the transcript check">
            {(c, requestId) => <CheckView check={c} requestId={requestId} />}
          </Outcome>
        </Panel>
      ) : null}
    </div>
  );
}

function DebateView({ debate: d, following }: { debate: Debate; following: boolean }) {
  const rounds = readRounds(d.rounds);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 font-mono text-xs">
        <p className="text-foreground">{d.claim}</p>
        <p className="text-fg-muted tabular-nums">
          debate {d.id.slice(0, 8)} · {d.status}
          {following ? " · following" : ""} ·{" "}
          {plural(rounds.length, "round entry", "round entries")}
        </p>
      </div>
      {rounds.length === 0 ? (
        <p className="font-mono text-xs text-fg-muted">No round has finished yet.</p>
      ) : (
        <ol className="space-y-3">
          {rounds.map((r, i) =>
            r.ok ? (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rounds arrive in order and never reorder
                key={i}
                className={`rounded-[3px] border-l-2 bg-surface/50 px-4 py-3 ${SIDE_CLASS[r.side] ?? "border-border-bright"}`}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">
                  {r.side} · round {r.round}
                </p>
                <p className="mt-1.5 whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/90 [overflow-wrap:anywhere]">
                  {r.argument}
                </p>
                {r.citations.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-fg-muted">
                    {r.citations.map((c) => (
                      <li key={`${c.type}:${c.ref}`}>
                        cites {c.type}{" "}
                        <span translate="no" className="text-accent-violet">
                          {c.ref}
                        </span>
                        {c.title ? ` — ${c.title}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ) : (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: rounds arrive in order and never reorder
                key={i}
                className="rounded-[3px] border border-dashed border-border-bright px-4 py-2 font-mono text-xs text-fg-muted"
              >
                a round entry bastion cannot read
              </li>
            ),
          )}
        </ol>
      )}
      {d.status === "done" && d.verdict ? (
        <p className="font-mono text-sm">
          verdict <span className="font-display font-bold text-accent-violet">{d.verdict}</span>
          {d.confidence === null ? "" : ` · confidence ${Math.round(d.confidence * 100)} %`}
        </p>
      ) : null}
      {d.status === "error" ? (
        <p className="font-mono text-xs text-error">paper-trail reports the debate failed.</p>
      ) : null}
    </div>
  );
}

const SIDE_CLASS: Readonly<Record<string, string>> = {
  proponent: "border-success",
  skeptic: "border-accent-rose",
  judge: "border-accent-violet",
};

const HASH_WORDS = { pass: "✓ recomputed", fail: "✕ does not match" } as const;
const SIGNATURE_WORDS = {
  pass: "✓ verified",
  fail: "✕ does not verify",
  unsigned: "– unsigned",
  unavailable: "? not checked",
} as const;

function CheckView({ check: c, requestId }: { check: TranscriptCheck; requestId: string }) {
  const alg = c.signature.alg ?? "Ed25519";
  return (
    <WithReceipt
      receipt={
        <ToolReceipt
          kind="paper-trail transcript"
          serial={c.debateId.slice(0, 8)}
          title={c.claim}
          stamp={{ text: c.verdict, tone: VERDICT_TONE[c.verdict] ?? "neutral" }}
          lines={[
            { label: "transcript hash", value: c.transcriptHash },
            { label: "hash", value: HASH_WORDS[c.hash.state] },
            { label: `${alg} signature`, value: SIGNATURE_WORDS[c.signature.state] },
            { label: "confidence", value: `${Math.round(c.confidence * 100)} %` },
          ]}
          extra={[`transcript_hash: ${c.transcriptHash}`, `debate: ${c.debateId}`]}
          requestId={requestId}
        />
      }
    >
      <ul className="space-y-3 font-mono text-xs leading-relaxed">
        <li>
          <span className={c.hash.state === "pass" ? "text-success" : "text-error"}>
            hash {HASH_WORDS[c.hash.state]}
          </span>
          <span className="block text-fg-muted">
            {c.hash.state === "pass"
              ? `bastion rebuilt the ${c.hash.form ?? ""} form paper-trail hashes from the rounds it served, and its SHA-256 is transcript_hash.`
              : "The rounds as served do not hash to transcript_hash."}
          </span>
        </li>
        <li>
          <span
            className={
              c.signature.state === "pass"
                ? "text-success"
                : c.signature.state === "fail"
                  ? "text-error"
                  : "text-warning"
            }
          >
            {alg} signature {SIGNATURE_WORDS[c.signature.state]}
          </span>
          <span className="block text-fg-muted">{c.signature.detail}</span>
        </li>
      </ul>
    </WithReceipt>
  );
}
