import type { DisplayState } from "@/features/health/model";

/**
 * How each health state is written (spec 21 §3.1 case 2): a word that always appears, a glyph that
 * helps at a glance, and a tone for colour. Shared by the HTML badge and the SVG map.
 */

export type Tone = "success" | "warning" | "error" | "violet" | "muted";

export const STATE_META: Readonly<
  Record<DisplayState, { label: string; glyph: string; tone: Tone; pulse: boolean }>
> = {
  live: { label: "live", glyph: "●", tone: "success", pulse: false },
  waking: { label: "waking", glyph: "◐", tone: "violet", pulse: true },
  asleep: { label: "asleep", glyph: "◌", tone: "warning", pulse: false },
  down: { label: "down", glyph: "✕", tone: "error", pulse: false },
  checking: { label: "checking", glyph: "…", tone: "muted", pulse: true },
  unknown: { label: "unknown", glyph: "?", tone: "muted", pulse: false },
};

/** Static class names, so Tailwind sees every one of them. */
export const TONE_TEXT: Readonly<Record<Tone, string>> = {
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  violet: "text-accent-violet",
  muted: "text-fg-muted",
};

export const TONE_FILL: Readonly<Record<Tone, string>> = {
  success: "fill-success",
  warning: "fill-warning",
  error: "fill-error",
  violet: "fill-accent-violet",
  muted: "fill-fg-muted",
};
