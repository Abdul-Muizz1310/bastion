import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link to render a plain <a>
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import { AppNav } from "@/components/terminal/AppNav";

describe("AppNav", () => {
  it("renders navigation links", () => {
    const html = renderToString(createElement(AppNav, {}));
    expect(html).toContain("home");
    expect(html).toContain("registry");
    expect(html).toContain("audit");
    expect(html).toContain("time-travel");
    expect(html).toContain("whoami");
    expect(html).toContain("bastion");
  });

  it("highlights the active link", () => {
    const html = renderToString(createElement(AppNav, { active: "registry" }));
    expect(html).toContain("text-accent-violet");
  });

  it("renders login link when no role is provided", () => {
    const html = renderToString(createElement(AppNav, {}));
    expect(html).toContain("login");
  });

  it("renders role pill instead of login when role is provided", () => {
    const html = renderToString(createElement(AppNav, { role: "admin" }));
    expect(html).toContain(">admin<");
    // login link should NOT be rendered
    expect(html).not.toContain(">login<");
  });

  it("renders different role colors per role", () => {
    const admin = renderToString(createElement(AppNav, { role: "admin" }));
    const editor = renderToString(createElement(AppNav, { role: "editor" }));
    const viewer = renderToString(createElement(AppNav, { role: "viewer" }));
    expect(admin).toContain("accent-violet");
    expect(editor).toContain("success");
    expect(viewer).toContain("fg-faint");
  });

  it("includes userEmail beside the role pill when provided", () => {
    const html = renderToString(
      createElement(AppNav, { role: "admin", userEmail: "you@example.com" }),
    );
    expect(html).toContain("you@example.com");
  });
});
