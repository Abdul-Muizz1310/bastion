import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { PageFrame } from "./PageFrame";

describe("PageFrame", () => {
  it("renders children within nav and status bar", () => {
    const html = renderToString(<PageFrame active="registry">page-content-here</PageFrame>);
    expect(html).toContain("page-content-here");
    expect(html).toContain("bastion");
  });

  it("passes statusRight to StatusBar", () => {
    const html = renderToString(<PageFrame statusRight="5 services">content</PageFrame>);
    expect(html).toContain("5 services");
  });
});
