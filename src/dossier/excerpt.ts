/**
 * The excerpt an evidence row shows (spec 21 §6.3), pure: seal stores exactly the first
 * `EXCERPT_CHARS` UTF-16 code units of the certified text. Postgres keeps it as UTF-8, and the
 * driver encodes a lone surrogate (an astral character cut at the boundary) as U+FFFD, so the
 * excerpt as stored is that slice after a UTF-8 round trip — what verification compares against.
 */

export const EXCERPT_CHARS = 400;

/** What seal writes for a certified text. */
export function excerptOf(text: string): string {
  return text.slice(0, EXCERPT_CHARS);
}

/** The excerpt as Postgres hands it back: `excerptOf` after a UTF-8 round trip. */
export function storedExcerptOf(text: string): string {
  return new TextDecoder().decode(new TextEncoder().encode(excerptOf(text)));
}
