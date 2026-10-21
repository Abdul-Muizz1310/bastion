import { describe, expect, it } from "vitest";
import { publicDossierError, publicStepError } from "@/dossier/public-error";

/**
 * Spec 21 §6.6 (review round 1): bastion's own internal errors (`stage_threw`, `invalid_outcome`)
 * carry an exception's message — it can name hosts, SQL or secrets — so every public surface
 * publishes only their bare code. A step's error and the dossier's `<stage>: <error>` alike.
 */

const SQL = "stage_threw: syntax error at or near \"FROM\" in SELECT password_hash FROM users WHERE id = 7";

describe("publicStepError", () => {
  it.each([
    [SQL, "stage_threw"],
    ["stage_threw", "stage_threw"],
    ["invalid_outcome: retryInMs must be a whole number of ms in 0..270000", "invalid_outcome"],
  ])("reduces %s to its bare code", (raw, code) => {
    expect(publicStepError(raw)).toBe(code);
  });

  it.each([
    "inkprint.certifyBatch: downstream_error (422)",
    "stage_timeout: exceeded 240000 ms",
    "service_asleep:magpie",
    "stage_thrower: not ours",
  ])("keeps %s as recorded", (error) => {
    expect(publicStepError(error)).toBe(error);
  });

  it("passes no error through as none", () => {
    expect(publicStepError(null)).toBeNull();
  });
});

describe("publicDossierError", () => {
  it("reduces the stage's internal error and keeps the stage", () => {
    expect(publicDossierError(`debate: ${SQL}`)).toBe("debate: stage_threw");
    expect(publicDossierError("seal: invalid_outcome: x")).toBe("seal: invalid_outcome");
  });

  it("keeps any other dossier error as recorded, and none as none", () => {
    expect(publicDossierError("debate: paper-trail.debate: budget_exhausted")).toBe(
      "debate: paper-trail.debate: budget_exhausted",
    );
    expect(publicDossierError("something without a stage")).toBe("something without a stage");
    expect(publicDossierError(null)).toBeNull();
  });
});
