import * as z from "zod/mini";

/**
 * The answer of `GET /api/platform/token-preview` (spec 21 §5, §5.1), parsed in the browser: the
 * header and claims bastion would mint for one capability call by this visitor — never a token.
 */

const epoch = z.number().check(z.int(), z.nonnegative());

export const tokenPreviewSchema = z.object({
  header: z.object({ alg: z.literal("EdDSA"), kid: z.string().check(z.minLength(1)) }),
  claims: z.object({
    iss: z.string(),
    aud: z.string(),
    service: z.string(),
    sub: z.string(),
    role: z.enum(["viewer", "editor", "admin"]),
    cap: z.string(),
    iat: epoch,
    exp: epoch,
    jti: z.string(),
  }),
  jwks: z.string().check(z.startsWith("/")),
  capability: z.object({
    id: z.string(),
    service: z.string(),
    grant: z.enum(["viewer", "editor", "admin"]),
    cost: z.enum(["free", "quota", "llm"]),
    budget: z.nullable(z.string()),
    routed: z.boolean(),
  }),
});

export type TokenPreview = z.infer<typeof tokenPreviewSchema>;
