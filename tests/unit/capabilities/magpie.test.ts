import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { magpie } from "@/capabilities/magpie";
import { budgetsLeft } from "@/platform/budget";
import {
  base,
  call,
  expectInvalidInput,
  expectMissingFieldRejected,
  expectParses,
  fetchMock,
  fixture,
  json,
  sent,
  stubGateway,
} from "./harness";

/**
 * magpie through the gateway (spec 21 §5: pick a source, scrape once, browse items, heal history).
 * Response schemas mirror magpie-backend's `SourceView`, `RunItemView`, `HealView`, `ScrapeResult`
 * and `ScrapeBatchResponse`; the fixtures are built from them and its router tests.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const sources = fixture("magpie", "sources.json");
const items = fixture("magpie", "items.json");
const heals = fixture("magpie", "heals.json");
const once = fixture("magpie", "scrape-once.json");
const batch = fixture("magpie", "scrape-batch.json");

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("magpie.sources", () => {
  it("GETs /sources and parses every recorded source", async () => {
    const data = await expectParses(magpie.sources, {}, sources);
    expect(sent()).toMatchObject({ url: `${base("magpie")}/sources`, method: "GET" });
    expect(data).toHaveLength(3);
  });

  it("refuses a source without its name", async () => {
    await expectMissingFieldRejected(magpie.sources, {}, sources, [0, "name"]);
  });

  it("takes no input", async () => {
    await expectInvalidInput(magpie.sources, { origin: "api" });
  });
});

describe("magpie.items", () => {
  it("GETs /sources/{name}/items with the paging it was given", async () => {
    await expectParses(magpie.items, { name: "hackernews", limit: "5", offset: 10 }, items);
    expect(sent().url).toBe(`${base("magpie")}/sources/hackernews/items?limit=5&offset=10`);
  });

  it("sends no query string without paging", async () => {
    await expectParses(magpie.items, { name: "arxiv-cs" }, items);
    expect(sent().url).toBe(`${base("magpie")}/sources/arxiv-cs/items`);
  });

  it("refuses an item without its content hash", async () => {
    await expectMissingFieldRejected(magpie.items, { name: "hackernews" }, items, [
      0,
      "content_hash",
    ]);
  });

  it.each([
    ["a dot-dot name", ".."],
    ["a slash", "hacker/news"],
    ["an encoded slash", "hacker%2Fnews"],
    ["upper case", "HackerNews"],
    ["an empty name", ""],
    ["a name over 64 characters", "a".repeat(65)],
  ])("refuses %s at the input schema", async (_label, name) => {
    await expectInvalidInput(magpie.items, { name });
  });

  it.each([
    ["a limit of 0", { limit: 0 }],
    ["a limit over 200", { limit: 201 }],
    ["a negative offset", { offset: -1 }],
    ["a fractional limit", { limit: "2.5" }],
  ])("refuses %s", async (_label, paging) => {
    await expectInvalidInput(magpie.items, { name: "hackernews", ...paging });
  });
});

describe("magpie.heals", () => {
  it("GETs /heals, optionally for one source", async () => {
    await expectParses(magpie.heals, { source: "hackernews", limit: 5 }, heals);
    expect(sent().url).toBe(`${base("magpie")}/heals?source=hackernews&limit=5`);
  });

  it("keeps the PR link a heal opened, and none for a direct patch", async () => {
    const data = (await expectParses(magpie.heals, {}, heals)) as { pr_url: string | null }[];
    expect(data.map((h) => h.pr_url)).toStrictEqual(["https://github.com/owner/repo/pull/1", null]);
    expect(sent().url).toBe(`${base("magpie")}/heals`);
  });

  it("refuses a heal without its id", async () => {
    await expectMissingFieldRejected(magpie.heals, {}, heals, [0, "id"]);
  });
});

describe("magpie.scrape", () => {
  it("POSTs /api/scrape/{source}/once with max_items", async () => {
    await expectParses(magpie.scrape, { source: "hackernews", max_items: 5 }, once);
    expect(sent()).toMatchObject({
      url: `${base("magpie")}/api/scrape/hackernews/once`,
      method: "POST",
      body: { max_items: 5 },
    });
  });

  it("sends an empty body to take magpie's default", async () => {
    await expectParses(magpie.scrape, { source: "hackernews" }, once);
    expect(sent().body).toStrictEqual({});
  });

  it("refuses an item without its content hash", async () => {
    await expectMissingFieldRejected(magpie.scrape, { source: "hackernews" }, once, [
      "items",
      0,
      "content_hash",
    ]);
  });

  it.each([
    ["a dot-dot source", { source: ".." }],
    ["a slash", { source: "a/b" }],
    ["max_items 0", { source: "hackernews", max_items: 0 }],
    ["max_items 101", { source: "hackernews", max_items: 101 }],
  ])("refuses %s", async (_label, input) => {
    await expectInvalidInput(magpie.scrape, input);
  });

  it("spends one scrape from the daily budget", async () => {
    vi.stubEnv("BUDGET_SCRAPE", "0");
    expect(await call(magpie.scrape, { source: "hackernews" })).toMatchObject({
      ok: false,
      error: "budget_exhausted",
    });
  });
});

describe("magpie.scrapeBatch", () => {
  it("POSTs /api/scrape/batch and parses runs and failures", async () => {
    const data = await expectParses(
      magpie.scrapeBatch,
      { sources: ["hackernews", "lobsters", "arxiv-cs"], max_items_per_source: 5 },
      batch,
    );
    expect(sent()).toMatchObject({
      url: `${base("magpie")}/api/scrape/batch`,
      method: "POST",
      body: { sources: ["hackernews", "lobsters", "arxiv-cs"], max_items_per_source: 5 },
    });
    expect(data).toMatchObject({ failed: [{ source: "arxiv-cs" }] });
  });

  describe("spends one scrape unit per source (Ruling L)", () => {
    const three = { sources: ["hackernews", "lobsters", "arxiv-cs"] };
    const scrapeLeft = async () => (await budgetsLeft()).scrape.left;
    /** The in-process counter is shared by this file's tests: leave exactly `n` units for today. */
    const leave = async (n: number) => {
      const { limit, left } = (await budgetsLeft()).scrape;
      vi.stubEnv("BUDGET_SCRAPE", String(limit - left + n));
    };

    it("counts the sources", () => {
      expect(magpie.scrapeBatch.budgetUnits?.(three)).toBe(3);
    });

    it("reserves 3 units for 3 sources", async () => {
      await leave(5);
      await expectParses(magpie.scrapeBatch, three, batch);
      expect(await scrapeLeft()).toBe(2);
    });

    it("gives all 3 back on a 4xx", async () => {
      await leave(5);
      const result = await call(
        magpie.scrapeBatch,
        three,
        json({ detail: "sources must not contain duplicates" }, 422),
      );
      expect(result).toMatchObject({ ok: false, error: "downstream_error", status: 422 });
      expect(await scrapeLeft()).toBe(5);
    });

    it("refuses a batch larger than what is left, without fetching or reserving any", async () => {
      await leave(2);
      const result = await call(magpie.scrapeBatch, three);
      expect(result).toMatchObject({ ok: false, error: "budget_exhausted", status: 429 });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await scrapeLeft()).toBe(2);
    });
  });

  it("refuses a batch answer without its failures list", async () => {
    await expectMissingFieldRejected(magpie.scrapeBatch, { sources: ["hackernews"] }, batch, [
      "failed",
    ]);
  });

  it.each([
    ["no sources", { sources: [] }],
    ["eleven sources", { sources: Array.from({ length: 11 }, (_, i) => `s${i}`) }],
    ["a repeated source", { sources: ["hackernews", "hackernews"] }],
    ["a dot-dot source", { sources: [".."] }],
  ])("refuses %s", async (_label, input) => {
    await expectInvalidInput(magpie.scrapeBatch, input);
  });

  it("answers a scrape that magpie rejects as the backend's own reason", async () => {
    const result = await call(
      magpie.scrapeBatch,
      { sources: ["hackernews"] },
      json({ detail: "sources must not contain duplicates" }, 422),
    );
    expect(result).toMatchObject({ ok: false, error: "downstream_error", status: 422 });
  });
});
