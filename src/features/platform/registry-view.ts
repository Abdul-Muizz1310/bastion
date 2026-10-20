import {
  PRODUCTS,
  type ProductId,
  type RepoRef,
  SERVICE_REPOS,
  SERVICES,
  type ServiceId,
} from "@/platform/registry/products";

/**
 * The registry as `/platform` lists it (spec 21 §3.2), read from the one registry module: the
 * products in the dossier's order with their repos, packages and live frontends, and the services
 * with their host, audience (their own id, spec 21 §7) and the repo their commits belong to.
 */

const GITHUB_OWNER = "https://github.com/Abdul-Muizz1310";

/** Sources first, bastion last — the same order as the home page's receipt. */
export const PRODUCT_ORDER: readonly ProductId[] = [
  "magpie",
  "inkgrid",
  "inkthread",
  "inkprint",
  "paper-trail",
  "slowquery",
  "feathers",
  "bastion",
];

export type ProductRow = {
  id: ProductId;
  name: string;
  tagline: string;
  workbench: string;
  repos: RepoRef[];
  packages: { name: string; url: string }[];
  frontend: { url: string; host: string } | null;
  services: ServiceId[];
};

export type ServiceRow = {
  id: ServiceId;
  host: string;
  audience: ServiceId;
  repo: RepoRef;
};

export function productRows(): ProductRow[] {
  const byId = new Map(PRODUCTS.map((p) => [p.id, p]));
  return PRODUCT_ORDER.map((id) => {
    const p = byId.get(id);
    if (!p) throw new Error(`platform: the registry has no ${id}`);
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      workbench: `/tools/${p.id}`,
      repos: [...p.repos],
      packages: [...p.packages],
      frontend: p.frontendUrl ? { url: p.frontendUrl, host: new URL(p.frontendUrl).host } : null,
      services: [...p.services],
    };
  });
}

export function serviceRows(): ServiceRow[] {
  return (Object.keys(SERVICES) as ServiceId[]).map((id) => ({
    id,
    host: new URL(SERVICES[id].baseUrl).host,
    audience: id,
    repo: { name: SERVICE_REPOS[id], url: `${GITHUB_OWNER}/${SERVICE_REPOS[id]}` },
  }));
}

export const BASTION_REPO: RepoRef = { name: "bastion", url: `${GITHUB_OWNER}/bastion` };
