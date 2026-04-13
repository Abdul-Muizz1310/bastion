import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock the LoginForm client component
vi.mock("./login-form", () => ({
  LoginForm: ({ demoMode }: { demoMode: boolean }) =>
    createElement("div", { "data-testid": "login-form" }, `demoMode=${demoMode}`),
}));

import LoginPage from "./page";

describe("LoginPage", () => {
  it("renders login page with bastion heading", async () => {
    const jsx = await LoginPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(jsx);
    expect(html).toContain("bastion");
    expect(html).toContain("control plane");
  });

  it("renders error message for invalid_token", async () => {
    const jsx = await LoginPage({ searchParams: Promise.resolve({ error: "invalid_token" }) });
    const html = renderToString(jsx);
    expect(html).toContain("Magic link is invalid or has expired");
  });

  it("renders error message for server_error", async () => {
    const jsx = await LoginPage({ searchParams: Promise.resolve({ error: "server_error" }) });
    const html = renderToString(jsx);
    expect(html).toContain("Something went wrong");
  });

  it("renders generic error for unknown error code", async () => {
    const jsx = await LoginPage({ searchParams: Promise.resolve({ error: "unknown_code" }) });
    const html = renderToString(jsx);
    expect(html).toContain("An error occurred");
  });

  it("renders LoginForm component", async () => {
    const jsx = await LoginPage({ searchParams: Promise.resolve({}) });
    const html = renderToString(jsx);
    expect(html).toContain("login-form");
  });
});
