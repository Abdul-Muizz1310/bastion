import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock useActionState which is imported from react by login-form
const mockUseActionState = vi.fn();

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useActionState: (...args: unknown[]) => mockUseActionState(...args),
  };
});

// Mock the server actions
vi.mock("@/app/actions", () => ({
  sendMagicLinkAction: vi.fn(),
  demoSignInAction: vi.fn(),
}));

vi.mock("@/lib/validation", () => ({}));

import { LoginForm } from "./login-form";

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: initial state (empty), no pending
    mockUseActionState.mockReturnValue([{}, vi.fn(), false]);
  });

  it("renders email input and submit button", () => {
    const html = renderToString(createElement(LoginForm, { demoMode: false }));
    expect(html).toContain("email");
    expect(html).toContain("send magic link");
  });

  it("renders demo role buttons when demoMode is true", () => {
    const html = renderToString(createElement(LoginForm, { demoMode: true }));
    expect(html).toContain("admin");
    expect(html).toContain("editor");
    expect(html).toContain("viewer");
    expect(html).toContain("or sign in as");
  });

  it("does not render demo buttons when demoMode is false", () => {
    const html = renderToString(createElement(LoginForm, { demoMode: false }));
    expect(html).not.toContain("or sign in as");
  });

  it("renders sent state with magic link URL", () => {
    mockUseActionState.mockReturnValueOnce([
      { sent: true, magicLinkUrl: "http://localhost:3000/auth/callback?token=abc" },
      vi.fn(),
      false,
    ]);
    const html = renderToString(createElement(LoginForm, { demoMode: true }));
    expect(html).toContain("Magic link created");
    expect(html).toContain("open magic link");
    expect(html).toContain("token=abc");
  });

  it("renders sent state without magic link URL (production)", () => {
    mockUseActionState.mockReturnValueOnce([{ sent: true }, vi.fn(), false]);
    const html = renderToString(createElement(LoginForm, { demoMode: false }));
    expect(html).toContain("Magic link created");
    expect(html).toContain("Check your email");
  });

  it("renders error state", () => {
    mockUseActionState.mockReturnValueOnce([{ error: "Email is required" }, vi.fn(), false]);
    const html = renderToString(createElement(LoginForm, { demoMode: false }));
    expect(html).toContain("Email is required");
  });

  it("renders pending state", () => {
    mockUseActionState.mockReturnValueOnce([{}, vi.fn(), true]);
    const html = renderToString(createElement(LoginForm, { demoMode: false }));
    expect(html).toContain("sending...");
  });
});
