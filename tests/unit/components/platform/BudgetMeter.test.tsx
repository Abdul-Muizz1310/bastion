import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetMeter } from "@/components/platform/BudgetMeter";
import { attr, textOf } from "../../helpers/html";

/**
 * Spec 21 §4: budgets are shown wherever they limit an action. The meter is a role="meter" with its
 * value in text; the cells only illustrate it.
 */

function meterTag(html: string): string {
  const tag = /<div[^>]*role="meter"[^>]*>/.exec(html)?.[0];
  if (!tag) throw new Error("no meter");
  return tag;
}

describe("BudgetMeter", () => {
  it("is a labelled meter with its value in text", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="debates left today" left={3} limit={4} />);
    const tag = meterTag(html);
    expect(attr(tag, "aria-valuemin")).toBe("0");
    expect(attr(tag, "aria-valuemax")).toBe("4");
    expect(attr(tag, "aria-valuenow")).toBe("3");
    expect(attr(tag, "aria-valuetext")).toBe("3 of 4 left today");
    const labelId = attr(tag, "aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(html).toContain(`id="${labelId}"`);
    expect(textOf(html)).toContain("debates left today");
    expect(textOf(html)).toContain("3 of 4");
  });

  it("draws one cell per unit for small budgets, filled for what is left", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="debates" left={3} limit={4} />);
    expect(html.match(/data-cell="full"/g)).toHaveLength(3);
    expect(html.match(/data-cell="empty"/g)).toHaveLength(1);
  });

  it("caps the cells at 20 for large budgets and rounds what is left", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="certificates" left={150} limit={200} />);
    expect(html.match(/data-cell="full"/g)).toHaveLength(15);
    expect(html.match(/data-cell="empty"/g)).toHaveLength(5);
  });

  it("never shows an empty bar while something is left", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="certificates" left={1} limit={200} />);
    expect(html.match(/data-cell="full"/g)).toHaveLength(1);
  });

  it("says when nothing is left and when it comes back", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="debates" left={0} limit={4} />);
    expect(textOf(html)).toContain("none left — resets 00:00 UTC");
    expect(attr(meterTag(html), "aria-valuetext")).toBe("none of 4 left today");
    expect(html).toContain('data-level="empty"');
  });

  it("marks a budget running low (a quarter or less)", () => {
    expect(renderToStaticMarkup(<BudgetMeter label="d" left={1} limit={4} />)).toContain(
      'data-level="low"',
    );
    expect(renderToStaticMarkup(<BudgetMeter label="d" left={2} limit={4} />)).toContain(
      'data-level="ok"',
    );
  });

  it("uses the id it is given for its label", () => {
    const html = renderToStaticMarkup(
      <BudgetMeter id="budget-debate" label="debates" left={1} limit={4} />,
    );
    expect(attr(meterTag(html), "aria-labelledby")).toBe("budget-debate");
  });

  it.each([
    ["more left than the limit", 5, 4],
    ["a negative left", -1, 4],
    ["a fractional left", 1.5, 4],
    ["a negative limit", 0, -1],
    ["a NaN limit", 0, Number.NaN],
  ])("refuses %s", (_name, left, limit) => {
    expect(() => renderToStaticMarkup(<BudgetMeter label="d" left={left} limit={limit} />)).toThrow(
      RangeError,
    );
  });

  it("shows a zero limit as switched off rather than dividing by zero", () => {
    const html = renderToStaticMarkup(<BudgetMeter label="debates" left={0} limit={0} />);
    expect(textOf(html)).toContain("off today");
    expect(html).not.toContain("data-cell");
  });
});
