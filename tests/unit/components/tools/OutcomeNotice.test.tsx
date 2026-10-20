import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { OutcomeNotice } from "@/components/tools/OutcomeNotice";
import type { FailedOutcome } from "@/features/tools/outcome";
import { links, sliceByAttr, textOf } from "../../helpers/html";
import { Seeded } from "./gate-fixtures";

/**
 * A failure said for what it is (spec 21 §5.1 invariant 4): the platform's limits are never shown
 * as the product failing; the product's own answer keeps its status and reason.
 */

const RID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const render = (failure: FailedOutcome) =>
  renderToStaticMarkup(<OutcomeNotice failure={failure} product="magpie" />);

describe("OutcomeNotice", () => {
  it.each<[string, FailedOutcome, RegExp]>([
    ["asleep", { ok: false, kind: "asleep", requestId: RID }, /magpie is asleep/],
    [
      "rate_limited",
      { ok: false, kind: "rate_limited", retryAfterS: 17, requestId: RID },
      /rate limited.*try again in 17 s/i,
    ],
    [
      "budget_exhausted",
      { ok: false, kind: "budget_exhausted", retryAfterS: 3600, requestId: RID },
      /today’s budget .* is spent.*00:00 UTC/,
    ],
  ])("names %s as the platform's limit, never a failure", (kind, failure, message) => {
    const html = render(failure);
    const text = textOf(html);
    expect(html).toContain(`data-kind="${kind}"`);
    expect(text).toMatch(message);
    expect(text).not.toMatch(/fail|error/i);
  });

  it("names the gate's service it is waking again above (Ruling AI)", () => {
    const text = textOf(
      renderToStaticMarkup(
        <Seeded name="inkprint" services={["inkprint"]}>
          <OutcomeNotice failure={{ ok: false, kind: "asleep", requestId: RID }} product="inkprint" />
        </Seeded>,
      ),
    );
    expect(text).toMatch(/bastion is waking inkprint again above/);
  });

  it("names a routed host it wakes in the background, not the gate's service", () => {
    const html = renderToStaticMarkup(
      <Seeded name="slowquery" services={["slowquery"]}>
        <OutcomeNotice
          failure={{ ok: false, kind: "asleep", requestId: RID }}
          product="magpie"
          wakes="magpie"
        />
      </Seeded>,
    );
    // The notice itself, not the gate bar above it (which rightly names slowquery).
    const text = textOf(sliceByAttr(html, "data-kind", "asleep"));
    expect(text).toMatch(/bastion is waking magpie now/);
    expect(text).not.toMatch(/slowquery/);
  });

  it("says nothing is being woken when nothing is", () => {
    const text = textOf(render({ ok: false, kind: "asleep", requestId: RID }));
    expect(text).toMatch(/nothing on this page wakes it/i);
    expect(text).not.toMatch(/waking/);
  });

  it("shows the product's own answer with its status and reason", () => {
    const text = textOf(
      render({ ok: false, kind: "downstream_error", status: 404, detail: "unknown source", requestId: RID }),
    );
    expect(text).toMatch(/magpie answered 404/);
    expect(text).toContain("unknown source");
  });

  it.each<[FailedOutcome, RegExp]>([
    [{ ok: false, kind: "invalid_response", detail: "x", requestId: RID }, /shape bastion does not accept/],
    [{ ok: false, kind: "invalid_input", detail: "id: Invalid UUID", requestId: RID }, /refused the input.*id: Invalid UUID/],
    [{ ok: false, kind: "refused", error: "unknown_capability", requestId: RID }, /bastion refused the call.*unknown_capability/],
    [{ ok: false, kind: "unreachable", requestId: null }, /bastion could not be reached/],
  ])("says %o in words", (failure, message) => {
    expect(textOf(render(failure))).toMatch(message);
  });

  it("links the request id to the audit trail when there is one, and not otherwise", () => {
    expect(links(render({ ok: false, kind: "asleep", requestId: RID }))[0]?.href).toBe(`/audit/${RID}`);
    expect(links(render({ ok: false, kind: "unreachable", requestId: null }))).toHaveLength(0);
  });
});
