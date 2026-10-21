import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StageTimeline } from "@/features/dossier/components/StageTimeline";
import { buttons, isDisabled } from "../../../components/tools/gate-fixtures";
import { sliceByAttr, textOf, withoutHidden } from "../../../helpers/html";
import { stepView, viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6, "The timeline": the eight stages, each status written in words (colour and glyph
 * are never the only signal), waiting / skipped / error said for what they are, and "retry from
 * this stage" on the error stage only — held while that call is in flight.
 */

function render(...args: Parameters<typeof StageTimeline>) {
  return renderToStaticMarkup(<StageTimeline {...args[0]} />);
}

const stage = (html: string, name: string) => sliceByAttr(html, "data-stage", name);

describe("StageTimeline", () => {
  it("lists the eight stages in order, each with its status in words", () => {
    const html = render({ steps: viewsAt("debate", "waiting") });
    const order = [...html.matchAll(/data-stage="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["wake", "gather", "read", "seal", "debate", "measure", "envelope", "record"]);
    expect(textOf(withoutHidden(stage(html, "wake")))).toMatch(/\bok\b/);
    expect(textOf(withoutHidden(stage(html, "debate")))).toMatch(/\bwaiting\b/);
    expect(textOf(withoutHidden(stage(html, "record")))).toMatch(/\bpending\b/);
  });

  it("lists the stages in stage order whatever order the rows arrive in (the database's is not)", () => {
    const steps = viewsAt("debate", "waiting");
    const shuffled = [steps[4], steps[5], steps[0], steps[7], steps[1], steps[2], steps[3], steps[6]].filter(
      (s): s is NonNullable<typeof s> => s !== undefined,
    );
    const order = [...render({ steps: shuffled }).matchAll(/data-stage="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["wake", "gather", "read", "seal", "debate", "measure", "envelope", "record"]);
  });

  it("renders a waiting stage with what it waits for and when it is asked again", () => {
    const html = render({
      steps: viewsAt("debate", "waiting", {
        nextAt: "2026-10-20T10:00:03.000Z",
        note: "debate 889d7f2b is running",
      }),
    });
    const text = textOf(stage(html, "debate"));
    expect(text).toContain("debate 889d7f2b is running");
    expect(text).toContain("asked again at 10:00:03 UTC");
    expect(stage(html, "debate")).toContain('data-status="waiting"');
  });

  it("renders a skipped stage with why", () => {
    const steps = viewsAt("seal", "running");
    steps[1] = stepView("gather", "skipped", { note: "no web sources were picked" });
    const html = render({ steps });
    expect(stage(html, "gather")).toContain('data-status="skipped"');
    expect(textOf(withoutHidden(stage(html, "gather")))).toMatch(/skipped.*no web sources were picked/);
  });

  it("renders an error stage with its error and a retry button — and no other stage has one", () => {
    const onRetry = vi.fn();
    const html = render({
      steps: viewsAt("seal", "error", { error: "inkprint.certifyBatch: downstream_error (422)" }),
      retry: { onRetry, busy: false },
    });
    const seal = stage(html, "seal");
    expect(seal).toContain('data-status="error"');
    expect(textOf(seal)).toContain("inkprint answered with an error");
    expect(textOf(seal)).toContain("downstream_error (422)");
    const retry = buttons(seal);
    expect(retry).toHaveLength(1);
    expect(textOf(retry[0] ?? "")).toBe("retry from this stage");
    expect(isDisabled(retry[0] ?? "")).toBe(false);
    expect(buttons(html)).toHaveLength(1);
  });

  it("holds the retry button while the retry is in flight", () => {
    const html = render({
      steps: viewsAt("seal", "error", { error: "x" }),
      retry: { onRetry: () => {}, busy: true },
    });
    const [button] = buttons(stage(html, "seal"));
    expect(isDisabled(button ?? "")).toBe(true);
    expect(button).toContain('aria-busy="true"');
    expect(textOf(button ?? "")).toBe("retrying…");
  });

  it("names a spent budget as a limit, not a failure of the product", () => {
    const html = render({
      steps: viewsAt("debate", "error", { error: "paper-trail.debate: budget_exhausted" }),
      retry: { onRetry: () => {}, busy: false },
    });
    const text = textOf(stage(html, "debate"));
    expect(text).toMatch(/budget/);
    expect(stage(html, "debate")).toContain('data-tone="limit"');
  });

  it("offers no retry button when no retry is wired (a finished receipt)", () => {
    const html = render({ steps: viewsAt("seal", "error", { error: "x" }) });
    expect(buttons(html)).toHaveLength(0);
  });

  it("says plainly when a dossier predates the step machine", () => {
    expect(textOf(render({ steps: [] }))).toMatch(/predates the eight-stage runner/);
  });

  it("hides every glyph from assistive tech", () => {
    const html = render({ steps: viewsAt("debate", "waiting") });
    for (const m of html.matchAll(/data-glyph="[^"]*"[^>]*>/g)) expect(m[0]).toBeDefined();
    expect([...html.matchAll(/<span[^>]*data-glyph[^>]*>/g)].every((m) => m[0].includes('aria-hidden="true"'))).toBe(
      true,
    );
  });
});
