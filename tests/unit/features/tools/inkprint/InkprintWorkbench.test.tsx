import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import type { Certificate, DiffResult, LeakScanStatus, VerifyResult } from "@/capabilities/inkprint";
import { InkprintWorkbench } from "@/features/tools/inkprint/InkprintWorkbench";
import { fixture } from "../../../capabilities/harness";
import { budgetsWith, buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * inkprint's workbench (spec 21 §5, §5.1): certify, verify, diff, leak scan; the receipt is the
 * certificate (signature, C2PA manifest) and the verify checks.
 */

const cert = fixture("inkprint", "certificate-create.json") as Certificate;
const verify = fixture("inkprint", "verify.json") as VerifyResult;
const diff = fixture("inkprint", "diff.json") as DiffResult;
const leak = fixture("inkprint", "leak-scan-status.json") as LeakScanStatus;

function render(initial: object, opts: Partial<Parameters<typeof Seeded>[0]> = {}) {
  return renderToStaticMarkup(
    <Seeded name="inkprint" services={["inkprint"]} {...opts}>
      <InkprintWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("InkprintWorkbench", () => {
  it("renders without crashing when the wake fails, with every action disabled", () => {
    const html = render({}, { gate: "failed" });
    expect(isDisabled(buttonNamed(html, /^.*certify.*$/))).toBe(true);
    expect(isDisabled(buttonNamed(html, /run a leak scan/))).toBe(true);
  });

  it("disables certify and diff at a certify budget of 0, and the leak scan at its own 0", () => {
    const html = render(
      {},
      { budgets: budgetsWith({ certify: { limit: 200, left: 0 }, leakscan: { limit: 10, left: 0 } }) },
    );
    expect(isDisabled(buttonNamed(html, />certify</))).toBe(true);
    expect(isDisabled(buttonNamed(html, /diff against the parent/))).toBe(true);
    expect(isDisabled(buttonNamed(html, /run a leak scan/))).toBe(true);
  });

  it("keeps each action enabled while its budget lasts; fields are checked when it runs", () => {
    const html = render({});
    expect(isDisabled(buttonNamed(html, />certify</))).toBe(false);
    expect(isDisabled(buttonNamed(html, /diff against the parent/))).toBe(false);
    expect(isDisabled(buttonNamed(html, /run a leak scan/))).toBe(false);
  });

  it("shows a certificate: its signature, its C2PA manifest, and its receipt", () => {
    const html = render({ certify: ok(cert, RID) });
    const text = textOf(html);
    expect(text).toContain(cert.signature);
    expect(text).toContain("c2pa.hash.data");
    expect(text).toMatch(/inkprint certificate/);
    expect(html).toContain(`/api/tools/inkprint.qr?id=${cert.id}`);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the inkprint certificate receipt");
  });

  it("shows each verify check in words, with the verdict stamped", () => {
    const html = render({ verify: ok(verify, "rid-verify"), verifyId: cert.id });
    const text = textOf(html);
    expect(text).toMatch(/hash\s*✓?\s*pass/);
    expect(text).toMatch(/signature\s*✓?\s*pass/);
    expect(text).toMatch(/valid/);
    expect(auditHrefs(html)).toContain("/audit/rid-verify");
  });

  it("shows a diff's verdict", () => {
    const text = textOf(render({ diff: ok(diff, "rid-diff") }));
    expect(text).toContain("near-duplicate");
    expect(text).toMatch(/94\s*%/);
  });

  it("shows a leak scan's result per corpus", () => {
    const text = textOf(render({ leak: ok(leak, "rid-leak") }));
    expect(text).toContain("CC-MAIN-2024-50");
    expect(text).toMatch(/1 hit/);
  });
});
