import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAudit } from "@/features/audit/load";
import type { AuditPage } from "@/features/audit/view";

/**
 * Spec 21 §3.2 `/audit`: a refused filter reads nothing (invariant 3); an unreachable database is
 * the log being unavailable, never the page failing.
 */

const EMPTY: AuditPage = { events: [], older: null };
const listAudit = vi.fn();

beforeEach(() => {
  listAudit.mockReset();
  listAudit.mockResolvedValue(EMPTY);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadAudit", () => {
  it("reads the page the query asks for", async () => {
    const state = await loadAudit({ service: "magpie", before: "40" }, { listAudit });
    expect(listAudit).toHaveBeenCalledWith({ filters: { service: "magpie" }, before: 40 });
    expect(state).toEqual({
      kind: "ok",
      query: { filters: { service: "magpie" }, before: 40 },
      page: EMPTY,
    });
  });

  it("refuses what it does not understand before reading anything", async () => {
    const state = await loadAudit({ sort: "asc", service: "nope" }, { listAudit });
    expect(listAudit).not.toHaveBeenCalled();
    expect(state).toEqual({
      kind: "refused",
      problems: [
        { param: "sort", reason: "unknown" },
        { param: "service", reason: "malformed" },
      ],
    });
  });

  it("marks the log unavailable when the read fails, keeping the query", async () => {
    listAudit.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const state = await loadAudit({ action: "gateway." }, { listAudit });
    expect(state).toEqual({
      kind: "unavailable",
      query: { filters: { action: "gateway." }, before: null },
    });
    expect(console.error).toHaveBeenCalled();
  });
});
