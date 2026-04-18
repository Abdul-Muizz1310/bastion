import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  it("returns ok status with service name and timestamp", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("bastion");
    expect(body.timestamp).toBeDefined();
    // timestamp should be a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
  });
});
