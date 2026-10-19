import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyProbe, probe } from "@/platform/registry/health";

describe("classifyProbe", () => {
  it.each([200, 204, 299])("maps %i to live", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("live");
  });
  it.each([500, 502, 503, 599])("maps %i to down", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("down");
  });
  it.each([301, 401, 404])("maps non-2xx %i to down", (status) => {
    expect(classifyProbe({ kind: "response", status, body: null, ms: 5 })).toBe("down");
  });
  it("maps a timeout to asleep", () => {
    expect(classifyProbe({ kind: "timeout", ms: 8000 })).toBe("asleep");
  });
  it("maps a network error to down", () => {
    expect(classifyProbe({ kind: "network_error", ms: 3 })).toBe("down");
  });
});

describe("probe", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports live with version and commit from /version", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).endsWith("/version")
        ? Response.json({ version: "1.2.3", commit_sha: "abc123" })
        : Response.json({ status: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const h = await probe("magpie", 1000);
    expect(h).toMatchObject({
      service: "magpie",
      state: "live",
      version: "1.2.3",
      commitSha: "abc123",
    });
    expect(Number.isNaN(Date.parse(h.checkedAt))).toBe(false);
  });

  it("stays live when /version is malformed", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      String(url).endsWith("/version") ? new Response("nope") : Response.json({}),
    );
    const h = await probe("magpie", 1000);
    expect(h.state).toBe("live");
    expect(h.version).toBeUndefined();
  });

  it("reports down on a 503", async () => {
    vi.stubGlobal("fetch", async () => new Response("x", { status: 503 }));
    expect((await probe("inkprint", 1000)).state).toBe("down");
  });

  it("reports asleep when the probe times out", async () => {
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      return new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () =>
          rej(new DOMException("timed out", "TimeoutError")),
        );
      });
    });
    expect((await probe("inkprint", 20)).state).toBe("asleep");
  });

  it("reports down on a network error", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    expect((await probe("inkprint", 1000)).state).toBe("down");
  });
});
