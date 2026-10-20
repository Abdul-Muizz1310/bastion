import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listDocuments, saveDocumentFacts } from "@/dossier/documents";
import { getDb } from "@/lib/db/client";
import { dossierDocuments, dossiers } from "@/lib/db/schema";

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

    await saveDocumentFacts(id, "a-doc", { sha256: "s".repeat(64), graphHash: "g".repeat(64), pageCount: 15 });
    const [a, b] = await listDocuments(id);
    expect(a).toMatchObject({ sha256: "s".repeat(64), graphHash: "g".repeat(64), pageCount: 15 });
    expect(b?.sha256).toBeNull();
    expect(await listDocuments(randomUUID())).toEqual([]);
  });
});
