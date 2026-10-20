import { describe, expect, it, vi } from "vitest";
import { postVerify, verifyAnswer } from "@/features/dossier/verify-answer";
import { DOSSIER_ID } from "./fixtures";
import { verifiedLegacy, verifiedOk } from "./components/verify-fixtures";

/** Spec 21 §6.5–6.6: the browser parses the verify route's answer with its own schema, never casts. */

const okBody = () => {
  const o = verifiedOk();
  if (!o.ok) throw new Error("fixture");
  return o.data;
};

describe("verifyAnswer", () => {
  it("reads a v2 answer with every check and its items", () => {
    expect(verifyAnswer.parse(okBody())).toEqual(okBody());
  });

  it("reads a legacy answer: its note and no checks", () => {
    const o = verifiedLegacy();
    if (!o.ok) throw new Error("fixture");
    expect(verifyAnswer.parse(o.data)).toEqual(o.data);
  });

  it.each([
    ["an unknown check", { name: "vibes", state: "pass", detail: "" }],
    ["an unknown state", { name: "steps", state: "ok", detail: "" }],
    ["a missing detail", { name: "steps", state: "pass" }],
    ["an item with an unknown state", { name: "steps", state: "pass", detail: "", items: [{ ref: "x", state: "?", detail: "" }] }],
  ])("refuses %s", (_what, check) => {
    expect(verifyAnswer.safeParse({ ...okBody(), checks: [check] }).success).toBe(false);
  });

  it("refuses a legacy answer that carries checks, or no note", () => {
    expect(
      verifyAnswer.safeParse({ dossierId: DOSSIER_ID, legacy: true, note: "x", checks: okBody().checks }).success,
    ).toBe(false);
    expect(verifyAnswer.safeParse({ dossierId: DOSSIER_ID, legacy: true, checks: [] }).success).toBe(false);
  });
});

describe("postVerify", () => {
  it("POSTs JSON to the dossier's verify route and parses the answer", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(okBody(), { headers: { "x-request-id": "rid-verify" } }),
    );
    const out = await postVerify(DOSSIER_ID, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/dossiers/${DOSSIER_ID}/verify`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(out).toMatchObject({ ok: true, requestId: "rid-verify" });
  });

  it("names a 429 as rate limited with the wait", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "rate_limited", retryAfterS: 30, requestId: "rid" }, { status: 429 }),
    );
    expect(await postVerify(DOSSIER_ID, { fetchImpl })).toMatchObject({
      ok: false,
      kind: "rate_limited",
      retryAfterS: 30,
    });
  });

  it("refuses an id that is not a dossier id before sending anything", async () => {
    const fetchImpl = vi.fn();
    await expect(postVerify("../x", { fetchImpl })).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
