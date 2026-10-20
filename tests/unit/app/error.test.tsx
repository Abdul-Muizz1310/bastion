import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import ErrorPage from "@/app/error";
import { links, textOf } from "../helpers/html";

/**
 * The app's error boundary (Ruling AH): in the house style, honest that the page failed on
 * bastion's side, never leaking the error's message, with a way to retry and a way out.
 */

const boom = Object.assign(new Error("connection string postgres://secret@host"), { digest: "4021337" });
const html = renderToStaticMarkup(<ErrorPage error={boom} reset={() => {}} />);

describe("the error page", () => {
  it("says the page failed on bastion's side, in one heading", () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(textOf(html)).toMatch(/this page broke on bastion’s side/i);
  });

  it("never shows the error's own message", () => {
    expect(textOf(html)).not.toContain("postgres://");
  });

  it("gives the digest to quote, a retry and a way home", () => {
    expect(textOf(html)).toContain("4021337");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>try again<\/button>/);
    expect(links(html).some((l) => l.href === "/")).toBe(true);
  });
});
