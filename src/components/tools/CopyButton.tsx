"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Copies a receipt as plain text. Its name says what it copies; the outcome is announced politely
 * and shown in the button for two seconds.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2_000);
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        aria-label={`copy ${label}`}
        className="relative z-[1] rounded-[3px] border border-border-bright px-2 py-1 font-mono text-[11px] text-fg-muted transition-colors hover:border-fg-muted hover:text-foreground"
      >
        {state === "copied" ? "copied" : state === "failed" ? "copy blocked" : "copy"}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === "copied"
          ? "receipt copied"
          : state === "failed"
            ? "the browser blocked copying"
            : ""}
      </span>
    </>
  );
}
