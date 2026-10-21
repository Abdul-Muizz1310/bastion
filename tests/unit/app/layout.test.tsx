import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  JetBrains_Mono: () => ({ variable: "mock-jetbrains-mono" }),
  Martian_Mono: () => ({ variable: "mock-martian-mono" }),
}));

import RootLayout, { metadata, viewport } from "@/app/layout";
import { SITE } from "@/lib/site/config";
import { ROOT_VIEWPORT, rootMetadata } from "@/lib/site/metadata";

describe("RootLayout", () => {
  it("renders children within html body, in English, with both font variables", () => {
    const html = renderToStaticMarkup(<RootLayout>child-content-here</RootLayout>);
    expect(html).toContain("child-content-here");
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toContain("mock-jetbrains-mono");
    expect(html).toContain("mock-martian-mono");
  });

  it("paints the dark background on the body itself", () => {
    const html = renderToStaticMarkup(<RootLayout>x</RootLayout>);
    expect(html).toMatch(/<body[^>]*class="[^"]*\bbg-background\b/);
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
