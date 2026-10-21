import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { BastionWorkbench } from "@/features/tools/bastion/BastionWorkbench";
import type { TokenPreview } from "@/features/tools/bastion/token-preview";
import { buttonNamed, isDisabled, Seeded } from "../../../components/tools/gate-fixtures";
import { links, sliceByAttr, textOf } from "../../../helpers/html";
import { auditHrefs, copyButtons, ok, RID } from "../outcomes";

/**
 * bastion's own workbench (spec 21 §5, §5.1): the token inspector — the decoded claims of a token
 * minted for a capability call, never the token — the JWKS, and a call whose receipt is its audit
 * event.
 */

const preview: TokenPreview = {
  header: { alg: "EdDSA", kid: "bastion-ed25519-2026-04" },
  claims: {
    iss: "bastion",
    aud: "magpie",
    service: "magpie",
    sub: "v_abcdefghij",
    role: "viewer",
    cap: "magpie.sources",
    iat: 1_792_490_400,
    exp: 1_792_490_460,
    jti: "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b",
  },
  jwks: "/.well-known/jwks.json",
  capability: { id: "magpie.sources", service: "magpie", grant: "viewer", cost: "free", budget: null, routed: false },
};

function render(initial: object) {
  return renderToStaticMarkup(
    <Seeded name="bastion" services={[]} gate="checking">
      <BastionWorkbench initial={initial} />
    </Seeded>,
  );
}

describe("BastionWorkbench", () => {
  it("is live at once — bastion serves the page — so the call is enabled", () => {
    const html = render({});
    expect(html).toContain('data-gate="live"');
    expect(isDisabled(buttonNamed(html, /make the call/))).toBe(false);
  });

  it("holds the inspector and the JWKS re-read outside a live gate, like every action (round 4)", () => {
    const held = renderToStaticMarkup(<BastionWorkbench initial={{}} />);
    const inspector = /<select\b[^>]*>/.exec(held)?.[0] ?? "";
    expect(inspector).toMatch(/\sdisabled=""/);
    expect(isDisabled(buttonNamed(held, /read it again/))).toBe(true);
    const live = render({});
    expect(/<select\b[^>]*>/.exec(live)?.[0]).not.toMatch(/\sdisabled=""/);
    expect(isDisabled(buttonNamed(live, /read it again/))).toBe(false);
  });

  it("offers every capability to inspect, by product", () => {
    const html = render({});
    expect(html).toMatch(/<optgroup label="inkprint"/);
    expect(html).toContain('value="paper-trail.debate"');
  });

  it("shows the decoded claims and links the JWKS, never a token", () => {
    const html = render({ capability: "magpie.sources", preview: ok(preview, "") });
    const text = textOf(html);
    expect(text).toContain("v_abcdefghij");
    expect(text).toMatch(/never the token/);
    expect(links(html).some((l) => l.href === "/.well-known/jwks.json")).toBe(true);
  });

  it("shows a call's receipt: its audit event", () => {
    const html = render({ call: ok({ capability: "magpie.sources", data: [] }, RID) });
    expect(textOf(html)).toMatch(/bastion gateway call/);
    expect(auditHrefs(html)).toContain(`/audit/${RID}`);
    expect(copyButtons(html)).toContain("copy the bastion gateway call receipt");
  });

  it("wakes the called product's service when bastion's own page finds it asleep (Ruling AI)", () => {
    const html = render({ call: { ok: false, kind: "asleep", requestId: RID }, choice: "magpie.sources" });
    const notice = textOf(sliceByAttr(html, "data-kind", "asleep"));
    expect(notice).toMatch(/bastion is waking magpie now/);
  });

  it("names the capability that was called, not whatever the picker shows now", () => {
    const html = render({
      call: ok({ capability: "paper-trail.receiptKey", data: {} }, RID),
      choice: "magpie.sources",
    });
    const receipt = /<article[\s\S]*?<\/article>/.exec(html)?.[0] ?? "";
    expect(textOf(receipt)).toContain("paper-trail.receiptKey");
    expect(textOf(receipt)).not.toContain("magpie.sources");
  });
});
