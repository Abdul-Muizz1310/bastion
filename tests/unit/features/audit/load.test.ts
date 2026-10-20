import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadAudit } from "@/features/audit/load";
import type { AuditPage } from "@/features/audit/view";

/**
 * Spec 21 §3.2 `/audit`: a refused filter reads nothing (invariant 3); an unreachable database is
 * the log being unavailable, never the page failing.
 */

const EMPTY: AuditPage = { events: [], older: null };
const listAudit = vi.fn();
const allowRead = vi.fn();
const deps = { listAudit, allowRead };

beforeEach(() => {
  listAudit.mockReset();
  listAudit.mockResolvedValue(EMPTY);
  allowRead.mockReset();
  allowRead.mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadAudit", () => {
  it("reads the page the query asks for", async () => {
    const state = await loadAudit({ service: "magpie", before: "40" }, deps);
    expect(listAudit).toHaveBeenCalledWith({ filters: { service: "magpie" }, before: 40 });
    expect(state).toEqual({
      kind: "ok",
      query: { filters: { service: "magpie" }, before: 40 },
      page: EMPTY,
    });
  });

  it("spends one audit read of the visitor's 60 a minute (Ruling AL)", async () => {
    await loadAudit({}, deps);
    expect(allowRead).toHaveBeenCalledWith("audit");
  });

  it("past the limit: reads nothing and says how long to wait (Ruling AL)", async () => {
    allowRead.mockResolvedValueOnce({ ok: false, retryAfterS: 12, limit: 60 });
    const state = await loadAudit({ service: "magpie" }, deps);
    expect(listAudit).not.toHaveBeenCalled();
    expect(state).toEqual({
      kind: "limited",
      retryAfterS: 12,
      limit: 60,
      query: { filters: { service: "magpie" }, before: null },
    });
  });

  it("refuses what it does not understand before reading anything", async () => {
    const state = await loadAudit({ sort: "asc", service: "nope" }, deps);
    expect(listAudit).not.toHaveBeenCalled();
    expect(allowRead).not.toHaveBeenCalled();
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
    const state = await loadAudit({ action: "gateway." }, deps);
    expect(state).toEqual({
      kind: "unavailable",
      query: { filters: { action: "gateway." }, before: null },
    });
    expect(console.error).toHaveBeenCalled();
  });
});
