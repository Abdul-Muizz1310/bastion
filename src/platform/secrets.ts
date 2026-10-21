import { hkdfSync } from "node:crypto";

/**
 * Key derivation (spec 21 §4, plan "Secrets"). bastion adds no new secrets: every purpose-specific
 * key is HKDF-SHA256 over the one already on Vercel, `IRON_SESSION_PASSWORD`, with an empty salt
 * and a distinct `info` label per purpose (e.g. `bastion/visitor/v1`).
 */

const SECRET_VARIABLE = "IRON_SESSION_PASSWORD";
const MIN_SECRET_LENGTH = 32;
const KEY_BYTES = 32;

/** A required environment variable is missing or unusable. Names the variable, never its value. */
export class ConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, problem: string) {
    super(`${variable} ${problem}`);
    this.name = "ConfigError";
    this.variable = variable;
  }
}

function readSecret(): string {
  const value = process.env[SECRET_VARIABLE];
  if (value === undefined || value === "") {
    throw new ConfigError(SECRET_VARIABLE, "is not set");
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(SECRET_VARIABLE, `must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return value;
}

/** A 32-byte key for one purpose: HKDF-SHA256(ikm = IRON_SESSION_PASSWORD, salt = empty, info). */
export function deriveKey(info: string): Uint8Array {
  if (info.length === 0) {
    throw new TypeError("deriveKey: info must name the key's purpose");
  }
  const secret = readSecret();
  return new Uint8Array(hkdfSync("sha256", secret, new Uint8Array(0), info, KEY_BYTES));
}
