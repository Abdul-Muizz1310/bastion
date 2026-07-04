import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCsrfToken, postWithCsrf } from "@/lib/csrf-client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("csrf-client: fetchCsrfToken", () => {
  it("returns the token from /api/csrf", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: "tok-abc" }) });
    vi.stubGlobal("fetch", mockFetch);

    const token = await fetchCsrfToken();
    expect(token).toBe("tok-abc");
    expect(mockFetch).toHaveBeenCalledWith("/api/csrf", expect.objectContaining({ method: "GET" }));
  });

  it("throws when /api/csrf is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchCsrfToken()).rejects.toThrow(/CSRF token/i);
  });

  it("throws when the response has no string token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: 42 }) }),
    );
    await expect(fetchCsrfToken()).rejects.toThrow(/Malformed/i);
  });
});

describe("csrf-client: postWithCsrf", () => {
  it("fetches a token then POSTs it in the x-csrf-token header", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ token: "tok-xyz" }) })
      .mockResolvedValueOnce({ ok: true, status: 202 });
    vi.stubGlobal("fetch", mockFetch);

    const res = await postWithCsrf("/api/dossiers", { claim: "hi" });
    expect((res as { status: number }).status).toBe(202);

    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("/api/dossiers");
    expect(init.method).toBe("POST");
    expect(init.headers["x-csrf-token"]).toBe("tok-xyz");
    expect(JSON.parse(init.body)).toEqual({ claim: "hi" });
  });
});
