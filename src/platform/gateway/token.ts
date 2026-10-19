import * as jose from "jose";
import { z } from "zod";
import { actorSchema } from "@/platform/audit/event";
import { isServiceId, type ServiceId } from "@/platform/registry/products";
import type { VisitorId } from "@/platform/visitor";
import { keyId, signingKey } from "./keys";

/**
 * The platform token bastion mints (docs/specs/22-platform-contract-v2.md §1, §4): a compact JWS,
 * EdDSA over Ed25519, header `kid`, and exactly these claims — `aud` and `service` are the
 * receiving service, `exp = iat + 60`, `jti` a UUID v4. `cap` is informational for the backend;
 * it is never trusted for authorisation.
 */

export type Grant = "viewer" | "editor" | "admin";

export const GRANTS: readonly Grant[] = ["viewer", "editor", "admin"];

export const TOKEN_TTL_S = 60;

export const TOKEN_ISSUER = "bastion";

export type TokenClaims = {
  iss: typeof TOKEN_ISSUER;
  aud: ServiceId;
  service: ServiceId;
  sub: string;
  role: Grant;
  cap: string;
  iat: number;
  exp: number;
  jti: string;
};

/** Seconds past this are a millisecond timestamp passed by mistake (year 2286). */
const MAX_EPOCH_S = 10_000_000_000;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const serviceIdSchema = z.custom<ServiceId>(
  (v) => typeof v === "string" && isServiceId(v),
  "unknown service id",
);
const epochSeconds = z.number().int().nonnegative().max(MAX_EPOCH_S);

/** The claims as the contract fixes them — strict, so an extra or missing claim never ships. */
const tokenClaimsSchema = z
  .strictObject({
    iss: z.literal(TOKEN_ISSUER),
    aud: serviceIdSchema,
    service: serviceIdSchema,
    sub: actorSchema,
    role: z.enum(GRANTS),
    cap: z.string().min(1),
    iat: epochSeconds,
    exp: epochSeconds,
    jti: z.string().regex(UUID_V4, "jti must be a UUID v4"),
  })
  .refine((c) => c.aud === c.service, "aud must equal service")
  .refine((c) => c.exp - c.iat === TOKEN_TTL_S, `exp must be iat + ${TOKEN_TTL_S}`);

export type TokenClaimsInput = {
  service: ServiceId;
  sub: VisitorId | "bastion";
  role: Grant;
  cap: string;
  nowS: number;
  jti: string;
};

/** Pure: the contract-v2 claims for one call. Throws on anything the contract does not allow. */
export function tokenClaims(i: TokenClaimsInput): TokenClaims {
  return tokenClaimsSchema.parse({
    iss: TOKEN_ISSUER,
    aud: i.service,
    service: i.service,
    sub: i.sub,
    role: i.role,
    cap: i.cap,
    iat: i.nowS,
    exp: i.nowS + TOKEN_TTL_S,
    jti: i.jti,
  });
}

/** Signs the claims with bastion's key. Claims are re-checked, so a hand-built set cannot drift. */
export async function mintToken(claims: TokenClaims): Promise<string> {
  const payload = tokenClaimsSchema.parse(claims);
  const key = await signingKey();
  return new jose.SignJWT(payload).setProtectedHeader({ alg: "EdDSA", kid: keyId() }).sign(key);
}
