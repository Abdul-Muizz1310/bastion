import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import TimeTravelPage from "./page";

describe("TimeTravelPage", () => {
  it("renders time travel heading and slider", () => {
    const html = renderToString(createElement(TimeTravelPage));
    expect(html).toContain("Time");
    expect(html).toContain("Travel");
    expect(html).toContain("rewind to");
    expect(html).toContain("DISTINCT ON");
  });
});
