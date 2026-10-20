/**
 * Python's `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, byte
 * for byte (spec 21 §6.5). paper-trail signs a transcript, and inkprint signs a dossier envelope,
 * over exactly that string's UTF-8 bytes, so verifying either signature means rebuilding it here.
 * It is not `canonicalJson` (RFC 8785):
 *
 * - **Numbers keep Python's int/float split**, which a JSON parser erases: a plain `number` is an
 *   `int` (a safe integer, written in decimal) and a `PyFloat` is a `float`, written as CPython's
 *   `repr`: the shortest round-trip digits, as fixed notation while the decimal exponent is in
 *   [-4, 16) with a `.0` when integral, otherwise as `d.ddde±XX` (two exponent digits at least).
 *   So `1.0` (not `1`), `1e-05` (not `0.00001`), `1e+16` (not `10000000000000000`).
 * - **Keys sort by code point** (Python `str` order), not by UTF-16 code unit.
 * - **Strings** escape `"`, `\` and U+0000–U+001F (`\b \t \n \f \r`, else lower-case `\u00xx`)
 *   and write everything else as itself — what `JSON.stringify` does for a well-formed string. A
 *   lone surrogate is refused: Python could not have encoded it to UTF-8, so nothing was signed.
 *
 * Anything else is refused with a TypeError (non-finite floats, non-integer or unsafe ints,
 * `undefined`, functions, bigints, sparse arrays, objects that are not plain, cycles).
 */

/** A Python `float`. Plain numbers are Python `int`s. */
export class PyFloat {
  constructor(readonly value: number) {}
}

export type PyJson =
  | null
  | boolean
  | number
  | string
  | PyFloat
  | PyJson[]
  | { [key: string]: PyJson };

function refuse(what: string): never {
  throw new TypeError(`pythonJsonDumps: ${what} has no Python JSON form here`);
}

/** CPython's `float.__repr__` (`format_float_short`, mode 'r'). */
export function pythonFloatRepr(x: number): string {
  if (!Number.isFinite(x)) refuse(`the float ${x}`);
  if (Object.is(x, -0)) return "-0.0";
  const sign = x < 0 ? "-" : "";
  // `toExponential()` with no argument gives the shortest round-trip digits, as Python's repr does.
  const [mantissa = "", exponent = "0"] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const decpt = Number(exponent) + 1; // the decimal point sits after `decpt` digits
  if (decpt <= -4 || decpt > 16) {
    const exp = decpt - 1;
    const rest = digits.length > 1 ? `.${digits.slice(1)}` : "";
    const magnitude = String(Math.abs(exp)).padStart(2, "0");
    return `${sign}${digits[0]}${rest}e${exp < 0 ? "-" : "+"}${magnitude}`;
  }
  if (decpt <= 0) return `${sign}0.${"0".repeat(-decpt)}${digits}`;
  if (decpt >= digits.length) return `${sign}${digits}${"0".repeat(decpt - digits.length)}.0`;
  return `${sign}${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
}

function str(s: string): string {
  if (!s.isWellFormed()) refuse("a string with a lone surrogate");
  return JSON.stringify(s);
}

/** Python's `str` order: by code point, which differs from UTF-16 order above U+FFFF. */
function byCodePoint(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i]?.codePointAt(0) ?? 0) - (y[i]?.codePointAt(0) ?? 0);
    if (d !== 0) return d;
  }
  return x.length - y.length;
}

function isPlainList(list: readonly unknown[]): boolean {
  if (Object.keys(list).length !== list.length) return false;
  for (let i = 0; i < list.length; i++) {
    if (!Object.hasOwn(list, i)) return false;
  }
  return true;
}

function write(value: unknown, ancestors: Set<object>): string {
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) refuse(`the int ${value}`);
      return String(value);
    case "string":
      return str(value);
    case "object":
      if (value === null) return "null";
      if (value instanceof PyFloat) return pythonFloatRepr(value.value);
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
      if (!isPlainList(value)) refuse("a sparse or decorated array");
      return `[${value.map((item) => write(item, ancestors)).join(",")}]`;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) refuse("an object that is not plain");
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort(byCodePoint)
      .map((key) => `${str(key)}:${write(record[key], ancestors)}`);
    return `{${members.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function pythonJsonDumps(value: PyJson): string {
  return write(value, new Set());
}
