import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import { PageFrame } from "./PageFrame";

describe("PageFrame", () => {
  it("renders children within nav and status bar", () => {
    const html = renderToString(
      createElement(PageFrame, { active: "registry" }, "page-content-here"),
    );
    expect(html).toContain("page-content-here");
    expect(html).toContain("bastion");
  });

  it("passes statusRight to StatusBar", () => {
    const html = renderToString(createElement(PageFrame, { statusRight: "5 services" }, "content"));
    expect(html).toContain("5 services");
  });
});
