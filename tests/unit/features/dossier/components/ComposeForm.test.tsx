import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import type { InkthreadDocument } from "@/capabilities/inkthread";
import type { MagpieSource } from "@/capabilities/magpie";
import { ComposeForm, type ComposeSeed } from "@/features/dossier/components/ComposeForm";
import { BudgetProvider } from "@/features/tools/BudgetProvider";
import type { Budgets } from "@/features/tools/budgets";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, buttons, type GateSeed, gateWith, isDisabled } from "../../../components/tools/gate-fixtures";
import { sliceByAttr, textOf } from "../../../helpers/html";
import { ok } from "../../tools/outcomes";

/**
 * Spec 21 §6.6, "Compose": a claim, magpie's sources and inkthread's documents (each behind its
 * own wake gate), a mode, and today's debates. Ruling X: before any upload control, the form says
 * that quoted passages of an uploaded PDF become part of the public dossier.
 */

const sources = fixture("magpie", "sources.json") as MagpieSource[];
const samples = fixture("inkthread", "samples.json") as { items: InkthreadDocument[] };

function render({
  budgets = budgetsWith({ debate: { limit: 4, left: 3 } }),
  gate = "live",
  seed = {},
}: { budgets?: Budgets | null; gate?: GateSeed; seed?: ComposeSeed } = {}) {
  return renderToStaticMarkup(
    <BudgetProvider initial={budgets}>
      <ComposeForm
        initial={{
          sources: ok(sources, "rid-sources"),
          samples: ok(samples, "rid-samples"),
          gates: { magpie: gateWith(["magpie"], gate), inkthread: gateWith(["inkthread"], gate) },
          ...seed,
        }}
      />
    </BudgetProvider>,
  );
}

describe("ComposeForm", () => {
  it("states Ruling X before any upload control: quoted passages of an uploaded PDF become public", () => {
    const html = render();
    const notice = sliceByAttr(html, "data-notice", "public-dossier");
    expect(textOf(notice)).toMatch(/public/);
    expect(textOf(notice)).toMatch(/passages it quotes from a PDF.*upload/i);
    expect(textOf(notice)).toMatch(/never keeps the PDF/);
    expect(html.indexOf('data-notice="public-dossier"')).toBeLessThan(html.indexOf("upload a PDF"));
  });

  it("lists magpie's sources and inkthread's samples to pick from", () => {
    const text = textOf(render());
    for (const s of sources) expect(text).toContain(s.name);
    expect(text).toContain("uspto-fee-schedule.pdf");
  });

  it("holds the pickers while their gates are not live", () => {
    const html = render({ gate: "waking" });
    const boxes = [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((m) => m[0]);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toMatch(/\sdisabled=""/);
    expect(isDisabled(buttonNamed(html, /upload a PDF/))).toBe(true);
  });

  it("does not hold the submit for an empty claim — fields are checked on submit (invariant 1)", () => {
    expect(isDisabled(buttonNamed(render(), /run the dossier/))).toBe(false);
  });

  it("shows the debates left today beside the submit", () => {
    const html = render();
    expect(html).toContain('role="meter"');
    expect(textOf(html)).toMatch(/debates left today\s+3 of 4/);
  });

  it("disables the submit at 0 debates left and says why", () => {
    const html = render({ budgets: budgetsWith({ debate: { limit: 4, left: 0 } }) });
    const submit = buttonNamed(html, /run the dossier/);
    expect(isDisabled(submit)).toBe(true);
    expect(textOf(html)).toMatch(/No debates left today.*00:00 UTC/);
    const describedBy = /aria-describedby="([^"]+)"/.exec(submit)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
  });

  it("keeps the submit enabled when the budget cannot be read, and says the server still enforces it", () => {
    const html = render({ budgets: null });
    expect(isDisabled(buttonNamed(html, /run the dossier/))).toBe(false);
    expect(textOf(html)).toMatch(/could not be read.*still/);
  });

  it("offers the three modes with their rounds, standard by default", () => {
    const html = render();
    const radios = [...html.matchAll(/<input[^>]*type="radio"[^>]*>/g)].map((m) => m[0]);
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => /\schecked=""/.test(r))).toHaveLength(1);
    expect(radios.find((r) => /\schecked=""/.test(r))).toContain('value="standard"');
    expect(textOf(html)).toMatch(/rapid.*1 round/);
    expect(textOf(html)).toMatch(/adversarial.*3 rounds/);
  });

  it("labels every field", () => {
    const html = render();
    const ids = [...html.matchAll(/<(?:textarea|input)\b[^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"`));
  });

  it("counts the claim's characters against 1024", () => {
    expect(textOf(render({ seed: { draft: { claim: "abc", sources: [], documents: [], mode: "rapid" } } }))).toContain(
      "3 / 1024",
    );
  });

  it("lists an uploaded document with a way to remove it", () => {
    const html = render({
      seed: {
        draft: {
          claim: "x",
          sources: [],
          documents: [
            { documentId: "6e5d4c3b-2a19-4807-b6a5-948372615049", kind: "upload", jobId: null, label: "mine.pdf" },
          ],
          mode: "standard",
        },
      },
    });
    expect(textOf(html)).toContain("mine.pdf");
    expect(buttons(html).some((b) => /remove mine\.pdf/.test(b))).toBe(true);
  });

  it("says when the source list could not be loaded, without failing the form", () => {
    const html = render({
      seed: { sources: { ok: false, kind: "asleep", requestId: null } },
    });
    expect(textOf(html)).toMatch(/magpie is asleep/);
    expect(isDisabled(buttonNamed(html, /run the dossier/))).toBe(false);
  });
});
