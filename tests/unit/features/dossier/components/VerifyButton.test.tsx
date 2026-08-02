import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckBadge, OverallBadge, VerifyButton } from "@/features/dossier/components/VerifyButton";
import type { VerifyResponse } from "@/features/dossier/verify";

function response(overrides: Partial<VerifyResponse> = {}): VerifyResponse {
  return {
    dossier_id: "dossier-1",
    overall_valid: true,
    results: [{ certificate_id: "cert-1", valid: true, checks: { signature: true, hash: true } }],
    verified_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("19-verification: VerifyButton initial render", () => {
  // `disabled:` Tailwind variants live in the class string either way, so
  // assert on the rendered attribute rather than the substring.
  const DISABLED_ATTR = /<button[^>]*\sdisabled=""/;

  it("offers the verify action to a user who is allowed to run it", () => {
    const html = renderToString(
      createElement(VerifyButton, { dossierId: "dossier-1", canVerify: true }),
    );
    expect(html).toContain("verify all signatures");
    expect(html).not.toMatch(DISABLED_ATTR);
  });

  it("disables the action for a user who is not allowed to verify", () => {
    const html = renderToString(
      createElement(VerifyButton, { dossierId: "dossier-1", canVerify: false }),
    );
    expect(html).toContain("verify all signatures");
    expect(html).toMatch(DISABLED_ATTR);
  });

  it("renders no verdict badge before a verification has run", () => {
    const html = renderToString(
      createElement(VerifyButton, { dossierId: "dossier-1", canVerify: true }),
    );
    expect(html).not.toContain("verified");
    expect(html).not.toContain("tampered");
  });
});

describe("19-verification: verdict badges", () => {
  it("shows a verified badge when every certificate passes", () => {
    const html = renderToString(createElement(OverallBadge, { response: response() }));
    expect(html).toContain("verified");
    expect(html).toContain("text-success");
  });

  it("shows a tampered badge when verification fails", () => {
    const html = renderToString(
      createElement(OverallBadge, { response: response({ overall_valid: false }) }),
    );
    expect(html).toContain("tampered");
    expect(html).toContain("text-error");
  });

  it("shows a no-evidence badge when there was nothing to verify", () => {
    const html = renderToString(
      createElement(OverallBadge, { response: response({ overall_valid: null, results: [] }) }),
    );
    expect(html).toContain("no evidence");
    expect(html).toContain("text-warning");
  });

  it("marks a passing certificate ok", () => {
    const html = renderToString(
      createElement(CheckBadge, {
        result: { certificate_id: "c", valid: true, checks: { signature: true, hash: true } },
      }),
    );
    expect(html).toContain("ok");
  });

  it("shows the server's reason for a failing certificate", () => {
    const html = renderToString(
      createElement(CheckBadge, {
        result: {
          certificate_id: "c",
          valid: false,
          checks: { signature: false, hash: true },
          reason: "signature_mismatch",
        },
      }),
    );
    expect(html).toContain("signature_mismatch");
  });

  it("falls back to 'fail' when the server gives no reason", () => {
    const html = renderToString(
      createElement(CheckBadge, {
        result: { certificate_id: "c", valid: false, checks: { signature: false, hash: false } },
      }),
    );
    expect(html).toContain("fail");
  });
});
