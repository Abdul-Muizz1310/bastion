import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TokenInspector } from "@/components/tools/TokenInspector";
import type { TokenPreview } from "@/features/tools/bastion/token-preview";
import { links, textOf } from "../../helpers/html";

/**
 * bastion's token inspector (spec 21 §5, §5.1 invariant 8): the decoded header and claims bastion
 * mints for a capability call, each claim explained — never the token itself.
 */

const preview: TokenPreview = {
  header: { alg: "EdDSA", kid: "bastion-ed25519-2026-04" },
  claims: {
    iss: "bastion",
    aud: "inkprint",
    service: "inkprint",
    sub: "v_abcdefghij",
    role: "editor",
    cap: "inkprint.certify",
    iat: 1_792_490_400,
    exp: 1_792_490_460,
    jti: "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b",
  },
  jwks: "/.well-known/jwks.json",
  capability: {
    id: "inkprint.certify",
    service: "inkprint",
    grant: "editor",
    cost: "quota",
    budget: "certify",
    routed: false,
  },
};

const html = renderToStaticMarkup(<TokenInspector preview={preview} />);
const text = textOf(html);

describe("TokenInspector", () => {
  it("shows the header: the algorithm and the key id", () => {
    expect(text).toContain("EdDSA");
    expect(text).toContain("bastion-ed25519-2026-04");
  });

  it("lists every claim with its value and what it means", () => {
    for (const claim of ["iss", "aud", "service", "sub", "role", "cap", "iat", "exp", "jti"]) {
      expect(html).toMatch(new RegExp(`<dt[^>]*>${claim}</dt>`));
    }
    expect(text).toContain("v_abcdefghij");
    expect(text).toMatch(/your pseudonym today/);
    expect(text).toMatch(/only inkprint may accept it/);
    expect(text).toMatch(/2026-10-20 \d\d:\d\d:\d\d UTC/);
    expect(text).toMatch(/60 s after it was issued/);
  });

  it("labels iat, exp and jti as illustrative: the next call's token gets its own", () => {
    for (const claim of ["iat", "exp", "jti"]) {
      const row = new RegExp(`<dt[^>]*>${claim}</dt>[\\s\\S]*?</dd>`).exec(html)?.[0] ?? "";
      expect(textOf(row)).toMatch(/illustrative/);
    }
    expect(text).toMatch(/illustrative of the next call’s token/);
  });

  it("links the JWKS that verifies it", () => {
    expect(links(html).some((l) => l.href === "/.well-known/jwks.json")).toBe(true);
  });

  it("says it is never the token", () => {
    expect(text).toMatch(/never the token/);
  });
});
