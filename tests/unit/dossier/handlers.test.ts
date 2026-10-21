import { describe, expect, it } from "vitest";
import { HANDLERS } from "@/dossier/handlers";
import { STAGES } from "@/dossier/stages";

/**
 * The default stage handler map the advance route runs: one real handler per stage (Tasks 6–8).
 */

describe("HANDLERS", () => {
  it("has exactly one handler per stage", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...STAGES].sort());
  });

  it("wires the real handler of every stage (no stub is left)", async () => {
    const real = {
      wake: (await import("@/dossier/stages/wake")).wake,
      gather: (await import("@/dossier/stages/gather")).gather,
      read: (await import("@/dossier/stages/read")).read,
      seal: (await import("@/dossier/stages/seal")).seal,
      debate: (await import("@/dossier/stages/debate")).debate,
      measure: (await import("@/dossier/stages/measure")).measure,
      envelope: (await import("@/dossier/stages/envelope")).envelope,
      record: (await import("@/dossier/stages/record")).record,
    };
    for (const stage of STAGES) expect(HANDLERS[stage]).toBe(real[stage]);
  });
});
