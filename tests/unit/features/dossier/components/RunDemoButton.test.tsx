import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDemoButton } from "@/features/dossier/components/RunDemoButton";

describe("RunDemoButton: initial render", () => {
  it("renders the run button and the 5 pending steps when the user can run", () => {
    const html = renderToString(createElement(RunDemoButton, { canRun: true, roleLabel: "admin" }));
    expect(html).toContain("Run end-to-end platform demo");
    for (const step of ["magpie", "inkprint", "paper-trail", "slowquery", "audit"]) {
      expect(html).toContain(step);
    }
    // 5 steps start pending
    const pending = html.match(/>\s*pending\s*</g) ?? [];
    expect(pending.length).toBe(5);
    // no read-only notice when allowed
    expect(html).not.toContain("read-only");
  });

  it("shows a read-only notice and the role when the user cannot run", () => {
    const html = renderToString(
      createElement(RunDemoButton, { canRun: false, roleLabel: "viewer" }),
    );
    expect(html).toContain("read-only");
    expect(html).toContain("viewer");
  });

  it("disables the button when the user cannot run", () => {
    const html = renderToString(
      createElement(RunDemoButton, { canRun: false, roleLabel: "viewer" }),
    );
    expect(html).toContain("disabled");
  });
});
