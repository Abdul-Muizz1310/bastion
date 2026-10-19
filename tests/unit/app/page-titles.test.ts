import type { Metadata } from "next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Spec 20 — every page names itself in the tab; the root template adds " — bastion".
 * A title is derived from the route alone: it never reads the database or the network.
 */

vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("a page title must not read the database");
  },
}));

import * as trace from "@/app/(app)/audit/[requestId]/page";
import * as audit from "@/app/(app)/audit/page";
import * as dashboard from "@/app/(app)/dashboard/page";
import * as service from "@/app/(app)/services/[id]/page";
import * as timeTravel from "@/app/(app)/time-travel/page";
import * as home from "@/app/page";

type StaticPage = { metadata?: Metadata };

const ID = "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b";

const STATIC_PAGES: [string, StaticPage, string][] = [
  ["/dashboard", dashboard, "platform services"],
  ["/audit", audit, "audit log"],
  ["/time-travel", timeTravel, "time travel"],
];

const DYNAMIC_PAGES: [string, () => Promise<Metadata>, string][] = [
  [
    "/services/[id]",
    () => service.generateMetadata({ params: Promise.resolve({ id: "paper-trail" }) }),
    "service paper-trail",
  ],
  [
    "/audit/[requestId]",
    () => trace.generateMetadata({ params: Promise.resolve({ requestId: ID }) }),
    "request 0f8a1c2e",
  ],
];

describe("20-site: page titles (case 11)", () => {
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

  it.each(STATIC_PAGES)("case 11: %s is titled from its h1 or nav label", (_route, page, title) => {
    expect(page.metadata).toEqual({ title });
  });

  it.each(DYNAMIC_PAGES)(
    "case 11: %s derives its title from the id alone",
    async (_route, generate, title) => {
      await expect(generate()).resolves.toEqual({ title });
    },
  );

  it("case 11: the home page sets only its canonical, no title, Open Graph or robots", () => {
    expect((home as StaticPage).metadata).toEqual({ alternates: { canonical: "/" } });
  });
});
