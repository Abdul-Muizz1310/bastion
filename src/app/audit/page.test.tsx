import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import AuditPage from "./page";

describe("AuditPage", () => {
  it("renders audit log heading and mock events", () => {
    const html = renderToString(createElement(AuditPage));
    expect(html).toContain("Audit");
    expect(html).toContain("Log");
    expect(html).toContain("auth.login_demo");
    expect(html).toContain("gateway.proxy");
    expect(html).toContain("demo-admin");
  });

  it("renders filter buttons", () => {
    const html = renderToString(createElement(AuditPage));
    expect(html).toContain("all");
    expect(html).toContain("magpie");
    expect(html).toContain("inkprint");
  });
});
