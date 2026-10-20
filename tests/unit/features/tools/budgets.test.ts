import { describe, expect, it, vi } from "vitest";
import { affordability, fetchBudgets, parseBudgets } from "@/features/tools/budgets";
import { BUDGET_KEYS } from "@/platform/budget-keys";

/** Today's budgets as a workbench reads them (spec 21 §5.1, "Budgets"). */

const full = Object.fromEntries(BUDGET_KEYS.map((key) => [key, { limit: 4, left: 3 }]));

describe("parseBudgets", () => {
  it("accepts one {limit, left} per budget key", () => {
    expect(parseBudgets(full).debate).toEqual({ limit: 4, left: 3 });
  });

  it.each([
    ["a missing key", { ...full, debate: undefined }],
    ["more left than the limit", { ...full, scrape: { limit: 2, left: 3 } }],
    ["a negative count", { ...full, upload: { limit: 3, left: -1 } }],
    ["a fraction", { ...full, certify: { limit: 200, left: 1.5 } }],
    ["not an object", [1, 2]],
  ])("refuses %s", (_name, body) => {
    expect(() => parseBudgets(body)).toThrow();
  });
});

describe("affordability", () => {
  it("is ok while enough units are left", () => {
    expect(affordability({ limit: 4, left: 1 }, 1)).toBe("ok");
  });

  it("is short at zero, and when fewer units are left than the action spends", () => {
    expect(affordability({ limit: 4, left: 0 }, 1)).toBe("short");
    expect(affordability({ limit: 50, left: 1 }, 2)).toBe("short");
  });

  it("is unknown when the budgets could not be read (the gateway still enforces them)", () => {
    expect(affordability(null, 1)).toBe("unknown");
  });

  it("refuses a unit count that is not a positive whole number", () => {
    expect(() => affordability({ limit: 4, left: 4 }, 0)).toThrow(RangeError);
    expect(() => affordability({ limit: 4, left: 4 }, 1.5)).toThrow(RangeError);
  });
});

describe("fetchBudgets", () => {
  it("GETs /api/platform/budgets uncached and parses it", async () => {
    const fetchImpl = vi.fn(async () => Response.json(full));
    const budgets = await fetchBudgets(new AbortController().signal, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/platform/budgets",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(budgets.scrape).toEqual({ limit: 4, left: 3 });
  });

  it("throws on a non-2xx answer", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "budgets_unavailable" }, { status: 503 }));
    await expect(fetchBudgets(new AbortController().signal, fetchImpl)).rejects.toThrow(/503/);
  });
});
