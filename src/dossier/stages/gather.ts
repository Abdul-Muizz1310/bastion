import { magpie } from "@/capabilities/magpie";
import { callCapability } from "@/platform/gateway/call";
import type { Candidate } from "../select-evidence";
import type { StageContext, StageHandler } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `gather` (spec 21 §6.1): one magpie batch scrape over the dossier's sources, five items
 * each, mapped to web `Candidate`s. Skipped with no sources. Items with no url or no title can never
 * be cited, so they are dropped here, before they can reach the debate. The output is the
 * `Candidate[]` itself: Task 7's seal reads `ctx.outputs.gather`.
 */

export const MAX_ITEMS_PER_SOURCE = 5;

export type GatherDeps = { scrapeBatch: typeof callScrapeBatch };

function callScrapeBatch(ctx: StageContext) {
  return callCapability(
    magpie.scrapeBatch,
    { sources: ctx.dossier.sources, max_items_per_source: MAX_ITEMS_PER_SOURCE },
    callContext(ctx),
  );
}

export function gatherStage(deps: GatherDeps): StageHandler {
  return async (ctx) => {
    if (ctx.dossier.sources.length === 0) return { kind: "skipped", reason: "no_sources" };
    const result = await deps.scrapeBatch(ctx);
    if (!result.ok) return failure("magpie.scrapeBatch", result);
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    for (const run of result.data.runs) {
      for (const item of run.items) {
        const key = `w-${run.source}-${item.stable_id}`;
        if (item.url.trim() === "" || item.title.trim() === "" || seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          key,
          kind: "web",
          product: "magpie",
          title: item.title,
          url: item.url,
          text: item.content_text,
          locator: { kind: "url", url: item.url },
          magpieHash: item.content_hash,
        });
      }
    }
    if (candidates.length === 0 && result.data.failed.length > 0) {
      const first = result.data.failed[0];
      return { kind: "error", error: `scrape_failed:${first?.source ?? "?"}`, retryable: true };
    }
    return { kind: "ok", output: candidates };
  };
}

export const gather: StageHandler = gatherStage({ scrapeBatch: callScrapeBatch });
