import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { summarize } from "@/dossier/step-summary";
import { initialSteps, STAGES, type Stage } from "@/dossier/stages";
import { loadStepSummaries } from "@/dossier/store";
import { getDb } from "@/lib/db/client";
import { dossierSteps, dossiers } from "@/lib/db/schema";
import type { Json } from "@/platform/canonical-json";

/**
 * Spec 21 §6.6, "The live run", against Postgres: the stream reads each step's scalar columns and a
 * few small projections of its output, never the output itself, and those projections agree with
 * the pure `summarize` row for row — whatever shape the output has. Local, disposable databases
 * only (it commits a dossier, deleted afterwards).
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(DATABASE_URL);
const id = randomUUID();

const OUTPUTS: Record<Stage, Json> = {
  wake: { live: ["inkprint", "paper-trail"], asleep: ["magpie", 7] },
  gather: Array.from({ length: 3 }, (_, i) => ({ key: `w-${i}`, text: "x".repeat(200_000) })),
  read: { docs: { a: [] } },
  seal: { certified: 4, total: "5" },
  debate: { debateId: "889d7f2b-33c0-432a-b956-8a360f7b9497", verdict: "TRUE", confidence: 0.82, failedDebateIds: [] },
  measure: { perfReceiptHash: "", auditUpTo: 3 },
  envelope: { reason: "no_certificates" },
  record: "a bare string",
};

describe.skipIf(!LOCAL)("loadStepSummaries (local Postgres)", () => {
  afterAll(async () => {
    await getDb().delete(dossiers).where(eq(dossiers.id, id));
  });

  it("projects exactly what summarize reads, and nothing of the output", async () => {
    await getDb().insert(dossiers).values({
      id,
      visitor: "v_kk6eooepno",
      claim: "integration: the stream reads summaries",
      sources: [],
      mode: "rapid",
      status: "running",
      requestId: `it-summaries-${id}`,
    });
    await getDb()
      .insert(dossierSteps)
      .values(initialSteps(id, new Date()).map((s) => ({ ...s, output: OUTPUTS[s.stage] })));

    const rows = await loadStepSummaries(id);
    expect(rows.map((r) => r.stage).sort()).toEqual([...STAGES].sort());
    for (const row of rows) {
      expect(row.summary, row.stage).toEqual(summarize(OUTPUTS[row.stage]));
      expect(row).not.toHaveProperty("output");
    }
    expect(JSON.stringify(rows).length).toBeLessThan(10_000);
  });

  it("answers no rows for an id that is not a dossier id", async () => {
    expect(await loadStepSummaries("not-a-uuid")).toEqual([]);
  });
});
