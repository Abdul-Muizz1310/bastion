import { describe, expect, it } from "vitest";
import { consumeMagicLink, demoSignIn, sendMagicLink } from "./auth";

describe("02-auth: magic link happy path", () => {
  // Case 1: POST /login sends magic link and inserts DB row
  it("sendMagicLink sends email and inserts magic_links row", async () => {
    const result = await sendMagicLink("test@example.com");
    expect(result.token).toBeDefined();
    expect(result.emailSent).toBe(true);
  });

  // Case 2: magic link URL format
  it("magic link URL is {SITE_URL}/auth/callback?token={token}", async () => {
    const result = await sendMagicLink("test@example.com");
    expect(result.url).toMatch(/\/auth\/callback\?token=.+/);
  });

  // Case 3: consuming valid token creates session
  it("consumeMagicLink with valid token creates session and returns redirect", async () => {
    const { token } = await sendMagicLink("test@example.com");
    const result = await consumeMagicLink(token);
    expect(result.session).toBeDefined();
    expect(result.redirectTo).toBe("/dashboard");
  });

  // Case 4: token is marked as used
  it("consumed token has usedAt set", async () => {
    const { token } = await sendMagicLink("test@example.com");
    const result = await consumeMagicLink(token);
    expect(result.tokenUsedAt).toBeDefined();
  });

  // Case 5: new user gets viewer role
  it("new user from magic link gets viewer role by default", async () => {
    const { token } = await sendMagicLink("newuser@example.com");
    const result = await consumeMagicLink(token);
    expect(result.user.role).toBe("viewer");
  });
});

describe("02-auth: demo mode happy path", () => {
  // Case 6: demo mode renders 3 buttons (UI test, placeholder)
  it("demo mode is enabled when DEMO_MODE=true", () => {
    process.env.DEMO_MODE = "true";
    // UI rendering test — would be tested in component tests
    expect(process.env.DEMO_MODE).toBe("true");
    expect(true).toBe(false); // placeholder — needs component test
  });

  // Case 7: demo button creates session immediately
  it("demoSignIn creates session without email", async () => {
    const result = await demoSignIn("admin");
    expect(result.session).toBeDefined();
    expect(result.user.email).toBe("demo-admin@bastion.local");
  });

  // Case 8: demo users have correct roles
  it("demo users have the requested role", async () => {
    const admin = await demoSignIn("admin");
    const editor = await demoSignIn("editor");
    const viewer = await demoSignIn("viewer");
    expect(admin.user.role).toBe("admin");
    expect(editor.user.role).toBe("editor");
    expect(viewer.user.role).toBe("viewer");
  });
});

describe("02-auth: edge and failure cases", () => {
  // Case 9: expired token returns 401
  it("consumeMagicLink with expired token returns null", async () => {
    const result = await consumeMagicLink("expired-token");
    expect(result).toBeNull();
  });

  // Case 10: already-used token returns 401
  it("consumeMagicLink with already-used token returns null", async () => {
    const { token } = await sendMagicLink("test@example.com");
    await consumeMagicLink(token); // first use
    const result = await consumeMagicLink(token); // second use
    expect(result).toBeNull();
  });

  // Case 11: nonexistent token returns 401
  it("consumeMagicLink with nonexistent token returns null", async () => {
    const result = await consumeMagicLink("nonexistent-token-abc123");
    expect(result).toBeNull();
  });

  // Case 12: no token parameter returns error
  it("consumeMagicLink with empty string returns null", async () => {
    const result = await consumeMagicLink("");
    expect(result).toBeNull();
  });

  // Case 13: invalid email format rejected
  it("sendMagicLink with invalid email throws validation error", async () => {
    await expect(sendMagicLink("not-an-email")).rejects.toThrow();
  });

  // Case 14: empty email rejected
  it("sendMagicLink with empty email throws validation error", async () => {
    await expect(sendMagicLink("")).rejects.toThrow();
  });

  // Case 15: demo mode disabled rejects demo sign-in
  it("demoSignIn rejects when DEMO_MODE is not true", async () => {
    process.env.DEMO_MODE = "false";
    await expect(demoSignIn("admin")).rejects.toThrow();
  });
});

describe("02-auth: security", () => {
  // Case 16: token is cryptographically random
  it("magic link token is at least 32 bytes URL-safe base64", async () => {
    const result = await sendMagicLink("test@example.com");
    // 32 bytes base64url = 43 chars
    expect(result.token.length).toBeGreaterThanOrEqual(43);
  });

  // Case 17: rate limit respected (tested in spec 05, placeholder here)
  it("auth endpoints respect rate limits", () => {
    expect(true).toBe(false); // placeholder — tested in rate-limit spec
  });

  // Case 18: auth events logged
  it("auth actions are logged as audit events", async () => {
    // Verify appendEvent was called with auth.* action
    expect(true).toBe(false); // placeholder — needs audit spy
  });
});
