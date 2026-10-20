import { z } from "zod";
import { rawBodySchema } from "@/platform/raw-body";

/**
 * Building blocks of the capability modules: input schemas that make a malformed path impossible,
 * the query-string builder, and the shapes several backends share. Pure.
 */

/** An id interpolated into a path: never `/`, `\` or `..`, whatever else it holds. */
export const pathSegment = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !s.includes("/") && !s.includes("\\") && !s.includes(".."), {
    message: "must not contain /, \\ or ..",
  });

export const uuid = z.uuid();

/** A timestamp as FastAPI serialises one: ISO 8601 with a `Z` or an offset. */
export const isoDateTime = z.iso.datetime({ offset: true });

export const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lower-case hex characters");

/** Text with at least one non-whitespace character (whitespace-only text has no content). */
export const nonBlank = z.string().refine((s) => /\S/u.test(s), { message: "must not be blank" });

/** No input at all — an extra key is a caller's mistake, not something to forward. */
export const noInput = z.strictObject({});

/**
 * An integer from JSON or from a query string (where every value is a string): digits only, so
 * `"2.5"`, `"1e3"` and `""` are refused rather than coerced.
 */
export function integer(min: number, max: number) {
  return z
    .union([
      z.number(),
      z
        .string()
        .regex(/^-?\d+$/, "must be an integer")
        .transform(Number),
    ])
    .pipe(z.number().int().min(min).max(max));
}

/** A JSON object of any JSON values — what FastAPI declares as `dict[str, Any]`. */
export const jsonObject = z.record(z.string(), z.json());

/** A string-to-string map — what inkprint's batch and envelope endpoints declare. */
export const stringMap = z.record(z.string(), z.string());

type QueryValue = string | number | undefined;

/** `path` plus a query string of the defined values, in the order given; no `?` when empty. */
export function withQuery(path: string, params: Readonly<Record<string, QueryValue>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.append(key, String(value));
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

/** Each path segment, percent-encoded. */
export const seg = encodeURIComponent;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Raw bytes that start with the PNG signature. */
export const pngBody = rawBodySchema.refine(
  (b) => PNG_SIGNATURE.every((byte, i) => b.bytes[i] === byte),
  { message: "not a PNG" },
);

/** Raw bytes that hold one PEM public key. */
export const pemBody = rawBodySchema.refine(
  (b) => {
    const text = new TextDecoder().decode(b.bytes);
    return text.includes("-----BEGIN PUBLIC KEY-----") && text.includes("-----END PUBLIC KEY-----");
  },
  { message: "not a PEM public key" },
);

/** A PEM public key carried as a JSON string. */
export const pemString = z
  .string()
  .refine((s) => s.startsWith("-----BEGIN PUBLIC KEY-----"), { message: "not a PEM public key" });
