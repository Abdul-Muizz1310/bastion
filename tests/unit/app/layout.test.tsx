import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "mock-geist-sans" }),
  Geist_Mono: () => ({ variable: "mock-geist-mono" }),
}));

import RootLayout, { metadata, viewport } from "@/app/layout";
import { SITE } from "@/lib/site/config";
import { ROOT_VIEWPORT, rootMetadata } from "@/lib/site/metadata";

describe("RootLayout", () => {
  it("renders children within html body", () => {
    const html = renderToString(<RootLayout>child-content-here</RootLayout>);
    expect(html).toContain("child-content-here");
    expect(html).toContain("mock-geist-sans");
    expect(html).toContain("mock-geist-mono");
  });
});

describe("20-site: the root layout's head (case 3, 4)", () => {
  it("case 3: exports the metadata built from the site config", () => {
    expect(metadata).toEqual(rootMetadata(SITE));
  });

  it("case 4: exports the root viewport", () => {
    expect(viewport).toEqual(ROOT_VIEWPORT);
  });
});
