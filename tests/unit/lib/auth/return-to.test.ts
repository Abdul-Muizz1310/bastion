import { describe, expect, it } from "vitest";
import { getSafeReturnTo, isSafeReturnTo } from "@/lib/auth/return-to";

describe("13-return-to: isSafeReturnTo accepts safe local paths", () => {
  it("accepts /", () => {
    expect(isSafeReturnTo("/")).toBe(true);
  });

  it("accepts /dashboard", () => {
    expect(isSafeReturnTo("/dashboard")).toBe(true);
  });

  it("accepts nested path /dossiers/abc-123", () => {
    expect(isSafeReturnTo("/dossiers/abc-123")).toBe(true);
  });

  it("accepts path with encoded query", () => {
    expect(isSafeReturnTo("/audit?filter=service%3Dmagpie")).toBe(true);
  });

  it("accepts multi-segment path", () => {
    expect(isSafeReturnTo("/a/b/c/d/e")).toBe(true);
  });

  it("accepts path with query", () => {
    expect(isSafeReturnTo("/path?q=1&r=2")).toBe(true);
  });

  it("accepts path with fragment", () => {
    expect(isSafeReturnTo("/path#fragment")).toBe(true);
  });

  it("accepts /services/paper-trail", () => {
    expect(isSafeReturnTo("/services/paper-trail")).toBe(true);
  });
});

describe("13-return-to: isSafeReturnTo rejects unsafe values", () => {
  it("rejects null", () => {
    expect(isSafeReturnTo(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isSafeReturnTo(undefined)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSafeReturnTo("")).toBe(false);
  });

  it("rejects protocol-relative //evil.com", () => {
    expect(isSafeReturnTo("//evil.com")).toBe(false);
  });

  it("rejects //evil.com/path", () => {
    expect(isSafeReturnTo("//evil.com/path")).toBe(false);
  });

  it("rejects /\\evil.com (backslash variant)", () => {
    expect(isSafeReturnTo("/\\evil.com")).toBe(false);
  });

  it("rejects absolute https URL", () => {
    expect(isSafeReturnTo("https://evil.com")).toBe(false);
  });

  it("rejects absolute http URL", () => {
    expect(isSafeReturnTo("http://evil.com")).toBe(false);
  });

  it("rejects absolute ftp URL", () => {
    expect(isSafeReturnTo("ftp://evil.com")).toBe(false);
  });

  it("rejects javascript: scheme", () => {
    expect(isSafeReturnTo("javascript:alert(1)")).toBe(false);
  });

  it("rejects path without leading slash", () => {
    expect(isSafeReturnTo("evil-no-slash")).toBe(false);
  });

  it("rejects path with @ (user-info ambiguity)", () => {
    expect(isSafeReturnTo("/foo@evil.com/bar")).toBe(false);
  });

  it("rejects path with CRLF (header injection)", () => {
    expect(isSafeReturnTo("/foo\r\nX-Injected: yes")).toBe(false);
  });

  it("rejects path with LF", () => {
    expect(isSafeReturnTo("/foo\nbar")).toBe(false);
  });

  it("rejects path with null byte", () => {
    expect(isSafeReturnTo("/foo\0null")).toBe(false);
  });

  it("rejects URL-encoded // (no leading slash)", () => {
    expect(isSafeReturnTo("%2F%2Fevil.com")).toBe(false);
  });

  it("rejects /%2F%2Fevil.com (decodes to //evil.com after the leading /)", () => {
    expect(isSafeReturnTo("/%2F%2Fevil.com")).toBe(false);
  });

  it("rejects strings longer than 512 chars", () => {
    const long = `/${"a".repeat(512)}`;
    expect(isSafeReturnTo(long)).toBe(false);
  });

  it("accepts string of exactly 512 chars", () => {
    const exact = `/${"a".repeat(511)}`;
    expect(exact.length).toBe(512);
    expect(isSafeReturnTo(exact)).toBe(true);
  });
});

describe("13-return-to: getSafeReturnTo", () => {
  it("returns safe value unchanged", () => {
    expect(getSafeReturnTo("/dashboard")).toBe("/dashboard");
  });

  it("returns default fallback /dashboard when value is unsafe", () => {
    expect(getSafeReturnTo("//evil.com")).toBe("/dashboard");
  });

  it("returns default fallback when value is null", () => {
    expect(getSafeReturnTo(null)).toBe("/dashboard");
  });

  it("returns default fallback when value is undefined", () => {
    expect(getSafeReturnTo(undefined)).toBe("/dashboard");
  });

  it("uses custom fallback when value is unsafe", () => {
    expect(getSafeReturnTo("//evil.com", "/custom")).toBe("/custom");
  });

  it("uses custom fallback when value is empty", () => {
    expect(getSafeReturnTo("", "/custom")).toBe("/custom");
  });

  it("returns safe value even when a custom fallback is provided", () => {
    expect(getSafeReturnTo("/dossiers/abc", "/never-used")).toBe("/dossiers/abc");
  });
});
