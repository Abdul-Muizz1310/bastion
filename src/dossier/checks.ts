/**
 * The vocabulary of "verify everything" (spec 21 §6.5), with no I/O and no crypto, so the browser
 * can read a verification's answer: the checks a run may return and the four states each can take.
 * `./verify` computes them and re-exports these names.
 */

export const CHECK_NAMES = [
  "certificates",
  "transcript",
  "envelope",
  "perf",
  "audit",
  "documents",
  "steps",
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export const CHECK_STATES = ["pass", "fail", "unavailable", "expired"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/** One receipt within a check: a certificate id, a debate id or a document id. */
export type CheckItem = { ref: string; state: CheckState; detail: string };

export type Check = {
  name: CheckName;
  state: CheckState;
  detail: string;
  /** Per-receipt states, for the checks that cover several receipts. */
  items?: CheckItem[];
};
