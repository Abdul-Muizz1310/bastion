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
vi.mock("@/lib/auth", () => ({
  sendMagicLink: (...args: unknown[]) => mockSendMagicLink(...args),
  demoSignIn: (...args: unknown[]) => mockDemoSignIn(...args),
}));

// Mock session
vi.mock("@/lib/session", () => ({
  COOKIE_NAME: "bastion_session",
}));

describe("sendMagicLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEMO_MODE;
  });

  it("returns error when email is missing", async () => {
    const { sendMagicLinkAction } = await import("./actions");
    const formData = new FormData();
    const result = await sendMagicLinkAction(formData);
    expect(result).toEqual({ error: "Email is required" });
  });

  it("calls sendMagicLink and returns sent:true on success", async () => {
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("./actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result.sent).toBe(true);
    expect(mockSendMagicLink).toHaveBeenCalledWith("test@example.com");
  });

  it("returns magicLinkUrl in demo mode", async () => {
    process.env.DEMO_MODE = "true";
    mockSendMagicLink.mockResolvedValueOnce({
      url: "http://localhost:3000/auth/callback?token=abc",
    });
    const { sendMagicLinkAction } = await import("./actions");
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
    const { sendMagicLinkAction } = await import("./actions");
    const formData = new FormData();
    formData.set("email", "test@example.com");
    const result = await sendMagicLinkAction(formData);
    expect(result.sent).toBe(true);
    expect(result.magicLinkUrl).toBeUndefined();
  });

  it("returns error message on Error thrown", async () => {
    mockSendMagicLink.mockRejectedValueOnce(new Error("Invalid email address"));
    const { sendMagicLinkAction } = await import("./actions");
    const formData = new FormData();
    formData.set("email", "bad");
    const result = await sendMagicLinkAction(formData);
    expect(result).toEqual({ error: "Invalid email address" });
  });

  it("returns generic error on non-Error thrown", async () => {
    mockSendMagicLink.mockRejectedValueOnce("string-error");
    const { sendMagicLinkAction } = await import("./actions");
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

    const { demoSignInAction } = await import("./actions");
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
});
