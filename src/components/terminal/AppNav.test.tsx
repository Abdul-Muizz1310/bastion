import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Mock next/link to render a plain <a>
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import { AppNav } from "./AppNav";

describe("AppNav", () => {
  it("renders navigation links", () => {
    const html = renderToString(createElement(AppNav, {}));
    expect(html).toContain("registry");
    expect(html).toContain("demo");
    expect(html).toContain("audit");
    expect(html).toContain("time-travel");
    expect(html).toContain("whoami");
    expect(html).toContain("bastion");
  });

  it("highlights the active link", () => {
    const html = renderToString(createElement(AppNav, { active: "registry" }));
    expect(html).toContain("text-accent-violet");
  });

  it("renders login link", () => {
    const html = renderToString(createElement(AppNav, {}));
    expect(html).toContain("login");
  });
});
