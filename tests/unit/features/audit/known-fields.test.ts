import { describe, expect, it } from "vitest";
import { knownFields, NO_FIELDS } from "@/features/audit/known-fields";

/**
 * Spec 21 §3.2 "What an event shows": only a few fields of an event's metadata are ever shown, each
 * checked for shape; the rest — which could carry what a downstream answered — is never read.
 */

describe("knownFields", () => {
  it("reads a gateway call's status, duration and error code", () => {
    expect(knownFields({ status: 502, ms: 312, ok: false, error: "downstream_error" })).toEqual({
      status: 502,
      ms: 312,
      stage: null,
      attempt: null,
      error: { kind: "code", code: "downstream_error" },
    });
  });

  it("reads a dossier stage event's stage and attempt", () => {
    expect(knownFields({ stage: "seal", attempt: 2 })).toEqual({
      ...NO_FIELDS,
      stage: "seal",
      attempt: 2,
    });
  });

  it("reads v1's latencyMs as the duration", () => {
    expect(knownFields({ status: 200, latencyMs: 42 })).toMatchObject({ status: 200, ms: 42 });
  });

  it("prefers ms over latencyMs when both are present", () => {
    expect(knownFields({ ms: 7, latencyMs: 42 }).ms).toBe(7);
  });

  it("reads v1's reason as the error when it is a code", () => {
    expect(knownFields({ reason: "rate_limited" }).error).toEqual({
      kind: "code",
      code: "rate_limited",
    });
  });

  it.each([
    ["a sentence", "connect ECONNREFUSED 10.0.0.4:5432"],
    ["a stack trace", "TypeError: x is undefined\n    at run (file.js:1:1)"],
    ["an upper-case word", "Timeout"],
    ["a code over 64 characters", `e${"x".repeat(64)}`],
    ["an object", { detail: "SELECT api_key FROM secrets" }],
    ["a number", 500],
  ])("withholds an error that is not a code (%s)", (_what, error) => {
    const fields = knownFields({ error });
    expect(fields.error).toEqual({ kind: "withheld" });
    expect(JSON.stringify(fields)).not.toMatch(/ECONNREFUSED|TypeError|api_key|Timeout/);
  });

  it.each([
    ["below 100", 99],
    ["above 599", 600],
    ["a fraction", 200.5],
    ["a string", "200"],
    ["NaN", Number.NaN],
  ])("drops a status %s", (_what, status) => {
    expect(knownFields({ status }).status).toBeNull();
  });

  it.each([
    ["negative", -1],
    ["infinite", Number.POSITIVE_INFINITY],
    ["a string", "12"],
  ])("drops a duration that is %s", (_what, ms) => {
    expect(knownFields({ ms }).ms).toBeNull();
  });

  it("keeps a fractional duration as it is (rounding is the page's job)", () => {
    expect(knownFields({ ms: 12.6 }).ms).toBe(12.6);
  });

  it.each([
    ["an unknown stage", { stage: "exfiltrate" }],
    ["a stage of the wrong type", { stage: 3 }],
  ])("drops %s", (_what, metadata) => {
    expect(knownFields(metadata).stage).toBeNull();
  });

  it.each([0, -1, 1.5, "2"])("drops an attempt of %s", (attempt) => {
    expect(knownFields({ attempt }).attempt).toBeNull();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an array", [1, 2]],
    ["a string", "not metadata"],
    ["an empty object", {}],
  ])("reads nothing from %s", (_what, metadata) => {
    expect(knownFields(metadata)).toEqual(NO_FIELDS);
  });

  it("never carries any other key, whatever the metadata holds", () => {
    const fields = knownFields({
      status: 200,
      body: { secret: "downstream answer" },
      claim: "a private claim",
      checks: { audit: "pass" },
    });
    expect(Object.keys(fields).sort()).toEqual(["attempt", "error", "ms", "stage", "status"]);
    expect(JSON.stringify(fields)).not.toMatch(/downstream answer|private claim|checks/);
  });
});
