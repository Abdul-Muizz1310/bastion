import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "mock-geist-sans" }),
  Geist_Mono: () => ({ variable: "mock-geist-mono" }),
}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("renders children within html body", () => {
    const html = renderToString(<RootLayout>child-content-here</RootLayout>);
    expect(html).toContain("child-content-here");
    expect(html).toContain("mock-geist-sans");
    expect(html).toContain("mock-geist-mono");
  });
});
