import { describe, expect, it } from "vitest";
import { inkthread } from "@/capabilities/inkthread";
import { integer, pathSegment, pemBody, pngBody, withQuery } from "@/capabilities/shared";

/** The pure building blocks every capability module shares. */

describe("pathSegment — what an id interpolated into a path may hold", () => {
  it.each([["p:c95bca1f83faa250#obligation"], ["e:aea56d74c583fa06"], ["contract.pdf"], ["a.b"]])(
    "accepts %s",
    (id) => {
      expect(pathSegment.safeParse(id).success).toBe(true);
    },
  );

  it.each([[".."], ["../graph"], ["a/b"], ["a\\b"], ["x..y"], [""], ["a".repeat(257)]])(
    "refuses %j at the schema, before the gateway sees a path",
    (id) => {
      expect(pathSegment.safeParse(id).success).toBe(false);
    },
  );

  it("is what refuses a dot-dot element, naming the field", () => {
    const parsed = inkthread.why.input.safeParse({
      documentId: "d5152b39-8bbc-4141-ac06-9d5e70f98f99",
      element: "..",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.path).toStrictEqual(["element"]);
  });
});

describe("integer — from JSON or a query string", () => {
  const limit = integer(1, 100);

  it.each([
    [5, 5],
    ["5", 5],
    ["100", 100],
  ])("parses %j as %d", (raw, value) => {
    expect(limit.parse(raw)).toBe(value);
  });

  it.each([[0], ["0"], [101], ["2.5"], [2.5], ["1e2"], [""], [" 5"], [null], [true]])(
    "refuses %j",
    (raw) => {
      expect(limit.safeParse(raw).success).toBe(false);
    },
  );
});

describe("withQuery", () => {
  it("appends only the defined values, encoded, in order", () => {
    expect(withQuery("/x", { a: "1", b: undefined, c: "a b&c" })).toBe("/x?a=1&c=a+b%26c");
  });

  it("adds no ? when nothing is defined", () => {
    expect(withQuery("/x", { a: undefined })).toBe("/x");
  });
});

describe("raw bodies", () => {
  const raw = (contentType: string, text: string | number[]) => ({
    contentType,
    bytes: typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text),
  });

  it("accepts PNG bytes and refuses anything else", () => {
    expect(pngBody.safeParse(raw("image/png", [137, 80, 78, 71, 13, 10, 26, 10])).success).toBe(
      true,
    );
    expect(pngBody.safeParse(raw("image/png", [137, 80, 78])).success).toBe(false);
  });

  it("accepts one PEM public key and refuses a private key", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nMCow\n-----END PUBLIC KEY-----\n";
    expect(pemBody.safeParse(raw("text/plain", pem)).success).toBe(true);
    const secret = "-----BEGIN PRIVATE KEY-----\nMC4C\n-----END PRIVATE KEY-----\n";
    expect(pemBody.safeParse(raw("text/plain", secret)).success).toBe(false);
  });
});
