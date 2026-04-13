import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

import WhoamiPage from "./page";

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
