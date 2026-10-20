import { describe, expect, it } from "vitest";
import { HANDLERS } from "@/dossier/handlers";
import { STAGES } from "@/dossier/stages";
import type { Dossier } from "@/lib/db/schema";

/**
 * The default stage handler map the advance route runs. Task 5 ships every stage as a stub; Tasks
 * 6–8 replace them one by one. A stub must fail the dossier loudly (non-retryable), never pretend.
 */

const dossier: Dossier = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  userId: null,
  visitor: "v_kk6eooepno",
  claim: "c",
  sources: [],
  mode: "rapid",
  status: "running",
  verdict: null,
  confidence: null,
  requestId: "r",
  envelopeId: null,
  error: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe("HANDLERS", () => {
  it("has exactly one handler per stage", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual([...STAGES].sort());
  });

  it("wires the real wake, gather and read stages", async () => {
    const { gather } = await import("@/dossier/stages/gather");
    const { read } = await import("@/dossier/stages/read");
    const { wake } = await import("@/dossier/stages/wake");
    expect(HANDLERS.wake).toBe(wake);
    expect(HANDLERS.gather).toBe(gather);
    expect(HANDLERS.read).toBe(read);
  });

  it.each(STAGES.filter((s) => !["wake", "gather", "read"].includes(s)))(
    "%s is a stub that fails non-retryably as not_implemented",
    async (stage) => {
      const outcome = await HANDLERS[stage]({
        dossier,
        requestId: "r",
        outputs: {},
        now: new Date(),
        signal: new AbortController().signal,
      });
      expect(outcome).toEqual({ kind: "error", error: "not_implemented", retryable: false });
    },
  );
});
