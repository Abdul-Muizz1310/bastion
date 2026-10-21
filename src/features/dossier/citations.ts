/**
 * Transcript citations and evidence anchors (spec 21 §6.6, "The receipt"). paper-trail writes a
 * certificate citation inline as `[cert:<id>]`; each becomes a link to the evidence row holding
 * that certificate, whose anchor is `e-<key>` (the same anchor the debate's pooled URLs use). A
 * certificate no row holds keeps no key, so it is said rather than linked. Pure.
 */

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "cert"; certificateId: string; key: string | null };

const CERT = /\[cert:([^\]\s]+)\]/g;

export function citationSegments(text: string, keyOf: ReadonlyMap<string, string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CERT)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const certificateId = m[1] ?? "";
    out.push({ kind: "cert", certificateId, key: keyOf.get(certificateId.toLowerCase()) ?? null });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The id of an evidence row on the dossier page. */
export function evidenceAnchor(key: string): string {
  return `e-${key}`;
}

/** A link to that row (the key percent-encoded: a fragment is matched against the decoded id). */
export function evidenceHref(key: string): string {
  return `#e-${encodeURIComponent(key)}`;
}

/** The id of a document's section, and of one of its pages, on the dossier page. */
export function documentAnchor(documentId: string, page?: number): string {
  return page === undefined ? `doc-${documentId}` : `doc-${documentId}-p${page}`;
}

/** An http(s) URL as given, else null: nothing else is ever made a link. */
export function httpUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

/** Every outbound link taken from scraped or model-written content (Ruling AK). */
export const UNTRUSTED_REL = "nofollow ugc noreferrer";
