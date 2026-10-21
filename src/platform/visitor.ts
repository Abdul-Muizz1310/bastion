import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { deriveKey } from "./secrets";

/**
 * Visitors (spec 21 §4). No cookie and no account: a visitor is
 * `v_` + the first 10 base32 characters of HMAC-SHA256(key, ip ‖ UTC date).
 *
 * The id changes at UTC midnight, cannot be reversed to an address, and is the token `sub`,
 * the rate-limit key and the audit actor. The day is always exactly 10 characters, so the
 * plain concatenation `ip ‖ day` is unambiguous.
 */

export type VisitorId = string & { __brand: "VisitorId" };

export const VISITOR_ID_PATTERN = /^v_[a-z2-7]{10}$/;

/** HKDF `info` for the visitor key — bump the version to rotate every visitor id at once. */
export const VISITOR_KEY_INFO = "bastion/visitor/v1";

/** Used when a request carries no usable client address (local dev, a misconfigured edge). */
const FALLBACK_IP = "0.0.0.0";
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MIN_KEY_BYTES = 32;
const ID_CHARS = 10;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export function isVisitorId(value: unknown): value is VisitorId {
  return typeof value === "string" && VISITOR_ID_PATTERN.test(value);
}

/** RFC 4648 base32, lowercase, unpadded. */
function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** A real calendar day in `YYYY-MM-DD` form — not a timestamp, not 2026-02-30. */
function assertUtcDay(day: string): void {
  const parsed = DAY_PATTERN.test(day) ? new Date(`${day}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new RangeError("visitorId: day must be a UTC calendar date in YYYY-MM-DD form");
  }
}

export function visitorId(ip: string, day: string, key: Uint8Array): VisitorId {
  if (isIP(ip) === 0) {
    throw new TypeError("visitorId: ip must be a single IPv4 or IPv6 address");
  }
  assertUtcDay(day);
  if (key.byteLength < MIN_KEY_BYTES) {
    throw new RangeError(`visitorId: key must be at least ${MIN_KEY_BYTES} bytes`);
  }
  const mac = createHmac("sha256", key).update(`${ip.toLowerCase()}${day}`).digest();
  // The one place a VisitorId is minted: v_ + 10 chars of the base32 alphabet, by construction.
  return `v_${base32(mac).slice(0, ID_CHARS)}` as VisitorId;
}

/**
 * The client's single address: the leftmost `x-forwarded-for` entry, else `x-real-ip` — or
 * `undefined` when neither is an IP. It is what the gateway forwards in `X-Forwarded-For`, and the
 * address a visitor id is derived from (with 0.0.0.0 standing in for `undefined`).
 */
export function clientAddress(req: Pick<Request, "headers">): string | undefined {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && isIP(forwarded) !== 0) return forwarded;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real && isIP(real) !== 0) return real;
  return undefined;
}

function utcDay(now: Date): string {
  if (Number.isNaN(now.getTime())) {
    throw new RangeError("visitorFromRequest: now must be a valid date");
  }
  return now.toISOString().slice(0, 10);
}

/** A Request, or anything carrying its headers (a page's `headers()`, Ruling AL). */
export function visitorFromRequest(
  req: Pick<Request, "headers">,
  now: Date = new Date(),
): VisitorId {
  return visitorId(clientAddress(req) ?? FALLBACK_IP, utcDay(now), deriveKey(VISITOR_KEY_INFO));
}
