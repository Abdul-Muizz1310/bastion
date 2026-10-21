import { describe, expect, it } from "vitest";
import { actorDisplay } from "@/features/audit/actor";

/** Spec 21 §3.2 invariant 2: an event's actor is written as its pseudonym, never as a v1 uuid. */

const V1_UUID = "550e8400-e29b-41d4-a716-446655440000";

describe("actorDisplay", () => {
  it("shows a visitor id as it is", () => {
    expect(actorDisplay({ actor: "v_kk6eooepno", actorId: null })).toEqual({
      kind: "visitor",
      label: "v_kk6eooepno",
    });
  });

  it("shows system work as bastion", () => {
    expect(actorDisplay({ actor: "bastion", actorId: null })).toEqual({
      kind: "system",
      label: "bastion",
    });
  });

  it("shows a v1 row (an actor_id, no actor) as 'v1 user', never the uuid", () => {
    const shown = actorDisplay({ actor: null, actorId: V1_UUID });
    expect(shown).toEqual({ kind: "v1-user", label: "v1 user" });
    expect(JSON.stringify(shown)).not.toContain("550e8400");
  });

  it("shows a row with neither as 'no actor'", () => {
    expect(actorDisplay({ actor: null, actorId: null })).toEqual({
      kind: "none",
      label: "no actor",
    });
  });

  it.each([
    ["an upper-case visitor id", "V_KK6EOOEPNO"],
    ["a visitor id that is too short", "v_kk6eooep"],
    ["a base32 digit out of range", "v_kk6eooepn1"],
    ["an email", "someone@example.com"],
    ["markup", "<script>alert(1)</script>"],
    ["an empty string", ""],
  ])("never echoes %s: it reads 'unrecognised actor'", (_what, actor) => {
    const shown = actorDisplay({ actor, actorId: null });
    expect(shown).toEqual({ kind: "unrecognised", label: "unrecognised actor" });
  });

  it("prefers the v2 actor when a row somehow carries both", () => {
    expect(actorDisplay({ actor: "bastion", actorId: V1_UUID }).kind).toBe("system");
  });
});
