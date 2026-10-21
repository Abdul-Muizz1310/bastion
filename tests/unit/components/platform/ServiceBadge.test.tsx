import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { STATE_META } from "@/components/platform/states";
import type { DisplayState } from "@/features/health/model";
import { textOf } from "../../helpers/html";

/** Spec 21 §3.1 case 2: a health state is always written in words; the glyph and colour only help. */

const STATES: DisplayState[] = ["live", "waking", "asleep", "down", "checking", "unknown"];

describe("STATE_META", () => {
  it("gives every display state a distinct word and a distinct glyph", () => {
    expect(Object.keys(STATE_META).sort()).toEqual([...STATES].sort());
    const labels = STATES.map((s) => STATE_META[s].label);
    const glyphs = STATES.map((s) => STATE_META[s].glyph);
    expect(new Set(labels).size).toBe(STATES.length);
    expect(new Set(glyphs).size).toBe(STATES.length);
  });
});

describe("ServiceBadge", () => {
  it.each(STATES)("writes the %s state in text, with the glyph hidden from assistive tech", (s) => {
    const html = renderToStaticMarkup(<ServiceBadge state={s} />);
    expect(html).toContain(`data-state="${s}"`);
    expect(textOf(html)).toContain(STATE_META[s].label);
    const glyph = STATE_META[s].glyph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(html).toMatch(new RegExp(`<span aria-hidden="true"[^>]*>${glyph}</span>`));
  });

  it("adds a detail after the state, e.g. the latency or the seconds spent waking", () => {
    const html = renderToStaticMarkup(<ServiceBadge state="waking" detail="41 s" />);
    expect(textOf(html)).toBe(`${STATE_META.waking.glyph} waking · 41 s`);
  });

  it("names the service when given one, so a list of badges reads on its own", () => {
    const html = renderToStaticMarkup(<ServiceBadge state="down" service="paper-trail" />);
    expect(textOf(html)).toContain("paper-trail");
    expect(textOf(html)).toContain("down");
  });

  it("pulses only the in-progress states, and only when motion is welcome", () => {
    for (const s of STATES) {
      const html = renderToStaticMarkup(<ServiceBadge state={s} />);
      const pulses = html.includes("motion-safe:animate-pulse");
      expect(pulses, s).toBe(s === "waking" || s === "checking");
      expect(html).not.toMatch(/(?<!motion-safe:)animate-pulse/);
    }
  });
});
