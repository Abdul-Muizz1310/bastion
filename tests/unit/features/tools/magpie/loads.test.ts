import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/tools/client", () => ({ callTool: vi.fn(async () => null) }));

import { magpie } from "@/capabilities/magpie";
import { callTool } from "@/features/tools/client";
import { ITEMS, loadsDue, type MagpieList, runDue, sourceReads } from "@/features/tools/magpie/loads";

/**
 * magpie's first loads (spec 21 §5.1, review rounds 3–4): when the gate opens, each list still due
 * loads on its own. A retry of the items or the heal history reloads that list and nothing else —
 * it never re-chooses the source, so the visitor's scrape stays on the page.
 */

const SOURCE = "hackernews";

type Call = (signal: AbortSignal) => Promise<unknown>;

function fakes() {
  return {
    items: { run: vi.fn(async (_call: Call) => null) },
    heals: { run: vi.fn(async (_call: Call) => null) },
    scrape: { set: vi.fn() },
  };
}

const dueOnly = (...lists: MagpieList[]) => vi.fn((list: MagpieList) => lists.includes(list));

beforeEach(() => vi.mocked(callTool).mockClear());

describe("loadsDue", () => {
  it("loads the sources first, without spending the lists' retries", () => {
    const due = dueOnly("sources", "items", "heals");
    expect(loadsDue(due, SOURCE)).toEqual([{ list: "sources" }]);
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("retries a failed items load alone", () => {
    expect(loadsDue(dueOnly("items"), SOURCE)).toEqual([{ list: "items", source: SOURCE }]);
  });

  it("retries a failed heal history alone", () => {
    expect(loadsDue(dueOnly("heals"), SOURCE)).toEqual([{ list: "heals", source: SOURCE }]);
  });

  it("loads both lists of the chosen source when both are due", () => {
    expect(loadsDue(dueOnly("items", "heals"), SOURCE)).toEqual([
      { list: "items", source: SOURCE },
      { list: "heals", source: SOURCE },
    ]);
  });

  it("loads no list before a source is chosen, and spends no retry on one", () => {
    const due = dueOnly("items", "heals");
    expect(loadsDue(due, null)).toEqual([]);
    expect(due).toHaveBeenCalledWith("sources");
    expect(due).toHaveBeenCalledTimes(1);
  });

  it("loads nothing when nothing is due", () => {
    expect(loadsDue(dueOnly(), SOURCE)).toEqual([]);
  });
});

describe("sourceReads", () => {
  it("reads one source's items alone, never touching the scrape", async () => {
    const a = fakes();
    sourceReads(a).items(SOURCE);
    expect(a.items.run).toHaveBeenCalledTimes(1);
    expect(a.heals.run).not.toHaveBeenCalled();
    expect(a.scrape.set).not.toHaveBeenCalled();
    const call = a.items.run.mock.calls[0]?.[0];
    const signal = new AbortController().signal;
    await call?.(signal);
    expect(callTool).toHaveBeenCalledWith(magpie.items, { name: SOURCE, limit: ITEMS }, { signal });
  });

  it("reads one source's heal history alone, never touching the scrape", async () => {
    const a = fakes();
    sourceReads(a).heals(SOURCE);
    expect(a.heals.run).toHaveBeenCalledTimes(1);
    expect(a.items.run).not.toHaveBeenCalled();
    expect(a.scrape.set).not.toHaveBeenCalled();
    const call = a.heals.run.mock.calls[0]?.[0];
    const signal = new AbortController().signal;
    await call?.(signal);
    expect(callTool).toHaveBeenCalledWith(magpie.heals, { source: SOURCE, limit: 10 }, { signal });
  });

  it("clears the last scrape and reads both lists when the visitor chooses a source", () => {
    const a = fakes();
    sourceReads(a).choose(SOURCE);
    expect(a.scrape.set).toHaveBeenCalledWith(null);
    expect(a.items.run).toHaveBeenCalledTimes(1);
    expect(a.heals.run).toHaveBeenCalledTimes(1);
  });
});

describe("the gate reopening with a failed items load (the composed retry)", () => {
  it("reloads the items and keeps the visitor's scrape (review round 4)", () => {
    const a = fakes();
    const loadSources = vi.fn();
    runDue(dueOnly("items"), SOURCE, { sources: loadSources, reads: sourceReads(a) });
    expect(a.items.run).toHaveBeenCalledTimes(1);
    expect(a.heals.run).not.toHaveBeenCalled();
    expect(loadSources).not.toHaveBeenCalled();
    expect(a.scrape.set).not.toHaveBeenCalled();
  });

  it("loads the sources when they are what failed, and no list with them", () => {
    const a = fakes();
    const loadSources = vi.fn();
    runDue(dueOnly("sources", "items"), SOURCE, { sources: loadSources, reads: sourceReads(a) });
    expect(loadSources).toHaveBeenCalledTimes(1);
    expect(a.items.run).not.toHaveBeenCalled();
    expect(a.scrape.set).not.toHaveBeenCalled();
  });
});
