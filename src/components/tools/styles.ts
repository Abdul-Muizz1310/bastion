/**
 * The workbench's form vocabulary, as static class strings (so Tailwind sees every one): a primary
 * action, a quiet one, fields and their labels. Hairlines and mono type, the house style; the only
 * fill is the violet of the one action that spends something.
 */

export const BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-[3px] border border-accent-violet/70 bg-accent-violet-soft px-3.5 py-2 font-mono text-xs text-accent-violet transition-colors hover:bg-accent-violet hover:text-background disabled:cursor-not-allowed disabled:border-border-bright disabled:bg-transparent disabled:text-fg-muted";

export const BUTTON_QUIET =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-[3px] border border-border-bright bg-transparent px-3 py-2 font-mono text-xs text-foreground transition-colors hover:border-fg-muted hover:bg-surface-hover disabled:cursor-not-allowed disabled:text-fg-muted disabled:hover:bg-transparent";

export const INPUT =
  "w-full min-w-0 rounded-[3px] border border-border-bright bg-background px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-fg-muted transition-colors hover:border-fg-muted focus-visible:border-accent-violet";

export const LABEL = "block font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted";

export const MONO_BLOCK =
  "max-h-80 overflow-auto rounded-[3px] border border-border bg-background px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground/90";
