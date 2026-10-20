/**
 * Canonical JSON (spec 21 §6.5): the single string a receipt is hashed over, so anyone holding the
 * same value derives the same digest.
 *
 * **The output is RFC 8785 (JSON Canonicalization Scheme, JCS) for any I-JSON value** (RFC 7493:
 * IEEE-754 doubles, well-formed Unicode strings, unique keys) — every value a receipt holds. Any
 * JCS library therefore reproduces it byte for byte (e.g. Python's `rfc8785` package, Java's
 * `json-canonicalization`). Python's `json.dumps(v, sort_keys=True, separators=(",", ":"))` does
 * **not**: it writes `1.0` and `1e-05` where JCS writes `1` and `0.00001`, sorts keys by code
 * point instead of UTF-16 code unit, and escapes non-ASCII unless `ensure_ascii=False`.
 *
 * - object keys sorted by UTF-16 code units (`Array.prototype.sort`'s default order, JCS §3.2.3),
 *   no whitespace;
 * - strings and numbers exactly as `JSON.stringify` writes them, which is what JCS specifies:
 *   shortest round-trip numbers in ECMAScript form (`-0` as `0`, `1e21` as `1e+21`); `"` and `\`
 *   escaped, the control characters as `\b \t \n \f \r` or else lower-case `\u00xx`, everything
 *   else written as itself. A lone surrogate (not I-JSON) is escaped as `\udxxx`, so the output
 *   is always well-formed and encodes to UTF-8 unambiguously;
 * - array order kept.
 *
 * The digest of a receipt is `sha256Hex` (lower-case hex SHA-256) of this string's UTF-8 bytes.
 *
 * Anything JSON cannot hold is refused with a TypeError instead of being dropped or coerced the way
 * `JSON.stringify` would: non-finite numbers, `undefined`, functions, symbols, bigints, sparse arrays
 * or arrays with extra properties, objects that are not plain (Date, Map, class instances), cycles.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: Json): string {
  return write(value, new Set());
}

function refuse(what: string): never {
  throw new TypeError(`canonicalJson: ${what} is not JSON`);
}

function isPlainList(list: readonly unknown[]): boolean {
  if (Object.keys(list).length !== list.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (!Object.hasOwn(list, i)) return false;
  }
  return true;
}

/** `ancestors` holds the containers on the path to `value`: meeting one again is a cycle. */
function write(value: unknown, ancestors: Set<object>): string {
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) refuse(String(value));
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (value === null) return "null";
      return container(value, ancestors);
    default:
      return refuse(`a ${typeof value}`);
  }
}

function container(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) refuse("a cyclic value");
  if (Object.getOwnPropertySymbols(value).length > 0) refuse("a symbol-keyed property");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      // Exactly the indices 0..length-1, each an own property: no holes, no extra properties
      // (the key count alone would accept a hole made up for by an extra key).
      if (!isPlainList(value)) refuse("a sparse or decorated array");
      return `[${value.map((item) => write(item, ancestors)).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) refuse("an object that is not plain");
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${write(record[key], ancestors)}`);
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
