import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/link
vi.mock("next/link", () => ({
  default: ({ href, children, className }: any) =>
    createElement("a", { href, className }, children),
}));

// Mock redirect — throw a sentinel so tests can assert the redirect path
vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT_CALLED");
  }),
}));

// Mock cookies()
const mockCookieGet = vi.fn().mockReturnValue({ value: "sealed-cookie" });
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ get: (name: string) => mockCookieGet(name) }),
}));

// Mock session (admin by default)
const mockGetSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  COOKIE_NAME: "bastion_session",
}));

// Stub the client demo runner — it uses fetch/EventSource. We only verify the
// RSC shell reads the session and passes canRun through correctly.
vi.mock("@/features/dossier/components/RunDemoButton", () => ({
  RunDemoButton: (props: any) =>
    createElement(
      "div",
      {
        "data-testid": "run-demo",
        "data-can-run": String(props.canRun),
        "data-role": props.roleLabel,
      },
      "<RunDemoButton stub>",
    ),
}));

import RunPage from "@/app/(app)/run/page";

describe("RunPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      sid: "s",
      user: { id: "u1", email: "admin@bastion.local", role: "admin", name: null },
    });
  });

  it("renders the demo heading", async () => {
    const element = await RunPage();
    const html = renderToString(element);
    expect(html).toContain("End-to-End");
    expect(html).toContain("Demo");
  });

  it("lets admin run the demo (canRun=true)", async () => {
    const element = await RunPage();
    const html = renderToString(element);
    expect(html).toContain('data-can-run="true"');
  });

  it("lets editor run the demo (canRun=true)", async () => {
    mockGetSession.mockResolvedValue({
      sid: "s",
      user: { id: "u2", email: "editor@bastion.local", role: "editor", name: null },
    });
    const element = await RunPage();
    const html = renderToString(element);
    expect(html).toContain('data-can-run="true"');
  });

  it("makes the demo read-only for a viewer (canRun=false)", async () => {
    mockGetSession.mockResolvedValue({
      sid: "s",
      user: { id: "u3", email: "viewer@bastion.local", role: "viewer", name: null },
    });
    const element = await RunPage();
    const html = renderToString(element);
    expect(html).toContain('data-can-run="false"');
  });

  it("redirects to login when there is no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const { redirect } = await import("next/navigation");
    await expect(RunPage()).rejects.toThrow("REDIRECT_CALLED");
    expect(redirect).toHaveBeenCalledWith("/login?returnTo=%2Frun");
  });
});
