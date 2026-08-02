import { z } from "zod/v4";

/**
 * Spec 19 — the network edge of the dossier verification UI.
 *
 * Kept out of the component so every failure branch (403, unparseable body,
 * malformed success payload, network drop) is reachable in a unit test, and so
 * the untrusted HTTP response is parsed rather than cast.
 */

const verifyResultSchema = z.object({
  certificate_id: z.string(),
  valid: z.boolean(),
  checks: z.object({
    signature: z.boolean(),
    hash: z.boolean(),
    simhash: z.boolean().optional(),
    embedding: z.boolean().optional(),
  }),
  reason: z.string().optional(),
});

const verifyResponseSchema = z.object({
  dossier_id: z.string(),
  overall_valid: z.boolean().nullable(),
  message: z.string().optional(),
  results: z.array(verifyResultSchema),
  verified_at: z.string(),
});

export type VerifyResult = z.infer<typeof verifyResultSchema>;
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;

export type VerifyOutcome = { ok: true; response: VerifyResponse } | { ok: false; error: string };

export async function fetchVerification(
  dossierId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(`/api/dossiers/${dossierId}/verify`);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Verify failed (${res.status})`;
    return { ok: false, error: message };
  }

  const body = await res.json().catch(() => null);
  const parsed = verifyResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, error: "Malformed verification response" };
  }
  return { ok: true, response: parsed.data };
}
