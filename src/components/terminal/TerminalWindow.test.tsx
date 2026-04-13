import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalWindow } from "./TerminalWindow";

describe("TerminalWindow", () => {
  it("renders with title and children", () => {
    const html = renderToString(
      createElement(TerminalWindow, { title: "test-title", children: "hello content" }),
    );
    expect(html).toContain("test-title");
    expect(html).toContain("hello content");
  });

  it("renders green status dot", () => {
    const html = renderToString(
      createElement(TerminalWindow, { status: "green", children: "content" }),
    );
    expect(html).toContain("bg-mac-green");
  });

  it("renders yellow status dot", () => {
    const html = renderToString(
      createElement(TerminalWindow, { status: "yellow", children: "content" }),
    );
    expect(html).toContain("bg-mac-yellow");
  });

  it("renders red status dot", () => {
    const html = renderToString(
      createElement(TerminalWindow, { status: "red", children: "content" }),
    );
    expect(html).toContain("bg-mac-red");
  });

  it("renders fallback dot color when no status", () => {
    const html = renderToString(createElement(TerminalWindow, { children: "content" }));
    expect(html).toContain("content");
  });
});
