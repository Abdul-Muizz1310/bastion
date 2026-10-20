import { describe, expect, it } from "vitest";
import { productRows, serviceRows } from "@/features/platform/registry-view";
import { PRODUCTS, SERVICE_REPOS, SERVICES } from "@/platform/registry/products";

/** Spec 21 §3.2 `/platform`: the registry, read from the one registry module. */

const GITHUB = /^https:\/\/github\.com\/Abdul-Muizz1310\/[a-z-]+$/;

describe("productRows", () => {
  const rows = productRows();

  it("lists the 8 products in the order of the dossier, bastion last", () => {
    expect(rows.map((r) => r.id)).toEqual([
      "magpie",
      "inkgrid",
      "inkthread",
      "inkprint",
      "paper-trail",
      "slowquery",
      "feathers",
      "bastion",
    ]);
  });

  it("names 15 repos, each a GitHub link of this account, once each", () => {
    const repos = rows.flatMap((r) => r.repos);
    expect(repos).toHaveLength(15);
    expect(new Set(repos.map((r) => r.url)).size).toBe(15);
    for (const r of repos) expect(r.url).toMatch(GITHUB);
  });

  it("links each product to its workbench, and carries its packages and live frontend", () => {
    const slowquery = rows.find((r) => r.id === "slowquery");
    expect(slowquery).toMatchObject({
      workbench: "/tools/slowquery",
      packages: [{ name: "slowquery-detective", url: "https://pypi.org/project/slowquery-detective/" }],
      frontend: { host: "slowquery-dashboard-frontend.vercel.app" },
      services: ["slowquery"],
    });
    expect(rows.find((r) => r.id === "inkgrid")?.frontend).toBeNull();
  });
});

describe("serviceRows", () => {
  const rows = serviceRows();

  it("lists the 6 services, each its own audience", () => {
    expect(rows.map((r) => r.id).sort()).toEqual(Object.keys(SERVICES).sort());
    for (const r of rows) expect(r.audience).toBe(r.id);
  });

  it("names each service's host and the repo its commits belong to", () => {
    const pt = rows.find((r) => r.id === "paper-trail");
    expect(pt).toMatchObject({
      host: "paper-trail-backend-jjpf.onrender.com",
      repo: { name: "paper-trail-backend", url: "https://github.com/Abdul-Muizz1310/paper-trail-backend" },
    });
  });

  it("every service's repo is a repo of a product that runs on it", () => {
    for (const [service, repo] of Object.entries(SERVICE_REPOS)) {
      const owners = PRODUCTS.filter((p) => (p.services as string[]).includes(service));
      expect(owners.flatMap((p) => p.repos.map((r) => r.name))).toContain(repo);
    }
  });
});
