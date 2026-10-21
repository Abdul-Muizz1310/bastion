/**
 * v1's links, pointed at their v2 pages (spec 21 §3.2 "Redirects"): `/dashboard` → `/platform`, and
 * `/services/<product id>` → `/tools/<product id>`, both permanent (308). The product ids become a
 * path pattern's alternation, so each must be a plain slug; any other `/services/<x>` stays a 404.
 * Pure: next.config.ts builds its rules with it.
 */

export type LegacyRedirect = { source: string; destination: string; permanent: true };

const SLUG = /^[a-z][a-z0-9-]*$/;

export function legacyRedirects(productIds: readonly string[]): LegacyRedirect[] {
  if (productIds.length === 0) throw new RangeError("legacyRedirects: no products");
  for (const id of productIds) {
    if (!SLUG.test(id))
      throw new RangeError(`legacyRedirects: ${JSON.stringify(id)} is not a slug`);
  }
  return [
    { source: "/dashboard", destination: "/platform", permanent: true },
    {
      source: `/services/:id(${productIds.join("|")})`,
      destination: "/tools/:id",
      permanent: true,
    },
  ];
}
