"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { CheckState } from "@/dossier/checks";
import type { ToolOutcome } from "@/features/tools/outcome";
import { postVerify, type VerifyAnswer } from "../verify-answer";

/**
 * One "verify everything" run shared by the receipt (spec 21 §6.6): the panel that starts it and
 * every evidence row that shows its certificate's state once it has answered. A new run aborts the
 * one before it; leaving the page aborts the one in flight.
 */

type VerifyState = {
  busy: boolean;
  outcome: ToolOutcome<VerifyAnswer> | null;
  run: () => void;
};

const VerifyContext = createContext<VerifyState>({ busy: false, outcome: null, run: () => {} });

export function VerifyProvider({
  dossierId,
  initial = null,
  initialBusy = false,
  children,
}: {
  dossierId: string;
  /** A finished run's answer, and whether one is in flight (tests seed them). */
  initial?: ToolOutcome<VerifyAnswer> | null;
  initialBusy?: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState({ busy: initialBusy, outcome: initial });
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);

  const run = useCallback(() => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setState((s) => ({ busy: true, outcome: s.outcome }));
    postVerify(dossierId, { signal: controller.signal }).then(
      (outcome) => {
        if (!controller.signal.aborted) setState({ busy: false, outcome });
      },
      () => {
        if (controller.signal.aborted) return;
        setState({
          busy: false,
          outcome: {
            ok: false,
            kind: "unreachable",
            detail: "the page could not finish the call",
            requestId: null,
          },
        });
      },
    );
  }, [dossierId]);

  return <VerifyContext value={{ ...state, run }}>{children}</VerifyContext>;
}

export function useVerify(): VerifyState {
  return useContext(VerifyContext);
}

export const STATE_WORDS: Readonly<
  Record<CheckState, { glyph: string; word: string; tone: string }>
> = {
  pass: { glyph: "✓", word: "pass", tone: "text-success" },
  fail: { glyph: "✕", word: "fail", tone: "text-error" },
  unavailable: { glyph: "?", word: "unavailable", tone: "text-warning" },
  expired: { glyph: "⌛", word: "expired", tone: "text-fg-muted" },
};

/** One certificate's state in the last verification, written out (the evidence table's column). */
export function CertVerifyState({ certificateId }: { certificateId: string }) {
  const { busy, outcome } = useVerify();
  if (busy) return <span className="text-fg-muted">checking…</span>;
  if (outcome === null) return <span className="text-fg-muted">not checked yet</span>;
  if (!outcome.ok) return <span className="text-fg-muted">not checked: verify did not answer</span>;
  if (outcome.data.legacy) return <span className="text-fg-muted">predates verification</span>;
  const check = outcome.data.checks.find((c) => c.name === "certificates");
  const item = check?.items?.find((i) => i.ref.toLowerCase() === certificateId.toLowerCase());
  if (item === undefined) return <span className="text-fg-muted">not in the check</span>;
  const words = STATE_WORDS[item.state];
  return (
    <span className={words.tone} title={item.detail}>
      <span aria-hidden="true">{words.glyph} </span>
      {words.word}
    </span>
  );
}
