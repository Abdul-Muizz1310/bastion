/**
 * Small readers over server-rendered HTML for component tests (the unit tier renders with
 * react-dom/server and has no DOM). They only need to understand markup these components emit.
 */

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|nbsp|#x27|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** Visible text of a fragment: comments and tags dropped, whitespace collapsed. */
export function textOf(fragment: string): string {
  return decode(fragment.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The inner HTML of the element with this id (it must not nest an element of its own tag). */
export function innerById(html: string, id: string): string {
  const re = new RegExp(`<([a-zA-Z]+)\\b[^>]*\\bid="${escapeRe(id)}"[^>]*>([\\s\\S]*?)</\\1>`);
  const match = re.exec(html);
  if (!match) throw new Error(`no element with id "${id}"`);
  return match[2] ?? "";
}

/** Drops every element marked aria-hidden="true" (assumes it does not nest its own tag). */
export function withoutHidden(fragment: string): string {
  return fragment.replace(/<([a-zA-Z]+)\b[^>]*\saria-hidden="true"[^>]*>[\s\S]*?<\/\1>/g, " ");
}

export function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${escapeRe(name)}="([^"]*)"`).exec(tag);
  return match ? decode(match[1] ?? "") : undefined;
}

export type RenderedLink = { tag: string; href?: string; inner: string; name: string };

/** Every <a>, with the accessible name computed from aria-labelledby, aria-label or its text. */
export function links(html: string): RenderedLink[] {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map((m) => {
    const tag = m[1] ?? "";
    const inner = m[2] ?? "";
    const labelledby = attr(tag, "aria-labelledby");
    const label = attr(tag, "aria-label");
    const name = labelledby
      ? labelledby
          .split(/\s+/)
          .map((id) => textOf(innerById(html, id)))
          .join(" ")
      : (label ?? textOf(withoutHidden(inner)));
    return { tag, href: attr(tag, "href"), inner, name };
  });
}

/** The slice of HTML inside the first element carrying this attribute value. */
export function sliceByAttr(html: string, name: string, value: string): string {
  const start = html.indexOf(`${name}="${value}"`);
  if (start < 0) throw new Error(`no element with ${name}="${value}"`);
  const open = html.lastIndexOf("<", start);
  const tag = /^<([a-zA-Z]+)/.exec(html.slice(open))?.[1];
  if (!tag) throw new Error("unreadable tag");
  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
  re.lastIndex = open;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(open, m.index + m[0].length);
  }
  throw new Error("unclosed element");
}
