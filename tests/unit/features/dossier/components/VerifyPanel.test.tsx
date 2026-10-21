import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { VerifyPanel } from "@/features/dossier/components/VerifyPanel";
import { VerifyProvider } from "@/features/dossier/components/verify-context";
import type { VerifyAnswer } from "@/features/dossier/verify-answer";
import type { ToolOutcome } from "@/features/tools/outcome";
import { buttonNamed, isDisabled } from "../../../components/tools/gate-fixtures";
import { links, sliceByAttr, textOf, withoutHidden } from "../../../helpers/html";
import { CERT_A, DOC_ID, DOSSIER_ID } from "../fixtures";
import { VERIFY_RID, verifiedLegacy, verifiedOk } from "./verify-fixtures";

/**
 * Spec 21 §6.6: "verify everything" renders every check the route returns — `steps` included —
 * each state in words (pass · fail · unavailable · expired), its detail and its items; a legacy
 * dossier shows its note and no checks. The button is held while the call is in flight.
 */

function render(initial: ToolOutcome<VerifyAnswer> | null = null, busy = false) {
  return renderToStaticMarkup(
    <VerifyProvider dossierId={DOSSIER_ID} initial={initial} initialBusy={busy}>
      <VerifyPanel
        dossierId={DOSSIER_ID}
        evidenceKeys={{ [CERT_A]: "d5152b39-p12" }}
        documentIds={[DOC_ID]}
      />
    </VerifyProvider>,
  );
}

const check = (html: string, name: string) => sliceByAttr(html, "data-check", name);

describe("VerifyPanel", () => {
  it("offers verify everything and the receipts download before anything ran", () => {
    const html = render();
    expect(isDisabled(buttonNamed(html, /verify everything/))).toBe(false);
    const download = links(html).find((l) => l.href === `/api/dossiers/${DOSSIER_ID}/receipts`);
    expect(download?.tag).toContain("download=");
    expect(download?.name).toMatch(/download receipts/);
  });

  it("renders all seven checks, steps included", () => {
    const html = render(verifiedOk());
    const names = [...html.matchAll(/data-check="([a-z]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["certificates", "transcript", "envelope", "perf", "audit", "documents", "steps"]);
  });

  it("writes each state distinctly in text — pass, fail, unavailable, expired — not by colour alone", () => {
    const html = render(verifiedOk());
    const word = (name: string) => textOf(withoutHidden(check(html, name))).split(" ")[1];
    expect(word("steps")).toBe("pass");
    expect(word("certificates")).toBe("fail");
    expect(word("transcript")).toBe("unavailable");
    expect(word("documents")).toBe("expired");
    expect(check(html, "documents")).toContain('data-state="expired"');
  });

  it("shows each check's detail and its items, linking a certificate to its evidence row", () => {
    const html = render(verifiedOk());
    const certs = check(html, "certificates");
    expect(textOf(certs)).toContain("1 of 2 certificates does not hold");
    expect(textOf(certs)).toContain("the excerpt differs from the certified text");
    // CERT_A has a row on the page; CERT_B (no row known) is shown but not linked.
    expect(links(certs).map((l) => l.href)).toEqual(["#e-d5152b39-p12"]);
    expect(links(check(html, "documents")).map((l) => l.href)).toEqual([`#doc-${DOC_ID}`]);
    expect(textOf(check(html, "steps"))).toContain("the runner's 8 step rows are all present");
  });

  it("links the verification's own audit trail", () => {
    expect(links(render(verifiedOk())).map((l) => l.href)).toContain(`/audit/${VERIFY_RID}`);
  });

  it("a legacy dossier shows its honest note and no checks", () => {
    const html = render(verifiedLegacy());
    expect(textOf(html)).toContain("this dossier predates verifiable receipts");
    expect(html).not.toContain("data-check=");
  });

  it("holds the button while the verification runs", () => {
    const html = render(null, true);
    const button = buttonNamed(html, /verifying/);
    expect(isDisabled(button)).toBe(true);
    expect(button).toContain('aria-busy="true"');
  });

  it("says a rate limit for what it is, with the wait", () => {
    const html = render({ ok: false, kind: "rate_limited", retryAfterS: 42, requestId: null });
    expect(textOf(html)).toMatch(/rate limited/);
    expect(textOf(html)).toMatch(/42 s/);
  });
});
