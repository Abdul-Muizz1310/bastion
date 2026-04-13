import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import RunPage from "./page";

describe("RunPage", () => {
  it("renders demo runner heading and steps", () => {
    const html = renderToString(createElement(RunPage));
    expect(html).toContain("End-to-End");
    expect(html).toContain("Demo");
    expect(html).toContain("magpie");
    expect(html).toContain("inkprint");
    expect(html).toContain("paper-trail");
    expect(html).toContain("slowquery");
    expect(html).toContain("audit");
  });
});
