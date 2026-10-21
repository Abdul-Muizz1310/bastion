import { describe, expect, it, vi } from "vitest";
import { documentVisibility, fetchPlatformStatus } from "@/features/health/client";
import { StatusParseError } from "@/features/health/model";

/** The browser edge of the health poll: one GET, parsed (never cast), and the tab's visibility. */

const AT = "2026-10-20T10:00:00.000Z";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchPlatformStatus", () => {
  it("asks the status route, uncached, with the caller's abort signal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response(200, {
        services: [{ service: "magpie", state: "live", latencyMs: 90, checkedAt: AT }],
        timestamp: AT,
      }),
    );
    const signal = new AbortController().signal;
    const snapshot = await fetchPlatformStatus(signal, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/platform/status", {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    expect(snapshot).toMatchObject({ phase: "ok", services: { magpie: { state: "live" } } });
  });

  it("throws on a non-2xx answer", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(503, { error: "x" }));
    await expect(fetchPlatformStatus(new AbortController().signal, fetchImpl)).rejects.toThrow(
      /503/,
    );
  });

  it("throws on a body that is not the status shape", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { services: "all good" }));
    await expect(fetchPlatformStatus(new AbortController().signal, fetchImpl)).rejects.toThrow(
      StatusParseError,
    );
  });
});

describe("documentVisibility", () => {
  function fakeDocument(state: "visible" | "hidden") {
    const target = new EventTarget() as EventTarget & { visibilityState: string };
    target.visibilityState = state;
    return target;
  }

  it("reads the document's visibility state", () => {
    const doc = fakeDocument("hidden");
    const v = documentVisibility(doc as unknown as Document);
    expect(v.isHidden()).toBe(true);
    doc.visibilityState = "visible";
    expect(v.isHidden()).toBe(false);
  });

  it("calls the listener only when the document becomes visible, until unsubscribed", () => {
    const doc = fakeDocument("hidden");
    const v = documentVisibility(doc as unknown as Document);
    const listener = vi.fn();
    const off = v.onVisible(listener);

    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
