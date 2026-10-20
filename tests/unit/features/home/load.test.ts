import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicDossier } from "@/dossier/gallery";
import { loadHome } from "@/features/home/load";

/**
 * Spec 21 §3.1: the home page reads the 12 most recent public dossiers (the gallery keeps the 6 most
 * recent succeeded) and today's debate budget. Neither may take the landing page down: a database
 * error marks the gallery unavailable, a budget-store error hides the meter.
 */

function dossier(i: number, status: PublicDossier["status"] = "succeeded"): PublicDossier {
  return {
    id: `0f8a1c2e-4b6d-4e8f-9a0b-${String(i).padStart(12, "0")}`,
    claim: `claim ${i}`,
    mode: "rapid",
    status,
    verdict: status === "succeeded" ? "TRUE" : null,
    confidence: status === "succeeded" ? 0.9 : null,
    createdAt: "2026-10-20T10:00:00.000Z",
    evidenceCount: 3,
    documentCount: 0,
    products: ["magpie"],
  };
}

const BUDGETS = {
  debate: { limit: 4, left: 3 },
  upload: { limit: 3, left: 3 },
  leakscan: { limit: 10, left: 10 },
  scrape: { limit: 30, left: 30 },
  certify: { limit: 200, left: 200 },
  "feathers.write": { limit: 50, left: 50 },
};

const listPublicDossiers = vi.fn();
const budgetsLeft = vi.fn();
const deps = { listPublicDossiers, budgetsLeft };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  listPublicDossiers.mockResolvedValue([]);
  budgetsLeft.mockResolvedValue(BUDGETS);
});

describe("loadHome", () => {
  it("reads the 12 most recent public dossiers and keeps the 6 most recent succeeded", async () => {
    listPublicDossiers.mockResolvedValue([
      dossier(1, "running"),
      ...Array.from({ length: 8 }, (_, i) => dossier(i + 2)),
      dossier(10, "failed"),
    ]);
    const home = await loadHome(deps);
    expect(listPublicDossiers).toHaveBeenCalledWith(12);
    expect(home.gallery.kind).toBe("ok");
    if (home.gallery.kind !== "ok") throw new Error("unreachable");
    expect(home.gallery.dossiers.map((d) => d.claim)).toEqual([
      "claim 2",
      "claim 3",
      "claim 4",
      "claim 5",
      "claim 6",
      "claim 7",
    ]);
  });

  it("returns today's debate budget", async () => {
    expect((await loadHome(deps)).debates).toEqual({ limit: 4, left: 3 });
  });

  it("marks the gallery unavailable when the database fails, and logs why", async () => {
    const err = new Error("connect ECONNREFUSED");
    listPublicDossiers.mockRejectedValue(err);
    const home = await loadHome(deps);
    expect(home.gallery).toEqual({ kind: "unavailable" });
    expect(home.debates).toEqual({ limit: 4, left: 3 });
    expect(console.error).toHaveBeenCalledWith("home: gallery unavailable", err);
  });

  it("hides the budget when the budget store fails, and logs why", async () => {
    const err = new Error("upstash down");
    budgetsLeft.mockRejectedValue(err);
    const home = await loadHome(deps);
    expect(home.debates).toBeNull();
    expect(home.gallery.kind).toBe("ok");
    expect(console.error).toHaveBeenCalledWith("home: budget unavailable", err);
  });

  it("asks for both at once, not one after the other", async () => {
    let releaseList!: () => void;
    listPublicDossiers.mockReturnValue(
      new Promise((resolve) => {
        releaseList = () => resolve([]);
      }),
    );
    const pending = loadHome(deps);
    await Promise.resolve();
    expect(budgetsLeft).toHaveBeenCalledTimes(1);
    releaseList();
    await pending;
  });
});
