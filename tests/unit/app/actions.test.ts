import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/headers
const mockCookieSet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ set: mockCookieSet }),
}));

// Mock next/navigation
const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

// Mock auth module
const mockSendMagicLink = vi.fn();
const mockDemoSignIn = vi.fn();
vi.mock("@/lib/auth/magic-link", () => ({
  sendMagicLink: (...args: unknown[]) => mockSendMagicLink(...args),
  demoSignIn: (...args: unknown[]) => mockDemoSignIn(...args),
}));

// Mock session
vi.mock("@/lib/auth/session", () => ({
  COOKIE_NAME: "bastion_session",
}));

describe("sendMagicLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEMO_MODE;
  });

  it("returns error when email is missing", async () => {
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    const result = await sendMagicLinkAction(formData);
    expect(result).toEqual({ error: "Email is required" });
  });

  it("calls sendMagicLink and returns sent:true on success", async () => {
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result.sent).toBe(true);
    expect(mockSendMagicLink).toHaveBeenCalledWith("test@example.com", undefined);
  });

  it("case 38: passes returnTo from FormData to sendMagicLink", async () => {
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc&returnTo=%2Fdossiers%2Fabc",
    });
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    formData.set("returnTo", "/dossiers/abc");
    await sendMagicLinkAction(formData);
    expect(mockSendMagicLink).toHaveBeenCalledWith("test@example.com", "/dossiers/abc");
  });

  it("case 38b: missing returnTo in FormData passes undefined", async () => {
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    await sendMagicLinkAction(formData);
    expect(mockSendMagicLink).toHaveBeenCalledWith("test@example.com", undefined);
  });

  it("returns magicLinkUrl in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result.sent).toBe(true);
    expect(result.magicLinkUrl).toBe("http://localhost:3000/auth/callback?token=abc");
  });

  it("does not return magicLinkUrl when not in demo mode", async () => {
    process.env.DEMO_MODE = "false";
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result.sent).toBe(true);
    expect(result.magicLinkUrl).toBeUndefined();
  });

  it("returns error message on Error thrown", async () => {
    mockSendMagicLink.mockRejectedValueOnce(new Error("Invalid email address"));
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "bad");
    const result = await sendMagicLinkAction(formData);
    expect(result).toEqual({ error: "Invalid email address" });
  });

  it("returns generic error on non-Error thrown", async () => {
    mockSendMagicLink.mockRejectedValueOnce("string-error");
    const { sendMagicLinkAction } = await import("@/app/actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result).toEqual({ error: "Failed to send magic link" });
  });
});

describe("demoSignInAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls demoSignIn, sets cookie, and redirects", async () => {
    mockDemoSignIn.mockResolvedValueOnce({
      session: { cookie: "sealed-cookie-value" },
    });

    const { demoSignInAction } = await import("@/app/actions");
    await demoSignInAction("admin");

    expect(mockDemoSignIn).toHaveBeenCalledWith("admin");
    expect(mockCookieSet).toHaveBeenCalledWith(
      "bastion_session",
      "sealed-cookie-value",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      }),
    );
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });

  it("case 39: safe returnTo is used as redirect destination", async () => {
    mockDemoSignIn.mockResolvedValueOnce({
      session: { cookie: "sealed-cookie-value" },
    });
    const { demoSignInAction } = await import("@/app/actions");
    await demoSignInAction("editor", "/dossiers/abc");
    expect(mockRedirect).toHaveBeenCalledWith("/dossiers/abc");
  });

  it("case 40: unsafe returnTo falls back to /dashboard", async () => {
    mockDemoSignIn.mockResolvedValueOnce({
      session: { cookie: "sealed-cookie-value" },
    });
    const { demoSignInAction } = await import("@/app/actions");
    await demoSignInAction("editor", "//evil.com");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(mockRedirect).not.toHaveBeenCalledWith("//evil.com");
  });

  it("case 40b: omitted returnTo redirects to /dashboard (backward compat)", async () => {
    mockDemoSignIn.mockResolvedValueOnce({
      session: { cookie: "sealed-cookie-value" },
    });
    const { demoSignInAction } = await import("@/app/actions");
    await demoSignInAction("editor");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
  });
});
