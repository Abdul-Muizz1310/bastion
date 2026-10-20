/**
 * Canonical JSON (spec 21 §6.5): the single string a receipt is hashed over, so anyone holding the
 * same value derives the same digest. Rules, in the spirit of RFC 8785:
 *
 * - object keys sorted by UTF-16 code units (`Array.prototype.sort`'s default order), no whitespace;
 * - strings and numbers exactly as `JSON.stringify` writes them (shortest round-trip numbers, `-0`
 *   as `0`, lone surrogates escaped as `\udxxx`, so the output is always well-formed and encodes to
 *   UTF-8 unambiguously);
 * - array order kept.
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
      // Exactly the indices 0..length-1: no holes, no extra properties.
      if (Object.keys(value).length !== value.length) refuse("a sparse or decorated array");
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
