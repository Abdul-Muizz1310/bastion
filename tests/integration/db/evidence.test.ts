import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { listEvidence, listSealed, type SealedRecord, saveSealed } from "@/dossier/evidence";
import { recordTranscript } from "@/dossier/receipts";
import type { Candidate } from "@/dossier/select-evidence";
import { getDb } from "@/lib/db/client";
import { dossiers, receipts } from "@/lib/db/schema";

/** Sealed evidence and the transcript receipt against a real Postgres (local, disposable server only). */

const LOCAL = /@(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const id = randomUUID();

const candidate = (key: string, text = "x".repeat(900)): Candidate => ({
  key,
  kind: "web",
  product: "magpie",
  title: `title ${key}`,
  url: `https://example.org/${key}`,
  text,
  locator: { kind: "url", url: `https://example.org/${key}` },
});
const record = (key: string): SealedRecord => ({
  candidate: candidate(key),
  certificateId: randomUUID(),
  contentHash: "a".repeat(64),
  inkprintHash: "c".repeat(64),
  signature: "sig",
  text: candidate(key).text,
});

afterAll(async () => {
  if (LOCAL) await getDb().delete(dossiers).where(eq(dossiers.id, id));
});

describe.skipIf(!LOCAL)("sealed evidence against Postgres", () => {
  it("stores one row and one receipt per certificate, and a replay adds nothing", async () => {
    await getDb().insert(dossiers).values({
      id,
      visitor: "v_kk6eooepno",
      claim: "c",
      sources: [],
      mode: "rapid",
      status: "pending",
      requestId: `it-evidence-${id}`,
    });
    const a = record("w-a");
    const b = record("w-b");
    expect(await saveSealed(id, [])).toBe(0);
    expect(await saveSealed(id, [a, b])).toBe(2);
    expect(await saveSealed(id, [{ ...a, certificateId: randomUUID() }, record("w-c")])).toBe(1);

    const rows = await listEvidence(id);
    expect(rows.map((r) => r.stableId)).toEqual(["w-a", "w-b", "w-c"]);
    expect(rows[0]).toMatchObject({
      certificateId: a.certificateId,
      contentHash: "a".repeat(64),
      inkprintHash: "c".repeat(64),
      kind: "web",
      product: "magpie",
      locator: { kind: "url", url: "https://example.org/w-a" },
    });
    expect(rows[0]?.excerpt).toHaveLength(400);

    const stored = await getDb().select().from(receipts).where(eq(receipts.dossierId, id));
    expect(stored).toHaveLength(3);
    const forA = stored.find((r) => r.ref === a.certificateId);
    expect(forA).toMatchObject({ kind: "certificate", hash: "c".repeat(64), signature: "sig" });
    expect((forA?.payload as { text: string }).text).toHaveLength(900);

    const sealed = await listSealed(id);
    expect(sealed).toHaveLength(3);
    expect(sealed[0]).toMatchObject({ certificateId: a.certificateId, title: "title w-a", key: "w-a" });
    expect(sealed[0]?.text).toHaveLength(900);
  });

  it("refuses records that share a key, before writing anything", async () => {
    const before = await listEvidence(id);
    const d = record("w-d");
    await expect(saveSealed(id, [d, { ...d, certificateId: randomUUID() }])).rejects.toThrow(RangeError);
    expect(await listEvidence(id)).toEqual(before);
  });

  it("falls back to the excerpt when a certificate receipt is missing", async () => {
    await getDb().delete(receipts).where(eq(receipts.dossierId, id));
    const sealed = await listSealed(id);
    expect(sealed[0]?.text).toHaveLength(400);
  });

  it("records the transcript once and the verdict every time", async () => {
    const debateId = randomUUID();
    const t = {
      debateId,
      transcriptHash: "b".repeat(64),
      signature: "tsig",
      payload: { debate_id: debateId, rounds: [] },
      verdict: "TRUE" as const,
      confidence: 0.8,
    };
    expect(await recordTranscript(id, t)).toEqual({ ok: true });
    expect(await recordTranscript(id, { ...t, verdict: "FALSE", confidence: 0.55 })).toEqual({ ok: true });
    const rows = (await getDb().select().from(receipts).where(eq(receipts.dossierId, id))).filter(
      (r) => r.kind === "transcript",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ref: debateId, hash: t.transcriptHash, signature: "tsig" });
    const [d] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(d).toMatchObject({ verdict: "FALSE", confidence: "0.55" });
  });

  it("refuses a transcript that names another debate and writes nothing", async () => {
    const debateId = randomUUID();
    const other = randomUUID();
    const before = await getDb().select().from(receipts).where(eq(receipts.dossierId, id));
    const [dBefore] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    const saved = await recordTranscript(id, {
      debateId,
      transcriptHash: "d".repeat(64),
      signature: null,
      payload: { debate_id: other },
      verdict: "TRUE",
      confidence: 0.99,
    });
    expect(saved).toEqual({ ok: false, error: `transcript_mismatch: expected ${debateId}, got ${other}` });
    expect(await getDb().select().from(receipts).where(eq(receipts.dossierId, id))).toEqual(before);
    const [dAfter] = await getDb().select().from(dossiers).where(eq(dossiers.id, id));
    expect(dAfter?.verdict).toBe(dBefore?.verdict);
  });
});
