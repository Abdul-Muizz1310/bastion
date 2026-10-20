import { z } from "zod";

/**
 * Raw answers (spec 21 §4), pure and client-safe: the capability schemas the browser loads use
 * them. `raw` capabilities skip JSON: the upstream bytes and content type pass through as a
 * `RawBody`, which the capability's `output` schema (normally `rawBodySchema`) still parses. The
 * content type must be one the raw kind declares, or the call is `invalid_response`.
 */
export type RawKind = "png" | "zip" | "pem";

export const RAW_CONTENT_TYPES: Readonly<Record<RawKind, readonly string[]>> = {
  png: ["image/png"],
  zip: ["application/zip", "application/x-zip-compressed"],
  // A PEM public key: inkprint serves `text/plain; charset=utf-8`; the PEM type is also accepted.
  pem: ["text/plain", "application/x-pem-file"],
};

export const rawBodySchema = z.object({
  contentType: z.string().min(1),
  bytes: z.instanceof(Uint8Array),
});

export type RawBody = z.infer<typeof rawBodySchema>;
