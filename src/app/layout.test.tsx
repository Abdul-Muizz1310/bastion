import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/font/google
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "mock-geist-sans" }),
  Geist_Mono: () => ({ variable: "mock-geist-mono" }),
}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders children within html body", () => {
    const html = renderToString(createElement(RootLayout, { children: "child-content-here" }));
    expect(html).toContain("child-content-here");
    expect(html).toContain("mock-geist-sans");
    expect(html).toContain("mock-geist-mono");
  });
});
