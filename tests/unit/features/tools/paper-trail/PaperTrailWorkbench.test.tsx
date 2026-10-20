import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { Debate } from "@/capabilities/paper-trail";
import type { TranscriptCheck } from "@/features/tools/paper-trail/check-result";
import { PaperTrailWorkbench } from "@/features/tools/paper-trail/PaperTrailWorkbench";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * paper-trail's workbench (spec 21 §5, §5.1): a budgeted debate whose rounds appear as they finish,
 * and its transcript hash and Ed25519 signature, checked live.
 */

const done = fixture("paper-trail", "debate.json") as Debate;
const running = fixture("paper-trail", "debate-running.json") as Debate;

const check: TranscriptCheck = {
  debateId: done.id,
  claim: done.claim,
  verdict: "TRUE",
  confidence: 0.82,
  transcriptHash: "5cf763b7b6ffad58ace87598b704dc435b07261ff7d7f606a87060699ffe2340",
  hash: { state: "pass", form: "render" },
  signature: { state: "pass", alg: "Ed25519", detail: "verified with paper-trail's published Ed25519 key" },
};

function render(initial: object, opts: Partial<Parameters<typeof Seeded>[0]> = {}) {
  return renderToStaticMarkup(
    <Seeded name="paper-trail" services={["paper-trail"]} {...opts}>
      <PaperTrailWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("PaperTrailWorkbench", () => {
  it("renders without crashing when the wake fails, with the debate disabled", () => {
    const html = render({}, { gate: "failed" });
    expect(html).toContain('data-gate="unknown"');
    expect(isDisabled(buttonNamed(html, /start the debate/))).toBe(true);
  });

  it("disables the debate at budget 0", () => {
    const html = render({}, { budgets: budgetsWith({ debate: { limit: 4, left: 0 } }) });
    expect(isDisabled(buttonNamed(html, /start the debate/))).toBe(true);
    expect(textOf(html)).toMatch(/none left — resets 00:00 UTC/);
  });

  it("links the recent debates read to its audit trail", () => {
    const list = fixture("paper-trail", "list.json");
    const html = render({ recent: ok(list, "rid-recent") });
    expect(textOf(html)).toContain(done.claim);
    expect(auditHrefs(html)).toContain("/audit/rid-recent");
  });

  it("shows the rounds that have finished while the debate runs", () => {
    const text = textOf(render({ debate: ok(running, "rid-get"), following: true }));
    expect(text).toMatch(/proponent/);
    expect(text).toContain("350.00");
    expect(text).toMatch(/running/);
    expect(text).not.toMatch(/skeptic · round 1/);
  });

  it("shows the transcript's receipt, its hash and signature checked live", () => {
    const html = render({ debate: ok(done, "rid-get"), check: ok(check, RID) });
    const text = textOf(html);
    expect(text).toMatch(/paper-trail transcript/);
    expect(text).toContain(check.transcriptHash.slice(0, 16));
    expect(text).toMatch(/hash\s*✓?\s*recomputed/);
    expect(text).toMatch(/Ed25519 signature\s*✓?\s*verified/);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the paper-trail transcript receipt");
  });

  it("never shows a signature it could not check as verified", () => {
    const text = textOf(
      render({
        debate: ok(done, "rid-get"),
        check: ok({ ...check, signature: { state: "unavailable", alg: "Ed25519", detail: "key not fetched" } }, RID),
      }),
    );
    expect(text).not.toMatch(/signature\s*✓?\s*verified/);
    expect(text).toMatch(/not checked/);
  });
});
