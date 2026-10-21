import type { Metadata } from "next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Spec 20 — every page names itself in the tab; the root template adds " — bastion". A title is
 * derived from the route alone: it never reads the database or the network. Every indexable page
 * describes itself in its own words and names itself as canonical (amendment: search).
 */

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("a page title must not read the database");
  },
}));

import * as trace from "@/app/audit/[requestId]/page";
import * as audit from "@/app/audit/page";
import * as dossierPage from "@/app/d/[id]/page";
import * as compose from "@/app/dossier/page";
import * as home from "@/app/page";
import * as platform from "@/app/platform/page";
import * as timeTravel from "@/app/time-travel/page";
import * as bastionWorkbench from "@/app/tools/bastion/page";
import * as feathersWorkbench from "@/app/tools/feathers/page";
import * as inkgridWorkbench from "@/app/tools/inkgrid/page";
import * as inkprintWorkbench from "@/app/tools/inkprint/page";
import * as inkthreadWorkbench from "@/app/tools/inkthread/page";
import * as magpieWorkbench from "@/app/tools/magpie/page";
import * as tools from "@/app/tools/page";
import * as paperTrailWorkbench from "@/app/tools/paper-trail/page";
import * as slowqueryWorkbench from "@/app/tools/slowquery/page";
import { SITE } from "@/lib/site/config";

type StaticPage = { metadata?: Metadata };

const ID = "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b";
const OTHER_ID = "5b1e0c3a-0000-4000-8000-000000000000";

/** Every page the sitemap lists, by its route. */
const INDEXABLE: Record<string, StaticPage> = {
  "/": home,
  "/tools": tools,
  "/tools/bastion": bastionWorkbench,
  "/tools/feathers": feathersWorkbench,
  "/tools/inkgrid": inkgridWorkbench,
  "/tools/inkthread": inkthreadWorkbench,
  "/tools/inkprint": inkprintWorkbench,
  "/tools/magpie": magpieWorkbench,
  "/tools/paper-trail": paperTrailWorkbench,
  "/tools/slowquery": slowqueryWorkbench,
  "/dossier": compose,
  "/audit": audit,
  "/time-travel": timeTravel,
  "/platform": platform,
};

const STATIC_PAGES: [string, StaticPage, string][] = [
  ["/tools", tools, "workbenches"],
  ["/dossier", compose, "compose a dossier"],
  ["/audit", audit, "audit log"],
  ["/time-travel", timeTravel, "time travel"],
  ["/platform", platform, "platform"],
];

/** A page's description as a search result shows it: its own, or the root's. */
const described = (page: StaticPage) => page.metadata?.description ?? SITE.description;

describe("20-site: page titles (case 11, case 14)", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("a page title must not call the network");
      }),
    );
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it.each(STATIC_PAGES)(
    "case 14: %s is titled from its h1 or nav label, described and canonical",
    (route, page, title) => {
      expect(page.metadata).toEqual({
        title,
        description: expect.any(String),
        alternates: { canonical: route },
      });
    },
  );

  it("case 11: the home page sets only its canonical, no title, Open Graph or robots", () => {
    expect((home as StaticPage).metadata).toEqual({ alternates: { canonical: "/" } });
  });

  it("case 14: a request trace derives its title from the id alone and stays out of search", async () => {
    await expect(
      trace.generateMetadata({ params: Promise.resolve({ requestId: ID }) }),
    ).resolves.toEqual({ title: "request 0f8a1c2e", robots: { index: false } });
  });

  it("case 14: a dossier is titled from its id, described by one fixed sentence, and canonical", async () => {
    const [one, other] = await Promise.all(
      [ID, OTHER_ID].map((id) => dossierPage.generateMetadata({ params: Promise.resolve({ id }) })),
    );
    expect(one).toEqual({
      title: "dossier 0f8a1c2e",
      description: expect.any(String),
      alternates: { canonical: `/d/${ID}` },
    });
    expect(other?.description).toBe(one?.description);
    expect(one?.description).not.toBe(SITE.description);
  });

  it("case 14: every sitemap route is an indexable page that names itself as canonical", () => {
    expect(Object.keys(INDEXABLE)).toEqual([...SITE.routes.sitemap]);
    for (const [route, page] of Object.entries(INDEXABLE)) {
      expect(page.metadata?.alternates?.canonical, route).toBe(route);
      expect(page.metadata?.robots, route).toBeUndefined();
      expect(page.metadata, route).not.toHaveProperty("openGraph");
      expect(page.metadata, route).not.toHaveProperty("twitter");
    }
  });

  it("case 14: no two sitemap pages share a description", () => {
    const descriptions = Object.values(INDEXABLE).map(described);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
});
