import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import { integer, isoDateTime, jsonObject, noInput, seg, uuid, withQuery } from "./shared";

/**
 * magpie (spec 21 §5): sources, their items, heal history, and synchronous scrapes. Response
 * schemas mirror magpie-backend's `SourceView`, `RunItemView` and `HealView` (`api/routers/viewer.py`,
 * `schemas/jobs.py`) and `ScrapeResult` / `ScrapeBatchResponse` (`schemas/scrape.py`).
 *
 * Ruling I: magpie answers 404 (unknown source) and 422 (body) before it fetches a page, so a 4xx
 * releases the `scrape` budget.
 */

const SCRAPE_TIMEOUT_MS = 90_000;

/** magpie's `SourceSlug`: 1–64 of `[a-z0-9-]`, so `/` and `..` cannot occur. */
export const sourceSlug = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, "must be 1–64 lower-case letters, digits or hyphens");

const sourceView = z.object({
  name: z.string(),
  description: z.string(),
  last_run_at: isoDateTime.nullable(),
  last_status: z.string().nullable(),
  item_count: z.number().int(),
  config_sha: z.string(),
});

const itemView = z.object({
  id: uuid,
  stable_id: z.string(),
  url: z.string(),
  title: z.string(),
  content_text: z.string(),
  content_hash: z.string(),
  first_seen_at: isoDateTime,
  last_seen_at: isoDateTime,
  html_snapshot_url: z.string().nullable(),
  data: jsonObject,
});

const healView = z.object({
  id: uuid,
  source: z.string(),
  run_id: uuid.nullable(),
  old_config: jsonObject,
  new_config: jsonObject,
  pr_url: z.string().nullable(),
  created_at: isoDateTime,
});

const scrapeItem = z.object({
  stable_id: z.string().min(1),
  url: z.string(),
  title: z.string(),
  content_text: z.string(),
  content_hash: z.string().min(1),
  fetched_at: isoDateTime,
  html_snapshot_url: z.string().nullable(),
});

const scrapeResult = z.object({
  source: sourceSlug,
  scraped_at: isoDateTime,
  run_id: uuid,
  items: z.array(scrapeItem),
});

const scrapeBatchResponse = z.object({
  runs: z.array(scrapeResult),
  failed: z.array(z.object({ source: z.string(), error: z.string() })),
});

export type MagpieSource = z.infer<typeof sourceView>;
export type MagpieItem = z.infer<typeof itemView>;
export type MagpieHeal = z.infer<typeof healView>;
export type ScrapeResult = z.infer<typeof scrapeResult>;
export type ScrapeBatch = z.infer<typeof scrapeBatchResponse>;

const maxItems = z.number().int().min(1).max(100);

const itemsInput = z.strictObject({
  name: sourceSlug,
  limit: integer(1, 200).optional(),
  offset: integer(0, 1_000_000).optional(),
});

const healsInput = z.strictObject({
  source: sourceSlug.optional(),
  limit: integer(1, 100).optional(),
  offset: integer(0, 1_000_000).optional(),
});

const scrapeInput = z.strictObject({ source: sourceSlug, max_items: maxItems.optional() });

const scrapeBatchInput = z.strictObject({
  sources: z
    .array(sourceSlug)
    .min(1)
    .max(10)
    .refine((s) => new Set(s).size === s.length, { message: "sources must not repeat" }),
  max_items_per_source: maxItems.optional(),
});

const sources: Capability<z.infer<typeof noInput>, MagpieSource[]> = {
  id: "magpie.sources",
  service: "magpie",
  method: "GET",
  path: () => "/sources",
  input: noInput,
  output: z.array(sourceView),
  grant: "viewer",
  cost: "free",
};

const items: Capability<z.infer<typeof itemsInput>, MagpieItem[]> = {
  id: "magpie.items",
  service: "magpie",
  method: "GET",
  path: (i) => withQuery(`/sources/${seg(i.name)}/items`, { limit: i.limit, offset: i.offset }),
  input: itemsInput,
  output: z.array(itemView),
  grant: "viewer",
  cost: "free",
};

const heals: Capability<z.infer<typeof healsInput>, MagpieHeal[]> = {
  id: "magpie.heals",
  service: "magpie",
  method: "GET",
  path: (i) => withQuery("/heals", { source: i.source, limit: i.limit, offset: i.offset }),
  input: healsInput,
  output: z.array(healView),
  grant: "viewer",
  cost: "free",
};

const scrape: Capability<z.infer<typeof scrapeInput>, ScrapeResult> = {
  id: "magpie.scrape",
  service: "magpie",
  method: "POST",
  path: (i) => `/api/scrape/${seg(i.source)}/once`,
  body: (i) => (i.max_items === undefined ? {} : { max_items: i.max_items }),
  input: scrapeInput,
  output: scrapeResult,
  grant: "editor",
  cost: "quota",
  budget: "scrape",
  timeoutMs: SCRAPE_TIMEOUT_MS,
};

const scrapeBatch: Capability<z.infer<typeof scrapeBatchInput>, ScrapeBatch> = {
  id: "magpie.scrapeBatch",
  service: "magpie",
  method: "POST",
  path: () => "/api/scrape/batch",
  body: (i) => i,
  input: scrapeBatchInput,
  output: scrapeBatchResponse,
  grant: "editor",
  cost: "quota",
  budget: "scrape",
  // Ruling L: magpie scrapes each source (and may heal each underflow), so each one is a unit.
  budgetUnits: (i) => i.sources.length,
  timeoutMs: SCRAPE_TIMEOUT_MS,
};

export const magpie = { sources, items, heals, scrape, scrapeBatch } as const;
