import { describe, expect, it, vi } from "vitest";
import { magpie } from "@/capabilities/magpie";
import { gatherStage } from "@/dossier/stages/gather";
import { failure } from "@/dossier/stages/shared";
import type { GatewayResult } from "@/platform/gateway/result";
import { dossier, fixture, stageCtx } from "./helpers";

type Batch = ReturnType<typeof magpie.scrapeBatch.output.parse>;

const batch = (): Batch => magpie.scrapeBatch.output.parse(fixture("magpie", "scrape-batch.json"));
const ok = (data: Batch): GatewayResult<Batch> => ({
  ok: true,
  data,
  status: 200,
  requestId: "r",
  ms: 1,
});

describe("gather stage", () => {
  it("is skipped with no sources, without calling magpie", async () => {
    const scrapeBatch = vi.fn();
    const out = await gatherStage({ scrapeBatch })(stageCtx());
    expect(out).toEqual({ kind: "skipped", reason: "no_sources" });
    expect(scrapeBatch).not.toHaveBeenCalled();
  });

  it("maps magpie items to web candidates", async () => {
    const data = batch();
    const out = await gatherStage({ scrapeBatch: async () => ok(data) })(
      stageCtx({ dossier: dossier({ sources: ["hackernews", "lobsters"] }) }),
    );
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const list = out.output as unknown as Array<Record<string, unknown>>;
    const total = data.runs.reduce((n, r) => n + r.items.length, 0);
    expect(list).toHaveLength(total);
    const first = data.runs[0]?.items[0];
    expect(list[0]).toEqual({
      key: `w-${data.runs[0]?.source}-${first?.stable_id}`,
      kind: "web",
      product: "magpie",
      title: first?.title,
      url: first?.url,
      text: first?.content_text,
      locator: { kind: "url", url: first?.url },
      magpieHash: first?.content_hash,
    });
    expect(new Set(list.map((c) => c.key)).size).toBe(total);
  });

  it("drops items with an empty url or title before they reach the debate", async () => {
    const data = batch();
    const items = data.runs[0]?.items ?? [];
    if (items[0]) items[0].url = " ";
    if (items[1]) items[1].title = "";
    const out = await gatherStage({ scrapeBatch: async () => ok(data) })(
      stageCtx({ dossier: dossier({ sources: ["hackernews"] }) }),
    );
    if (out.kind !== "ok") throw new Error("expected ok");
    const keys = (out.output as unknown as Array<{ key: string }>).map((c) => c.key);
    expect(keys).not.toContain(`w-hackernews-${items[0]?.stable_id}`);
    expect(keys).not.toContain(`w-hackernews-${items[1]?.stable_id}`);
  });

  it("asks for 5 items per source with the dossier's sources", async () => {
    const scrapeBatch = vi.fn(async () => ok(batch()));
    await gatherStage({ scrapeBatch })(stageCtx({ dossier: dossier({ sources: ["hackernews"] }) }));
    expect(scrapeBatch).toHaveBeenCalledOnce();
  });

  it("errors retryably when every source failed", async () => {
    const out = await gatherStage({
      scrapeBatch: async () => ok({ runs: [], failed: [{ source: "hn", error: "x" }] }),
    })(stageCtx({ dossier: dossier({ sources: ["hn"] }) }));
    expect(out).toEqual({ kind: "error", error: "scrape_failed:hn", retryable: true });
  });

  it("is ok with an empty list when nothing was found and nothing failed", async () => {
    const out = await gatherStage({ scrapeBatch: async () => ok({ runs: [], failed: [] }) })(
      stageCtx({ dossier: dossier({ sources: ["hn"] }) }),
    );
    expect(out).toEqual({ kind: "ok", output: [] });
  });

  it("maps a gateway failure to an error outcome", async () => {
    const out = await gatherStage({
      scrapeBatch: async () => ({ ok: false, error: "asleep", status: 504, requestId: "r" }),
    })(stageCtx({ dossier: dossier({ sources: ["hn"] }) }));
    expect(out).toEqual({
      kind: "error",
      error: "magpie.scrapeBatch: asleep",
      retryable: true,
    });
  });
});

describe("failure", () => {
  const base = { ok: false, status: 502, requestId: "r" } as const;
  it.each([
    [{ ...base, error: "rate_limited" }, true],
    [{ ...base, error: "downstream_error", status: 502 }, true],
    [{ ...base, error: "downstream_error", status: 404 }, false],
    [{ ...base, error: "budget_exhausted" }, false],
    [{ ...base, error: "invalid_input" }, false],
    [{ ...base, error: "invalid_response", detail: "nodes.0: invalid_type" }, false],
  ] as const)("%j retryable=%s", (f, expected) => {
    expect(failure("x", f).retryable).toBe(expected);
  });
  it("carries the detail", () => {
    expect(
      failure("inkthread.graph", {
        ok: false,
        error: "invalid_response",
        status: 502,
        requestId: "r",
        detail: "nodes.0: invalid_type",
      }).error,
    ).toBe("inkthread.graph: invalid_response (nodes.0: invalid_type)");
  });
});
