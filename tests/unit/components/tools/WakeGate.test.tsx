import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetedAction } from "@/components/tools/BudgetedAction";
import { WakeGate } from "@/components/tools/WakeGate";
import { textOf } from "../../helpers/html";
import { buttonNamed, isDisabled, Seeded } from "./gate-fixtures";

/**
 * The wake gate around every workbench (spec 21 §5.1, Ruling F; invariants 1 and 2): nothing runs
 * before the product is live, a failed wake never crashes the page or guesses a state, and every end
 * but live offers a retry.
 */

const action = <BudgetedAction budget="scrape" label="scrape once" onRun={() => {}} />;

const render = (gate: Parameters<typeof Seeded>[0]["gate"], services = ["magpie" as const]) =>
  renderToStaticMarkup(
    <Seeded gate={gate} services={[...services]}>
      {action}
    </Seeded>,
  );

describe("WakeGate", () => {
  it("renders checking before any wake has started, with the action disabled and no retry", () => {
    const html = renderToStaticMarkup(
      <WakeGate name="magpie" services={["magpie"]}>
        <p>body</p>
      </WakeGate>,
    );
    expect(html).toContain('data-gate="checking"');
    expect(textOf(html)).toContain("body");
    expect(html).not.toMatch(/wake again/);
  });

  it("counts the seconds of a wake in flight and keeps the action disabled", () => {
    const html = render("waking");
    expect(html).toContain('data-gate="waking"');
    expect(textOf(html)).toMatch(/waking · 1[12] s/);
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(true);
  });

  it("enables the action once the wake route answers live", () => {
    const html = render("live");
    expect(html).toContain('data-gate="live"');
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(false);
  });

  it("renders without crashing when the wake request fails: unknown, never a guess, with a retry", () => {
    const html = render("failed");
    const text = textOf(html);
    expect(html).toContain('data-gate="unknown"');
    expect(text).toContain("the wake request failed");
    expect(text).not.toMatch(/\basleep\b/);
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(true);
    expect(isDisabled(buttonNamed(html, /wake again/))).toBe(false);
  });

  it.each(["asleep", "down", "rate_limited"] as const)(
    "offers a retry after a wake that ends %s, with actions disabled",
    (gate) => {
      const html = render(gate);
      expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(true);
      expect(buttonNamed(html, /wake again/)).toBeDefined();
    },
  );

  it("is live at once for bastion, which has no service of its own", () => {
    const html = renderToStaticMarkup(
      <Seeded name="bastion" services={[]} gate="checking">
        {action}
      </Seeded>,
    );
    expect(html).toContain('data-gate="live"');
    expect(isDisabled(buttonNamed(html, /scrape once/))).toBe(false);
  });

  it("announces the phase in a polite live region", () => {
    const html = render("live");
    expect(html).toMatch(/aria-live="polite"[^>]*>[^<]*magpie is live/);
  });
});
