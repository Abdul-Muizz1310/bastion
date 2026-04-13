import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalWindow } from "./TerminalWindow";

describe("TerminalWindow", () => {
  it("renders with title and children", () => {
    const html = renderToString(<TerminalWindow title="test-title">hello content</TerminalWindow>);
    expect(html).toContain("test-title");
    expect(html).toContain("hello content");
  });

  it("renders green status dot", () => {
    const html = renderToString(<TerminalWindow status="green">content</TerminalWindow>);
    expect(html).toContain("bg-mac-green");
  });

  it("renders yellow status dot", () => {
    const html = renderToString(<TerminalWindow status="yellow">content</TerminalWindow>);
    expect(html).toContain("bg-mac-yellow");
  });

  it("renders red status dot", () => {
    const html = renderToString(<TerminalWindow status="red">content</TerminalWindow>);
    expect(html).toContain("bg-mac-red");
  });

  it("renders fallback dot color when no status", () => {
    const html = renderToString(<TerminalWindow>content</TerminalWindow>);
    expect(html).toContain("content");
  });
});
