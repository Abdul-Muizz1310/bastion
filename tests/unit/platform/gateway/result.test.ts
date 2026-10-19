import { describe, expect, it } from "vitest";
import { GATEWAY_ERROR_STATUS, RAW_CONTENT_TYPES, rawBodySchema } from "@/platform/gateway/result";

/** The typed result union every gateway call returns (spec 21 §4). */

describe("GATEWAY_ERROR_STATUS", () => {
  it("maps every error kind to the HTTP status bastion answers with", () => {
    expect(GATEWAY_ERROR_STATUS).toStrictEqual({
      asleep: 504,
      rate_limited: 429,
      budget_exhausted: 429,
      downstream_error: 502,
      invalid_response: 502,
      invalid_input: 422,
    });
  });
});

describe("raw bodies", () => {
  it("accepts a content type and bytes", () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);
    expect(rawBodySchema.parse({ contentType: "image/png", bytes })).toStrictEqual({
      contentType: "image/png",
      bytes,
    });
  });

  it("refuses a JSON-shaped body pretending to be bytes", () => {
    expect(rawBodySchema.safeParse({ contentType: "image/png", bytes: [1, 2] }).success).toBe(false);
  });

  it("knows which content types each raw kind accepts", () => {
    expect(RAW_CONTENT_TYPES.png).toStrictEqual(["image/png"]);
    expect(RAW_CONTENT_TYPES.zip).toContain("application/zip");
    expect(RAW_CONTENT_TYPES.pem).toStrictEqual(["text/plain", "application/x-pem-file"]);
  });
});
