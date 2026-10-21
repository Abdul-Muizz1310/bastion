import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { inkthread } from "@/capabilities/inkthread";
import { listDocuments, saveDocumentFacts } from "@/dossier/documents";
import { readStage } from "@/dossier/stages/read";
import { receiptView } from "@/features/dossier/receipt-view";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossiers } from "@/lib/db/schema";
import type { GatewayResult } from "@/platform/gateway/result";

/** The `read` stage's document adapter against a real Postgres (local, disposable server only). */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const id = randomUUID();

afterAll(async () => {
  if (LOCAL) await getDb().delete(dossiers).where(eq(dossiers.id, id));
});

describe.skipIf(!LOCAL)("dossier documents against Postgres", () => {
  it("lists a dossier's documents in a stable order and records what read learned", async () => {
    const db = getDb();
    await db.insert(dossiers).values({
      id,
      visitor: "v_kk6eooepno",
      claim: "documents adapter",
      sources: [],
      mode: "rapid",
      status: "pending",
      requestId: `it-docs-${id}`,
    });
    await db.insert(dossierDocuments).values([
      { dossierId: id, documentId: "b-doc", kind: "upload", jobId: "j" },
      { dossierId: id, documentId: "a-doc", kind: "sample" },
    ]);
    expect((await listDocuments(id)).map((d) => d.documentId)).toEqual(["a-doc", "b-doc"]);

    await saveDocumentFacts(id, "a-doc", {
      sha256: "s".repeat(64),
      graphHash: "g".repeat(64),
      pageCount: 15,
      title: "Fee schedule",
    });
    const [a, b] = await listDocuments(id);
    expect(a).toMatchObject({
      sha256: "s".repeat(64),
      graphHash: "g".repeat(64),
      pageCount: 15,
      title: "Fee schedule",
    });
    expect(b?.title).toBeNull();
    expect(b?.sha256).toBeNull();
    expect(await listDocuments(randomUUID())).toEqual([]);
  });
});

describe.skipIf(!LOCAL)("the read stage names each document on the receipt (seam a)", () => {
  const dossierId = randomUUID();
  const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
  const fixtures = resolve(__dirname, "../../fixtures/downstream/inkthread");
  const read = (name: string): unknown => JSON.parse(readFileSync(resolve(fixtures, name), "utf8"));
  const ok = <T>(data: T): GatewayResult<T> => ({ ok: true, data, status: 200, requestId: "r", ms: 1 });

  afterAll(async () => {
    if (LOCAL) await getDb().delete(dossiers).where(eq(dossiers.id, dossierId));
  });

  it("writes the graph's title through the real adapters, and the receipt shows it instead of the id", async () => {
    const db = getDb();
    await db.insert(dossiers).values({
      id: dossierId,
      visitor: "v_kk6eooepno",
      claim: "small entity fees are reduced",
      sources: [],
      mode: "rapid",
      status: "running",
      requestId: `it-docs-title-${dossierId}`,
    });
    await db.insert(dossierDocuments).values({ dossierId, documentId: DOC, kind: "sample" });
    const graph = inkthread.graph.output.parse(read("graph.json"));
    const stage = readStage(
      {
        documents: listDocuments,
        save: saveDocumentFacts,
        job: async () => {
          throw new Error("a sample has no job");
        },
        graph: async () => ok(graph),
        reading: async () => ok(inkthread.reading.output.parse(read("reading.json"))),
      },
      "https://bastion.test",
    );
    const [row] = await db.select().from(dossiers).where(eq(dossiers.id, dossierId));
    if (row === undefined) throw new Error("the dossier was not written");
    const out = await stage({
      dossier: row,
      requestId: row.requestId,
      outputs: {},
      now: new Date(),
      attempt: 1,
      startedAt: new Date(),
      signal: new AbortController().signal,
    });
    expect(out.kind).toBe("ok");

    const documents = await listDocuments(dossierId);
    expect(documents).toEqual([
      expect.objectContaining({
        documentId: DOC,
        title: "uspto-fee-schedule.pdf",
        sha256: graph.document.sha256,
        graphHash: graph.provenance.graph_hash,
        pageCount: graph.document.page_count,
      }),
    ]);
    const view = receiptView({ dossier: row, evidence: [], documents, receipts: [] });
    expect(view.documents[0]?.title).toBe("uspto-fee-schedule.pdf");
  });
});
