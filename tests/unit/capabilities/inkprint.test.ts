import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inkprint } from "@/capabilities/inkprint";
import { budgetsLeft } from "@/platform/budget";
import {
  base,
  call,
  expectInvalidInput,
  expectMissingFieldRejected,
  expectParses,
  fetchMock,
  fixture,
  fixtureBytes,
  json,
  sent,
  stubGateway,
} from "./harness";

/**
 * inkprint through the gateway (spec 21 §5: certify, verify, diff, leak scan; §6: batch seal,
 * envelope, public key). Schemas mirror inkprint-backend's `CertificateResponse`/`CertificateDetail`,
 * the batch and envelope models, and the leak-scan job record.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const CERT = "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b";
const DOSSIER = "c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f";
const HASH = "a".repeat(64);
const created = fixture("inkprint", "certificate-create.json");
const detail = fixture("inkprint", "certificate.json");
const batch = fixture("inkprint", "certificates-batch.json");
// inkprint PR #16: when the batched embedding call fails (a free-tier Voyage 429) every item is
// still certified — hash and Ed25519 signature — with `embedding_id: null`.
const unembedded = fixture("inkprint", "certificates-batch-unembedded.json");
const verified = fixture("inkprint", "verify.json");
const verifiedBatch = fixture("inkprint", "verify-batch.json");
const diffed = fixture("inkprint", "diff.json");
const scan = fixture("inkprint", "leak-scan.json");
const scanStatus = fixture("inkprint", "leak-scan-status.json");
const envelope = fixture("inkprint", "envelope.json");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inkprint.certify", () => {
  const input = { text: "The quick brown fox.", author: "bastion", metadata: { source: "web" } };

  it("POSTs /certificates and parses the 201 certificate", async () => {
    await expectParses(inkprint.certify, input, created, 201);
    expect(sent()).toMatchObject({
      url: `${base("inkprint")}/certificates`,
      method: "POST",
      body: input,
    });
  });

  it("refuses a certificate without its signature", async () => {
    await expectMissingFieldRejected(inkprint.certify, input, created, ["signature"]);
  });

  it.each([
    ["empty text", { text: "", author: "a" }],
    ["whitespace-only text (it canonicalizes to zero bytes)", { text: " \n\t\u00a0", author: "a" }],
    ["a blank author", { text: "t", author: "  " }],
    ["text over 500 000 UTF-8 bytes", { text: "é".repeat(250_001), author: "a" }],
  ])("refuses %s", async (_label, bad) => {
    await expectInvalidInput(inkprint.certify, bad);
  });

  it("spends the certify budget", async () => {
    vi.stubEnv("BUDGET_CERTIFY", "0");
    expect(await call(inkprint.certify, input)).toMatchObject({ error: "budget_exhausted" });
  });
});

describe("inkprint.certifyBatch", () => {
  const item = { text: "evidence", author: "bastion", metadata: { dossier_id: DOSSIER, kind: "web" } };

  it("POSTs /certificates/batch and parses every certificate", async () => {
    const data = await expectParses(inkprint.certifyBatch, { items: [item, item] }, batch);
    expect(sent()).toMatchObject({
      url: `${base("inkprint")}/certificates/batch`,
      body: { items: [item, item] },
    });
    expect(data).toMatchObject({ certificates: [{ certificate_id: CERT }, {}] });
  });

  it("counts one certify unit per item (Ruling K)", async () => {
    // The in-process counter is shared by this file's tests: leave exactly 3 units for today.
    const { limit, left } = (await budgetsLeft()).certify;
    vi.stubEnv("BUDGET_CERTIFY", String(limit - left + 3));
    await expectParses(inkprint.certifyBatch, { items: [item, item] }, batch);
    expect(inkprint.certifyBatch.budgetUnits?.({ items: [item, item, item] })).toBe(3);
    const result = await call(inkprint.certifyBatch, { items: [item, item] });
    expect(result).toMatchObject({ ok: false, error: "budget_exhausted" });
    expect(await call(inkprint.certifyBatch, { items: [item] }, json(batch))).toMatchObject({
      ok: true,
    });
  });

  it("parses a batch whose embedding call failed: certified all the same, embedding_id null", async () => {
    const data = inkprint.certifyBatch.output.parse(
      await expectParses(inkprint.certifyBatch, { items: [item, item] }, unembedded),
    );
    expect(data.certificates.length).toBeGreaterThan(0);
    for (const c of data.certificates) expect(c.fingerprints.embedding_id).toBeNull();
  });

  it("still refuses an embedding_id that is neither a uuid nor null", async () => {
    const bad = structuredClone(batch) as { certificates: { fingerprints: Record<string, unknown> }[] };
    const first = bad.certificates[0];
    if (!first) throw new Error("fixture");
    first.fingerprints.embedding_id = "not-a-uuid";
    expect(await call(inkprint.certifyBatch, { items: [item] }, json(bad))).toMatchObject({
      ok: false,
      error: "invalid_response",
    });
  });

  it("refuses a certificate record without its fingerprints", async () => {
    await expectMissingFieldRejected(inkprint.certifyBatch, { items: [item] }, batch, [
      "certificates",
      0,
      "fingerprints",
    ]);
  });

  it.each([
    ["a number", { n: 1 }],
    ["a boolean", { ok: true }],
    ["null", { url: null }],
    ["a nested object", { locator: { page: 1 } }],
  ])("refuses metadata whose value is %s: every value is a string", async (_label, metadata) => {
    await expectInvalidInput(inkprint.certifyBatch, { items: [{ ...item, metadata }] });
  });

  it.each([
    ["no items", { items: [] }],
    ["51 items", { items: Array.from({ length: 51 }, () => item) }],
    ["whitespace-only text", { items: [{ ...item, text: "   " }] }],
    ["an empty author", { items: [{ ...item, author: "" }] }],
  ])("refuses %s", async (_label, bad) => {
    await expectInvalidInput(inkprint.certifyBatch, bad);
  });
});

describe("inkprint.certificate", () => {
  it("GETs /certificates/{id} with the stored text", async () => {
    const data = await expectParses(inkprint.certificate, { id: CERT }, detail);
    expect(sent().url).toBe(`${base("inkprint")}/certificates/${CERT}`);
    expect(data).toMatchObject({ id: CERT, text: "The quick brown fox jumps over the lazy dog." });
  });

  it("refuses a certificate without its text", async () => {
    await expectMissingFieldRejected(inkprint.certificate, { id: CERT }, detail, ["text"]);
  });

  it.each([["../public-key.pem"], ["a/b"], ["not-a-uuid"]])("refuses the id %s", async (id) => {
    await expectInvalidInput(inkprint.certificate, { id });
  });
});

describe("inkprint.verify and verifyBatch", () => {
  it("POSTs /verify with a manifest and text", async () => {
    const manifest = (detail as { manifest: Record<string, unknown> }).manifest;
    await expectParses(inkprint.verify, { manifest, text: "t" }, verified);
    expect(sent()).toMatchObject({ url: `${base("inkprint")}/verify`, body: { manifest, text: "t" } });
  });

  it("refuses an empty manifest", async () => {
    await expectInvalidInput(inkprint.verify, { manifest: {} });
  });

  it("refuses a verdict without its checks", async () => {
    await expectMissingFieldRejected(inkprint.verify, { manifest: { a: 1 } }, verified, ["checks"]);
  });

  it("POSTs /verify/batch and parses per-item verdicts, unknown certificates included", async () => {
    const items = [{ certificate_id: CERT, text: "t" }];
    const data = await expectParses(inkprint.verifyBatch, { items }, verifiedBatch);
    expect(sent()).toMatchObject({ url: `${base("inkprint")}/verify/batch`, body: { items } });
    expect(data).toMatchObject({ results: [{ valid: true }, { reason: "unknown_certificate" }] });
  });

  it("refuses a batch verdict without its validity", async () => {
    await expectMissingFieldRejected(
      inkprint.verifyBatch,
      { items: [{ certificate_id: CERT }] },
      verifiedBatch,
      ["results", 0, "valid"],
    );
  });

  it("refuses a batch item whose id is not a uuid", async () => {
    await expectInvalidInput(inkprint.verifyBatch, { items: [{ certificate_id: "../x" }] });
  });
});

describe("inkprint.diff", () => {
  it("POSTs /diff against a parent certificate", async () => {
    await expectParses(inkprint.diff, { parent_id: CERT, text: "changed" }, diffed);
    expect(sent()).toMatchObject({ url: `${base("inkprint")}/diff`, body: { parent_id: CERT } });
  });

  it("spends one certify unit: every diff buys an embedding (Ruling M)", async () => {
    const { limit, left } = (await budgetsLeft()).certify;
    vi.stubEnv("BUDGET_CERTIFY", String(limit - left + 1));
    await expectParses(inkprint.diff, { parent_id: CERT, text: "changed" }, diffed);
    expect((await budgetsLeft()).certify.left).toBe(0);
    const refused = await call(inkprint.diff, { parent_id: CERT, text: "again" });
    expect(refused).toMatchObject({ ok: false, error: "budget_exhausted", status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a diff without its verdict", async () => {
    await expectMissingFieldRejected(inkprint.diff, { parent_id: CERT, text: "x" }, diffed, [
      "verdict",
    ]);
  });
});

describe("inkprint.leakScan and leakScanStatus", () => {
  it("POSTs /leak-scan and parses the 202 job", async () => {
    await expectParses(
      inkprint.leakScan,
      { certificate_id: CERT, corpora: ["common_crawl"] },
      scan,
      202,
    );
    expect(sent()).toMatchObject({
      url: `${base("inkprint")}/leak-scan`,
      body: { certificate_id: CERT, corpora: ["common_crawl"] },
    });
  });

  it.each([
    ["an unknown corpus (inkprint would only fail it after the budget is spent)", ["github"]],
    ["no corpus", []],
    ["a repeated corpus", ["huggingface", "huggingface"]],
  ])("refuses %s", async (_label, corpora) => {
    await expectInvalidInput(inkprint.leakScan, { certificate_id: CERT, corpora });
  });

  it("spends the leak-scan budget", async () => {
    vi.stubEnv("BUDGET_LEAKSCAN", "0");
    expect(await call(inkprint.leakScan, { certificate_id: CERT })).toMatchObject({
      error: "budget_exhausted",
    });
  });

  it("GETs /leak-scan/{id} and parses per-corpus results", async () => {
    const id = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
    const data = await expectParses(inkprint.leakScanStatus, { id }, scanStatus);
    expect(sent().url).toBe(`${base("inkprint")}/leak-scan/${id}`);
    expect(data).toMatchObject({ status: "complete", results: [{ corpus: "common_crawl" }, {}, {}] });
  });

  it("refuses a scan status outside pending, running, complete and error", async () => {
    const id = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
    const result = await call(
      inkprint.leakScanStatus,
      { id },
      Response.json({ ...(scanStatus as object), status: "done" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });
});

describe("inkprint.envelope", () => {
  const input = {
    dossier_id: DOSSIER,
    evidence_cert_ids: [CERT],
    debate_transcript_hash: HASH,
    perf_receipt_hash: HASH,
    metadata: { request_id: "r-1", graph_hashes: "a,b" },
  };

  it("POSTs /dossiers/envelope and parses the signed envelope", async () => {
    await expectParses(inkprint.envelope, input, envelope);
    expect(sent()).toMatchObject({ url: `${base("inkprint")}/dossiers/envelope`, body: input });
  });

  it("refuses an envelope without its signature", async () => {
    await expectMissingFieldRejected(inkprint.envelope, input, envelope, ["envelope_signature"]);
  });

  it.each([
    ["a non-string metadata value", { ...input, metadata: { n: 3 } }],
    ["an upper-case hash", { ...input, perf_receipt_hash: "A".repeat(64) }],
    ["a short hash", { ...input, debate_transcript_hash: "ab" }],
    ["no evidence", { ...input, evidence_cert_ids: [] }],
  ])("refuses %s", async (_label, bad) => {
    await expectInvalidInput(inkprint.envelope, bad);
  });
});

describe("inkprint.publicKey and qr (raw)", () => {
  it("GETs /public-key.pem and passes the recorded PEM through", async () => {
    const pem = fixtureBytes("inkprint", "public-key.pem");
    const result = await call(
      inkprint.publicKey,
      {},
      new Response(pem, { headers: { "content-type": "text/plain; charset=utf-8" } }),
    );
    if (!result.ok) throw new Error(result.error);
    expect(sent().url).toBe(`${base("inkprint")}/public-key.pem`);
    expect(result.data).toMatchObject({ contentType: "text/plain; charset=utf-8" });
  });

  it("refuses text that is not a PEM public key", async () => {
    const result = await call(
      inkprint.publicKey,
      {},
      new Response("hello", { headers: { "content-type": "text/plain" } }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("GETs /certificates/{id}/qr as a PNG", async () => {
    const result = await call(
      inkprint.qr,
      { id: CERT },
      new Response(PNG, { headers: { "content-type": "image/png" } }),
    );
    expect(result.ok).toBe(true);
    expect(sent().url).toBe(`${base("inkprint")}/certificates/${CERT}/qr`);
  });

  it("refuses image/png bytes that are not a PNG", async () => {
    const result = await call(
      inkprint.qr,
      { id: CERT },
      new Response("GIF89a", { headers: { "content-type": "image/png" } }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });
});
