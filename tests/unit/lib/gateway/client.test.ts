import { beforeEach, describe, expect, it, vi } from "vitest";

const mockMintJwt = vi.fn();
const mockResolveService = vi.fn();
vi.mock("@/lib/gateway/jwt", () => ({
  mintPlatformJwt: (...args: unknown[]) => mockMintJwt(...args),
  resolveService: (...args: unknown[]) => mockResolveService(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { callService } from "@/lib/gateway/client";

const adminActor = { id: "u1", role: "admin" as const };

describe("19-client: callService success paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveService.mockReturnValue({
      id: "inkprint",
      backendUrl: "https://inkprint.example.com",
    });
    mockMintJwt.mockResolvedValue("signed.jwt.token");
  });

  it("case 1: 200 returns {ok:true, status, data}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ foo: "bar" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await callService("inkprint", "/verify/batch", {
      actor: adminActor,
      requestId: "req-1",
      body: { items: [] },
    });
    expect(result).toEqual({ ok: true, status: 200, data: { foo: "bar" } });
  });

  it("case 6: outgoing request has Authorization Bearer and X-Request-Id", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await callService("inkprint", "/anything", {
      actor: adminActor,
      requestId: "req-xyz",
    });
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://inkprint.example.com/anything");
    expect(init.headers.authorization).toBe("Bearer signed.jwt.token");
    expect(init.headers["x-request-id"]).toBe("req-xyz");
    expect(init.headers["x-platform-key-id"]).toBeTruthy();
  });

  it("body is JSON-stringified and content-type is set when body provided", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await callService("inkprint", "/x", {
      actor: adminActor,
      requestId: "r",
      body: { hello: "world" },
    });
    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ hello: "world" }));
    expect(init.headers["content-type"]).toBe("application/json");
  });

  it("method defaults to GET when no body, POST when body", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    await callService("inkprint", "/a", { actor: adminActor, requestId: "r" });
    expect(mockFetch.mock.calls[0][1].method).toBe("GET");
    await callService("inkprint", "/b", { actor: adminActor, requestId: "r", body: {} });
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
  });

  it("path without leading / is normalized", async () => {
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await callService("inkprint", "verify/batch", { actor: adminActor, requestId: "r" });
    expect(mockFetch.mock.calls[0][0]).toBe("https://inkprint.example.com/verify/batch");
  });
});

describe("19-client: callService failure paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveService.mockReturnValue({
      id: "inkprint",
      backendUrl: "https://inkprint.example.com",
    });
    mockMintJwt.mockResolvedValue("jwt");
  });

  it("case 2: 4xx returns {ok:false, status, error}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: "Unknown certificate: X" }), { status: 404 }),
    );
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("Unknown certificate: X");
    }
  });

  it("case 3: 5xx returns {ok:false, status:502, error:'bad_gateway'}", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 503 }));
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("bad_gateway");
    }
  });

  it("case 4: network error returns {ok:false, error:'network_error'}", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("network_error");
    }
  });

  it("case 5: AbortError returns {ok:false, error:'timeout'}", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(abortErr);
    const result = await callService("inkprint", "/x", {
      actor: adminActor,
      requestId: "r",
      timeoutMs: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("timeout");
    }
  });

  it("JWT mint failure returns {ok:false, error:'jwt_mint_failed'}", async () => {
    mockMintJwt.mockRejectedValueOnce(new Error("no key"));
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("jwt_mint_failed");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("case 7: unknown service throws (programmer error)", async () => {
    mockResolveService.mockImplementation(() => {
      throw new Error("Unknown service: fake");
    });
    await expect(
      callService("fake", "/x", { actor: adminActor, requestId: "r" }),
    ).rejects.toThrow("Unknown service");
  });

  it("invalid JSON response returns {ok:false, error:'invalid_response'}", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not json at all", { status: 200, headers: { "content-type": "text/html" } }),
    );
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_response");
    }
  });

  it("4xx with {error: ...} body uses that message", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid request" }), { status: 400 }),
    );
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Invalid request");
  });

  it("4xx with no error field falls back to generic downstream_N", async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ other: "x" }), { status: 418 }));
    const result = await callService("inkprint", "/x", { actor: adminActor, requestId: "r" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("downstream_418");
  });
});
