import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveKey } from "@/platform/secrets";
import {
  clientAddress,
  isVisitorId,
  VISITOR_ID_PATTERN,
  VISITOR_KEY_INFO,
  type VisitorId,
  visitorFromRequest,
  visitorId,
} from "@/platform/visitor";

/**
 * Spec 21 §4 (Visitors) — no cookie and no account: the actor is `v_` + the first 10 base32
 * characters of HMAC-SHA256(key, ip ‖ UTC date). It changes daily, cannot be reversed to an
 * address, and is the token `sub`, the rate-limit key and the audit actor.
 */

const KEY = new Uint8Array(32).fill(7);
const OTHER_KEY = new Uint8Array(32).fill(8);
const DAY = "2026-10-20";
const SECRET = "x".repeat(32);

/** RFC 4648 base32, lowercase, no padding — an independent oracle for the derivation. */
function base32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

function request(headers: Record<string, string>): Request {
  return new Request("https://bastion.test/", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("visitorId — shape and derivation", () => {
  it("matches /^v_[a-z2-7]{10}$/", () => {
    const id = visitorId("203.0.113.7", DAY, KEY);
    expect(id).toMatch(/^v_[a-z2-7]{10}$/);
    expect(VISITOR_ID_PATTERN.source).toBe("^v_[a-z2-7]{10}$");
  });

  it("is v_ + the first 10 base32 chars of HMAC-SHA256(key, ip ‖ day)", () => {
    const mac = createHmac("sha256", KEY).update(`203.0.113.7${DAY}`).digest();
    expect(visitorId("203.0.113.7", DAY, KEY)).toBe(`v_${base32(mac).slice(0, 10)}`);
  });

  it("known answers stay fixed — a silent change would split every visitor mid-day", () => {
    expect(visitorId("203.0.113.7", DAY, KEY)).toBe("v_kk6eooepno");
    expect(visitorId("2001:db8::1", DAY, KEY)).toBe("v_2urw26kojh");
  });

  it("is stable within a day", () => {
    expect(visitorId("198.51.100.4", DAY, KEY)).toBe(visitorId("198.51.100.4", DAY, KEY));
  });

  it("differs across days", () => {
    expect(visitorId("198.51.100.4", "2026-10-20", KEY)).not.toBe(
      visitorId("198.51.100.4", "2026-10-21", KEY),
    );
  });

  it("differs across IPs", () => {
    expect(visitorId("198.51.100.4", DAY, KEY)).not.toBe(visitorId("198.51.100.5", DAY, KEY));
  });

  it("differs across keys", () => {
    expect(visitorId("198.51.100.4", DAY, KEY)).not.toBe(visitorId("198.51.100.4", DAY, OTHER_KEY));
  });

  it("treats an IPv6 address case-insensitively", () => {
    expect(visitorId("2001:DB8::1", DAY, KEY)).toBe(visitorId("2001:db8::1", DAY, KEY));
  });

  it("never contains the IP, nor any of its octets in order", () => {
    const ips = ["203.0.113.7", "10.0.0.1", "255.255.255.255", "2001:db8::1", "::1", "0.0.0.0"];
    for (let n = 0; n < 200; n++) ips.push(`10.${n}.${(n * 7) % 256}.${(n * 13) % 256}`);
    for (const ip of ips) {
      const id = visitorId(ip, DAY, KEY);
      expect(id, ip).not.toContain(ip);
      expect(id, ip).not.toContain(ip.replaceAll(".", "").replaceAll(":", ""));
      expect(id, ip).toMatch(VISITOR_ID_PATTERN);
    }
  });
});

describe("visitorId — what must not happen", () => {
  it.each([
    ["an empty string", ""],
    ["a hostname", "example.com"],
    ["garbage", "not-an-ip"],
    ["an address with a port", "203.0.113.7:443"],
    ["a list", "203.0.113.7, 198.51.100.4"],
  ])("rejects %s as the IP", (_label, ip) => {
    expect(() => visitorId(ip, DAY, KEY)).toThrow(/ip/i);
  });

  it.each([
    ["a timestamp", "2026-10-20T00:00:00Z"],
    ["a compact date", "20261020"],
    ["month 13", "2026-13-01"],
    ["February 30th", "2026-02-30"],
    ["an empty string", ""],
  ])("rejects %s as the day", (_label, day) => {
    expect(() => visitorId("203.0.113.7", day, KEY)).toThrow(/day/i);
  });

  it("rejects a key shorter than 32 bytes", () => {
    expect(() => visitorId("203.0.113.7", DAY, new Uint8Array(31))).toThrow(/key/i);
  });
});

describe("isVisitorId", () => {
  it("accepts a derived id", () => {
    expect(isVisitorId(visitorId("203.0.113.7", DAY, KEY))).toBe(true);
  });

  it.each([
    "bastion",
    "v_",
    "v_abc",
    "v_ABCDEFGHIJ",
    "v_abcdefghi1",
    "v_abcdefghijk",
    "x_abcdefghij",
    " v_abcdefghij",
    "550e8400-e29b-41d4-a716-446655440000",
  ])("rejects %j", (value) => {
    expect(isVisitorId(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isVisitorId(42)).toBe(false);
    expect(isVisitorId(null)).toBe(false);
    expect(isVisitorId(undefined)).toBe(false);
  });
});

describe("visitorFromRequest", () => {
  const NOW = new Date("2026-10-20T12:00:00Z");

  function expected(ip: string, day = "2026-10-20"): VisitorId {
    return visitorId(ip, day, deriveKey(VISITOR_KEY_INFO));
  }

  it("derives its key from IRON_SESSION_PASSWORD with info bastion/visitor/v1", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(VISITOR_KEY_INFO).toBe("bastion/visitor/v1");
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(visitorFromRequest(req, NOW)).toBe(expected("203.0.113.7"));
  });

  it("uses the leftmost x-forwarded-for entry", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": " 203.0.113.7 , 198.51.100.4, 10.0.0.1" });
    expect(visitorFromRequest(req, NOW)).toBe(expected("203.0.113.7"));
  });

  it("falls back to x-real-ip without x-forwarded-for", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-real-ip": "198.51.100.4" });
    expect(visitorFromRequest(req, NOW)).toBe(expected("198.51.100.4"));
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.4" });
    expect(visitorFromRequest(req, NOW)).toBe(expected("203.0.113.7"));
  });

  it("reads the headers alone, so a page's headers() serves as well as a Request", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    expect(visitorFromRequest({ headers }, NOW)).toBe(expected("203.0.113.7"));
  });

  it("falls back to 0.0.0.0 without either header", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    expect(visitorFromRequest(request({}), NOW)).toBe(expected("0.0.0.0"));
  });

  it("skips a leftmost entry that is not an IP rather than hashing it", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": "unknown", "x-real-ip": "198.51.100.4" });
    expect(visitorFromRequest(req, NOW)).toBe(expected("198.51.100.4"));
    const bare = request({ "x-forwarded-for": "unknown, 203.0.113.7" });
    expect(visitorFromRequest(bare, NOW)).toBe(expected("0.0.0.0"));
  });

  it("takes the day in UTC, not local time", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const lateEvening = new Date("2026-10-20T23:30:00-05:00"); // 2026-10-21 04:30 UTC
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(visitorFromRequest(req, lateEvening)).toBe(expected("203.0.113.7", "2026-10-21"));
  });

  it("defaults `now` to the current time", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T05:06:07Z"));
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(visitorFromRequest(req)).toBe(expected("203.0.113.7", "2026-03-04"));
  });

  it("changes at UTC midnight", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    const before = visitorFromRequest(req, new Date("2026-10-20T23:59:59.999Z"));
    const after = visitorFromRequest(req, new Date("2026-10-21T00:00:00.000Z"));
    expect(before).not.toBe(after);
  });

  it("propagates a missing secret instead of hashing with no key", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", undefined);
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(() => visitorFromRequest(req, NOW)).toThrow(/IRON_SESSION_PASSWORD/);
  });

  it("rejects an invalid `now`", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": "203.0.113.7" });
    expect(() => visitorFromRequest(req, new Date(Number.NaN))).toThrow(/date/i);
  });
});

describe("clientAddress — the single address the gateway forwards", () => {
  it("is the leftmost x-forwarded-for entry when it is an IP", () => {
    expect(clientAddress(request({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientAddress(request({ "x-real-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("is undefined, never 0.0.0.0, without a usable address", () => {
    expect(clientAddress(request({}))).toBeUndefined();
    expect(clientAddress(request({ "x-forwarded-for": "unknown", "x-real-ip": "nope" }))).toBe(
      undefined,
    );
  });

  it("agrees with the address the visitor id is derived from", () => {
    vi.stubEnv("IRON_SESSION_PASSWORD", SECRET);
    const req = request({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" });
    const now = new Date("2026-10-20T12:00:00Z");
    const ip = clientAddress(req) ?? "";
    expect(visitorFromRequest(req, now)).toBe(visitorId(ip, DAY, deriveKey(VISITOR_KEY_INFO)));
  });
});
