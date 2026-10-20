/**
 * Evidence selection (spec 21 §6.1): which of the gathered candidates the debate gets to see.
 * Pure and deterministic: BM25 over lowercase word stems, a boost for the roles that carry a legal
 * claim and for tables, ties broken by key. No I/O, no clock, no randomness.
 */

export type Locator =
  | { kind: "url"; url: string }
  | {
      kind: "document";
      documentId: string;
      sha256: string;
      page: number;
      bbox: [number, number, number, number];
      nodeId: string | null;
    };

export type Candidate = {
  key: string;
  kind: "web" | "passage" | "table";
  product: "magpie" | "inkthread";
  title: string;
  url: string;
  text: string;
  locator: Locator;
  role?: string;
  magpieHash?: string;
};

/** The inkthread roles that make a passage worth reading for a claim (×1.5). */
export const BOOSTED_ROLES: ReadonlySet<string> = new Set([
  "obligation",
  "condition",
  "exception",
  "definition",
  "quantitative",
]);

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const ROLE_BOOST = 1.5;
export const TABLE_BOOST = 1.2;

const MIN_STEM = 3;

/** One trailing `ing`, `ed`, `es` (after s, x, z, ch, sh) or `s`; never below three letters. */
export function stem(word: string): string {
  const w = word.toLowerCase();
  const cut = (n: number) => (w.length - n >= MIN_STEM ? w.slice(0, -n) : w);
  if (w.endsWith("ing")) return cut(3);
  if (w.endsWith("ed")) return cut(2);
  if (/(?:[sxz]|ch|sh)es$/.test(w)) return cut(2);
  if (w.endsWith("s") && !w.endsWith("ss")) return cut(1);
  return w;
}

export function stems(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(stem);
}

function isBoosted(c: Candidate): boolean {
  return c.role !== undefined && BOOSTED_ROLES.has(c.role);
}

function boost(c: Candidate): number {
  return (isBoosted(c) ? ROLE_BOOST : 1) * (c.kind === "table" ? TABLE_BOOST : 1);
}

function compare(a: { c: Candidate; score: number }, b: { c: Candidate; score: number }): number {
  if (b.score !== a.score) return b.score - a.score;
  return a.c.key < b.c.key ? -1 : a.c.key > b.c.key ? 1 : 0;
}

export function selectEvidence(claim: string, candidates: Candidate[], limit: number): Candidate[] {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new RangeError("selectEvidence: limit must be a non-negative integer");
  }
  const pool = candidates.filter((c) => c.text.trim() !== "");
  if (limit === 0 || pool.length === 0) return [];

  const docs = pool.map((c) => stems(`${c.title} ${c.text}`));
  const query = [...new Set(stems(claim))];
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const term of query) df.set(term, docs.filter((d) => d.includes(term)).length);

  const bm25 = docs.map((tokens) => {
    let score = 0;
    for (const term of query) {
      const tf = tokens.filter((t) => t === term).length;
      if (tf === 0) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score +=
        (idf * tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + (BM25_B * tokens.length) / avgLen));
    }
    return score;
  });
  const anyOverlap = bm25.some((s) => s > 0);

  const ranked = pool
    .map((c, i) => ({ c, score: anyOverlap ? (bm25[i] ?? 0) * boost(c) : boost(c) }))
    .sort(compare);

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const { c } of ranked) {
    const text = c.text.trim();
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(c);
    if (out.length === limit) break;
  }
  return out;
}
