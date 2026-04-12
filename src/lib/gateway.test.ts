import { describe, expect, it } from "vitest";
import { parseRequestId, resolveService } from "./gateway";

describe("09-gateway: service resolution", () => {
  it("resolveService returns correct backend URL for known service", () => {
    const result = resolveService("paper-trail");
    expect(result.backendUrl).toBe("https://paper-trail-backend.onrender.com");
  });

  it("resolveService throws for unknown service ID", () => {
    expect(() => resolveService("nonexistent")).toThrow(/unknown service/i);
  });

  it("resolveService throws for feathers (no backend URL)", () => {
    expect(() => resolveService("feathers")).toThrow(/no backend url/i);
  });

  it("gateway rejects proxy to arbitrary URLs", () => {
    expect(() => resolveService("evil-service")).toThrow();
  });
});

describe("09-gateway: request ID", () => {
  it("parseRequestId generates UUID when none present", () => {
    const id = parseRequestId(undefined);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("parseRequestId propagates existing X-Request-Id", () => {
    const existing = "abc-123-def-456";
    const id = parseRequestId(existing);
    expect(id).toBe(existing);
  });
});

describe("09-gateway: JWT minting", () => {
  it.todo("mintPlatformJwt returns a valid JWT string (needs BASTION_SIGNING_KEY_PRIVATE)");
  it.todo("JWT contains sub, role, service, kid, exp within 60s of iat (needs signing key)");
  it.todo("JWT is verifiable using the public key (needs signing key)");
});

describe("09-gateway: proxy behavior", () => {
  it.todo("proxy returns downstream response status and headers (integration)");
  it.todo("proxy call is logged as gateway.proxy audit event (integration)");
  it.todo("downstream 500 results in 502 from gateway (integration)");
  it.todo("downstream timeout results in 504 from gateway (integration)");
  it.todo("unauthenticated proxy request is rejected (integration)");
  it.todo("/api/public-key returns base64 SPKI public key (integration)");
  it.todo("proxy does not log request or response body (structural)");
});
