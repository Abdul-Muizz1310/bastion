import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import WhoamiPage from "@/app/(app)/whoami/page";

describe("WhoamiPage", () => {
  it("renders whoami heading and session info", () => {
    const html = renderToString(createElement(WhoamiPage));
    expect(html).toContain("Who Am");
    expect(html).toContain("demo-admin@bastion.local");
    expect(html).toContain("admin");
    expect(html).toContain("httpOnly cookie");
    expect(html).toContain("HMAC-sealed SID");
  });
});
