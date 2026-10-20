import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { type CreateDeps, createBodySchema, createDossier } from "@/dossier/create";
import { listPublicDossiers } from "@/dossier/gallery";
import { STAGES } from "@/dossier/stages";
import { budgetsLeft } from "@/platform/budget";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossierSteps, dossiers, evidenceItems, events } from "@/lib/db/schema";
import type { VisitorId } from "@/platform/visitor";

/**
 * Spec 21 §3, §6.3 — composing a dossier against a real Postgres: the dossier, its 8 steps and its
 * documents land in one transaction (a forced failure leaves nothing and gives the budget back), and
 * the gallery shows public fields only. Commits rows (deleted afterwards) and audit events, so it
 * runs only against a local, disposable server, like the runner suite.
 */

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(DATABASE_URL);

const VISITOR = "v_kk6eooepno" as VisitorId;
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const created: string[] = [];

const deps: Partial<CreateDeps> = {
  knownSources: async () => new Set(["hn"]),
  knownSamples: async () => new Set([DOC]),
};
const withTracking = (): Partial<CreateDeps> => ({
  ...deps,
  newId: () => {
    const id = randomUUID();
    created.push(id);
    return id;
  },
});
const full = (over: Partial<CreateDeps> = {}) => {
  // Real store, real budget, real audit: only the catalog and the id are injected.
  return { ...deps, ...withTracking(), ...over } as CreateDeps;
};

async function realDeps(over: Partial<CreateDeps> = {}): Promise<CreateDeps> {
  const [{ reserveBudget, releaseBudget }, { appendEvent }, { insertDossier }] = await Promise.all([
    import("@/platform/budget"),
    import("@/platform/audit/write"),
    import("@/dossier/store"),
  ]);
  return {
    ...full(),
    reserve: reserveBudget,
    release: releaseBudget,
    insert: insertDossier,
    audit: appendEvent,
    now: () => new Date(),
    ...over,
  };
}

afterAll(async () => {
  if (LOCAL && created.length > 0) {
    await getDb().delete(dossiers).where(inArray(dossiers.id, created));
  }
});

describe.skipIf(!LOCAL)("createDossier (Postgres)", () => {
  it("writes the dossier, 8 steps and its documents, and audits it", async () => {
    const requestId = `it-create-${randomUUID()}`;
    const input = createBodySchema.parse({
      claim: "integration: composing is atomic",
      sources: ["hn"],
      documents: [
        { document_id: DOC, kind: "sample" },
        { document_id: randomUUID(), kind: "upload", job_id: randomUUID() },
      ],
      mode: "rapid",
    });
    const r = await createDossier(input, { visitor: VISITOR, requestId }, await realDeps());
    expect(r.ok).toBe(true);
    const id = r.ok ? r.dossierId : "";

    const [row] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(row).toMatchObject({ visitor: VISITOR, status: "pending", mode: "rapid", requestId });
    const steps = await getDb().select().from(dossierSteps).where(eq(dossierSteps.dossierId, id));
    expect(steps.map((s) => s.stage).sort()).toEqual([...STAGES].sort());
    expect(steps.every((s) => s.status === "pending" && s.attempt === 0)).toBe(true);
    const docs = await getDb()
      .select()
      .from(dossierDocuments)
      .where(eq(dossierDocuments.dossierId, id));
    expect(docs).toHaveLength(2);
    expect(docs.find((d) => d.kind === "sample")?.jobId).toBeNull();
    const audit = await getDb().select().from(events).where(eq(events.requestId, requestId));
    expect(audit.map((e) => e.action)).toEqual(["dossier.created"]);
    expect(audit[0]).toMatchObject({ actor: VISITOR, metadata: { sources: 1, documents: 2, mode: "rapid" } });
  });

  it("is atomic: a failure mid-transaction leaves no rows and releases the budget", async () => {
    const before = (await budgetsLeft()).debate.left;
    const id = randomUUID();
    created.push(id);
    const input = createBodySchema.parse({
      claim: "integration: a failed write leaves nothing",
      sources: [],
      documents: [{ document_id: randomUUID(), kind: "upload", job_id: randomUUID() }],
    });
    // A NUL byte in a text column is refused by Postgres only when the documents insert runs,
    // after the dossier and its steps were written inside the same transaction.
    const poisoned = { ...input, documents: [{ ...input.documents[0]!, job_id: "bad\u0000job" }] };
    await expect(
      createDossier(
        poisoned,
        { visitor: VISITOR, requestId: `it-create-${id}` },
        await realDeps({ newId: () => id }),
      ),
    ).rejects.toThrow();

    expect(await getDb().select().from(dossiers).where(eq(dossiers.id, id))).toHaveLength(0);
    expect(await getDb().select().from(dossierSteps).where(eq(dossierSteps.dossierId, id))).toHaveLength(0);
    expect(await getDb().select().from(dossierDocuments).where(eq(dossierDocuments.dossierId, id))).toHaveLength(0);
    expect((await budgetsLeft()).debate.left).toBe(before);
  });

  it("lists public gallery fields only, newest first, with counts and products", async () => {
    const mk = async (claim: string) => {
      const r = await createDossier(
        createBodySchema.parse({ claim, sources: ["hn"], documents: [{ document_id: DOC, kind: "sample" }] }),
        { visitor: VISITOR, requestId: `it-gallery-${randomUUID()}` },
        await realDeps(),
      );
      return r.ok ? r.dossierId : "";
    };
    const first = await mk("integration: gallery older");
    const second = await mk("integration: gallery newer");
    await getDb()
      .insert(evidenceItems)
      .values([
        { dossierId: second, source: "hn", stableId: "a", contentHash: "h", product: "magpie" },
        { dossierId: second, source: "hn", stableId: "b", contentHash: "h", product: "inkthread" },
        { dossierId: second, source: "hn", stableId: "c", contentHash: "h", product: "magpie" },
      ]);

    const list = await listPublicDossiers(12);
    expect(list.length).toBeLessThanOrEqual(12);
    const ids = list.map((d) => d.id);
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first));
    const item = list.find((d) => d.id === second);
    expect(item).toMatchObject({
      claim: "integration: gallery newer",
      mode: "standard",
      status: "pending",
      verdict: null,
      confidence: null,
      evidenceCount: 3,
      documentCount: 1,
      products: ["inkthread", "magpie"],
    });
    expect(Object.keys(item ?? {}).sort()).toEqual(
      ["claim", "confidence", "createdAt", "documentCount", "evidenceCount", "id", "mode", "products", "status", "verdict"].sort(),
    );
  });
});
