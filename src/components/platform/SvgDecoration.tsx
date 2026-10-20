import type { ReactNode } from "react";

/**
 * Drawn-only SVG content — glyphs, arrows, edge labels — hidden from assistive tech because what it
 * shows is already said in text (a node's state words, the flows list).
 */
export function SvgDecoration({ children }: { children: ReactNode }) {
  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: an SVG <g> is never focusable; Biome reads unknown tags as focusable
  return <g aria-hidden="true">{children}</g>;
}
