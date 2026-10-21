import { describe, expect, it, vi } from "vitest";
import { createCatalog } from "@/dossier/catalog";

/** Spec 21 §3: the source and sample lists are cached for 5 minutes in-process; failures are not. */

describe("createCatalog", () => {
  it("fetches once within the TTL and again after it", async () => {
    let t = 0;
    const load = vi.fn().mockResolvedValue(["a", "b"]);
    const c = createCatalog(load, { ttlMs: 300_000, now: () => t });
    expect(await c.get()).toEqual(new Set(["a", "b"]));
    t = 299_999;
    await c.get();
    expect(load).toHaveBeenCalledTimes(1);
    t = 300_000;
    await c.get();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("answers null on failure and does not cache it", async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(["a"]);
    const c = createCatalog(load, { ttlMs: 1000, now: () => 0 });
    expect(await c.get()).toBeNull();
    expect(await c.get()).toEqual(new Set(["a"]));
  });

  it("shares one in-flight load between concurrent callers", async () => {
    const load = vi.fn().mockResolvedValue(["a"]);
    const c = createCatalog(load, { ttlMs: 1000, now: () => 0 });
    await Promise.all([c.get(), c.get()]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("the default catalogs", () => {
  it("read magpie's source names and inkthread's sample ids as the system actor", async () => {
    vi.resetModules();
    const callCapability = vi.fn(async (cap: { id: string }, _input: unknown, _ctx: unknown) =>
      cap.id === "magpie.sources"
        ? { ok: true, data: [{ name: "hn" }, { name: "arxiv" }] }
        : { ok: true, data: { items: [{ id: "doc-1" }] } },
    );
    vi.doMock("@/platform/gateway/call", () => ({ callCapability }));
    const { knownSources, knownSamples } = await import("@/dossier/catalog");
    expect(await knownSources.get()).toEqual(new Set(["hn", "arxiv"]));
    expect(await knownSamples.get()).toEqual(new Set(["doc-1"]));
    expect(callCapability.mock.calls[0]?.[2]).toMatchObject({ actor: "bastion" });
    vi.doUnmock("@/platform/gateway/call");
  });

  it("are null when the product answers with a refusal", async () => {
    vi.resetModules();
    vi.doMock("@/platform/gateway/call", () => ({
      callCapability: vi.fn(async () => ({ ok: false, error: "asleep", status: 504 })),
    }));
    const { knownSources, knownSamples } = await import("@/dossier/catalog");
    expect(await knownSources.get()).toBeNull();
    expect(await knownSamples.get()).toBeNull();
    vi.doUnmock("@/platform/gateway/call");
  });
});
