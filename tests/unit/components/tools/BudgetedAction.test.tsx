import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { textOf } from "../../helpers/html";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "./gate-fixtures";

/**
 * A budget-limited action (spec 21 §5.1, invariant 1): it shows what is left today and is disabled
 * when fewer units are left than it spends.
 */

function render(props: { units?: number; busy?: boolean }, budgets = budgetsWith(), gate: "live" | "waking" = "live") {
  return renderToStaticMarkup(
    <Seeded budgets={budgets} gate={gate}>
      <BudgetedAction budget="scrape" label="scrape once" busyLabel="scraping…" onRun={() => {}} {...props} />
    </Seeded>,
  );
}

describe("BudgetedAction", () => {
  it("shows today's budget beside an enabled action", () => {
    const html = render({}, budgetsWith({ scrape: { limit: 30, left: 29 } }));
    expect(html).toContain('role="meter"');
    expect(textOf(html)).toContain("29 of 30");
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(false);
  });

  it("is disabled at budget 0, and says when it comes back", () => {
    const html = render({}, budgetsWith({ scrape: { limit: 30, left: 0 } }));
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(true);
    expect(textOf(html)).toMatch(/none left — resets 00:00 UTC/);
  });

  it("is disabled when fewer units are left than it spends", () => {
    const html = render({ units: 2 }, budgetsWith({ scrape: { limit: 30, left: 1 } }));
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(true);
    expect(textOf(html)).toMatch(/needs 2/);
  });

  it("stays enabled, and says so, when today's budgets could not be read", () => {
    const html = renderToStaticMarkup(
      <Seeded budgets={null}>
        <BudgetedAction budget="scrape" label="scrape once" onRun={() => {}} />
      </Seeded>,
    );
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(false);
    expect(textOf(html)).toMatch(/budget could not be read/);
  });

  it("is disabled until the product is live", () => {
    expect(isDisabled(buttonNamed(render({}, budgetsWith(), "waking"), /scrape once/))).toBe(true);
  });

  it("is disabled and says so while it runs", () => {
    const html = render({ busy: true });
    const button = buttonNamed(html, /scraping…/);
    expect(isDisabled(button)).toBe(true);
    expect(button).toContain('aria-busy="true"');
  });
});
