import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  it("renders with default text", () => {
    const html = renderToString(createElement(StatusBar, {}));
    expect(html).toContain("bastion");
    expect(html).toContain("UTF-8");
  });

  it("renders with custom left and right text", () => {
    const html = renderToString(createElement(StatusBar, { left: "custom-left", right: "custom-right" }));
    expect(html).toContain("custom-left");
    expect(html).toContain("custom-right");
  });
});
