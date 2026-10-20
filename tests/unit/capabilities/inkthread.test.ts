import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inkthread } from "@/capabilities/inkthread";
import {
  base,
  call,
  expectInvalidInput,
  expectMissingFieldRejected,
  expectParses,
  fixture,
  sent,
  stubGateway,
} from "./harness";

/**
 * inkthread through the gateway (spec 21 §5: samples, the graph, the why of an element, the page
 * with its boxes; §9: inkgrid's reading, interface I-3). The sample fixtures were recorded live
 * from inkthread-backend (the graph and reading trimmed to a few nodes and tables); the schemas
 * mirror its `DocumentOut`, `JobOut`, `Graph`, `ReadingOut`, `Why` and `UploadOut`.
 */

const { appendEvent } = vi.hoisted(() => ({ appendEvent: vi.fn() }));
vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({ check: async () => ({ success: true, limit: 30, remaining: 29 }) }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));

const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";
const JOB = "49932edf-fd77-44b0-8ac2-b69933f8d536";
const samples = fixture("inkthread", "samples.json");
const document = fixture("inkthread", "document.json");
const graph = fixture("inkthread", "graph.json");
const reading = fixture("inkthread", "reading.json");
const whyRole = fixture("inkthread", "why-role.json");
const whyNode = fixture("inkthread", "why-node.json");
const job = fixture("inkthread", "job.json");
const upload = fixture("inkthread", "upload.json");
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const pdf = (bytes = 64) => new Blob([new Uint8Array(bytes).fill(32)], { type: "application/pdf" });

beforeEach(() => {
  stubGateway();
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("inkthread.samples and document", () => {
  it("GETs /samples and parses the recorded samples", async () => {
    const data = (await expectParses(inkthread.samples, {}, samples)) as { items: unknown[] };
    expect(sent().url).toBe(`${base("inkthread")}/samples`);
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items[0]).toMatchObject({ id: DOC, kind: "sample", status: "ready" });
  });

  it("refuses a sample without its sha256", async () => {
    await expectMissingFieldRejected(inkthread.samples, {}, samples, ["items", 0, "sha256"]);
  });

  it("GETs /documents/{id}", async () => {
    await expectParses(inkthread.document, { documentId: DOC }, document);
    expect(sent().url).toBe(`${base("inkthread")}/documents/${DOC}`);
  });

  it("refuses a document status outside queued, processing, ready and failed", async () => {
    const result = await call(
      inkthread.document,
      { documentId: DOC },
      Response.json({ ...(document as object), status: "expired" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it.each([["../samples"], ["a/b"], ["not-a-uuid"]])("refuses the document id %s", async (id) => {
    await expectInvalidInput(inkthread.document, { documentId: id });
  });
});

describe("inkthread.graph", () => {
  it("GETs /documents/{id}/graph and parses the recorded graph", async () => {
    const data = (await expectParses(inkthread.graph, { documentId: DOC }, graph)) as {
      schema: string;
      nodes: { id: string; roles: { role: string }[] }[];
      provenance: { graph_hash: string };
    };
    expect(sent().url).toBe(`${base("inkthread")}/documents/${DOC}/graph`);
    expect(data.schema).toBe("inkthread.graph/1");
    expect(data.provenance.graph_hash).toMatch(/^[0-9a-f]{64}$/);
    const paragraph = data.nodes.find((n) => n.id === "p:c95bca1f83faa250");
    expect(paragraph?.roles.map((r) => r.role)).toContain("obligation");
  });

  it("refuses a graph without its graph hash", async () => {
    await expectMissingFieldRejected(inkthread.graph, { documentId: DOC }, graph, [
      "provenance",
      "graph_hash",
    ]);
  });

  it("refuses a node without its regions list's page", async () => {
    await expectMissingFieldRejected(inkthread.graph, { documentId: DOC }, graph, [
      "nodes",
      2,
      "regions",
      0,
      "page",
    ]);
  });

  it("refuses another graph schema version", async () => {
    const result = await call(
      inkthread.graph,
      { documentId: DOC },
      Response.json({ ...(graph as object), schema: "inkthread.graph/2" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("refuses an edge of an unknown thread type", async () => {
    const bad = structuredClone(graph) as { edges: { type: string }[] };
    if (bad.edges[0]) bad.edges[0].type = "likes";
    const result = await call(inkthread.graph, { documentId: DOC }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });
});

describe("inkthread.reading (interface I-3)", () => {
  it("GETs /documents/{id}/reading and parses inkgrid's tables and verification", async () => {
    const data = (await expectParses(inkthread.reading, { documentId: DOC }, reading)) as {
      schema: string;
      verification: { ok: boolean; disagreements: number };
      tables: { header_rows: number; rows: string[][]; markdown: string }[];
    };
    expect(sent().url).toBe(`${base("inkthread")}/documents/${DOC}/reading`);
    expect(data.schema).toBe("inkthread.reading/1");
    expect(data.tables[0]?.header_rows).toBe(2);
    expect(data.tables[0]?.markdown.length).toBeGreaterThan(0);
  });

  it("refuses a table without its rows", async () => {
    await expectMissingFieldRejected(inkthread.reading, { documentId: DOC }, reading, [
      "tables",
      0,
      "rows",
    ]);
  });

  it("refuses a verification summary whose disagreements do not match its defects", async () => {
    const bad = structuredClone(reading) as { verification: { disagreements: number } };
    bad.verification.disagreements += 1;
    const result = await call(inkthread.reading, { documentId: DOC }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("refuses a verification that claims ok with defects listed", async () => {
    const bad = structuredClone(reading) as { verification: { ok: boolean } };
    bad.verification.ok = true;
    const result = await call(inkthread.reading, { documentId: DOC }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("refuses a table with more header rows than rows (it could not be drawn)", async () => {
    const bad = structuredClone(reading) as { tables: { header_rows: number; rows: unknown[] }[] };
    const first = bad.tables[0];
    if (!first) throw new Error("the fixture has a table");
    first.header_rows = first.rows.length + 1;
    const result = await call(inkthread.reading, { documentId: DOC }, Response.json(bad));
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("accepts a table that is all header rows", async () => {
    const edge = structuredClone(reading) as { tables: { header_rows: number; rows: unknown[] }[] };
    const first = edge.tables[0];
    if (!first) throw new Error("the fixture has a table");
    first.header_rows = first.rows.length;
    const result = await call(inkthread.reading, { documentId: DOC }, Response.json(edge));
    expect(result.ok).toBe(true);
  });

  it("refuses a doc_sha256 that is not 64 hex characters", async () => {
    const result = await call(
      inkthread.reading,
      { documentId: DOC },
      Response.json({ ...(reading as object), doc_sha256: "abc" }),
    );
    expect(result).toMatchObject({ ok: false, error: "invalid_response" });
  });

  it("reports graph_not_ready (409) as the downstream's own answer", async () => {
    const result = await call(
      inkthread.reading,
      { documentId: DOC },
      Response.json({ error: "graph_not_ready", message: "Not yet.", detail: null }, { status: 409 }),
    );
    expect(result).toMatchObject({ ok: false, error: "downstream_error", status: 409 });
  });
});

describe("inkthread.why", () => {
  it("encodes the element id — a role key has a colon and a hash", async () => {
    await expectParses(
      inkthread.why,
      { documentId: DOC, element: "p:c95bca1f83faa250#obligation" },
      whyRole,
    );
    expect(sent().url).toBe(
      `${base("inkthread")}/documents/${DOC}/why/p%3Ac95bca1f83faa250%23obligation`,
    );
  });

  it("parses the why of a node (no evidence span)", async () => {
    expect(
      await expectParses(inkthread.why, { documentId: DOC, element: "p:c95bca1f83faa250" }, whyNode),
    ).toMatchObject({ kind: "node", evidence: null });
  });

  it("refuses an answer without its maker", async () => {
    await expectMissingFieldRejected(
      inkthread.why,
      { documentId: DOC, element: "p:c95bca1f83faa250" },
      whyNode,
      ["maker"],
    );
  });

  it.each([
    ["a dot-dot element", ".."],
    ["a parent path", "../graph"],
    ["a slash", "p:1/x"],
    ["a backslash", "p:1\\x"],
    ["an empty element", ""],
  ])("refuses %s at the input schema", async (_label, element) => {
    await expectInvalidInput(inkthread.why, { documentId: DOC, element });
  });
});

describe("inkthread.job and page", () => {
  it("GETs /jobs/{id}", async () => {
    expect(await expectParses(inkthread.job, { jobId: JOB }, job)).toMatchObject({
      status: "succeeded",
    });
    expect(sent().url).toBe(`${base("inkthread")}/jobs/${JOB}`);
  });

  it("refuses a job without its status", async () => {
    await expectMissingFieldRejected(inkthread.job, { jobId: JOB }, job, ["status"]);
  });

  it("GETs /documents/{id}/pages/{n}.png as a PNG (pages count from 1)", async () => {
    const result = await call(
      inkthread.page,
      { documentId: DOC, page: "3" },
      new Response(PNG, { headers: { "content-type": "image/png" } }),
    );
    expect(result.ok).toBe(true);
    expect(sent().url).toBe(`${base("inkthread")}/documents/${DOC}/pages/3.png`);
  });

  it.each([["0"], [0], ["-1"], ["1.5"], ["100001"]])("refuses the page %j", async (page) => {
    await expectInvalidInput(inkthread.page, { documentId: DOC, page });
  });
});

describe("inkthread.upload", () => {
  it("POSTs /documents as multipart with the file field", async () => {
    const file = pdf();
    const data = await expectParses(inkthread.upload, { file, fileName: "contract.pdf" }, upload, 202);
    const request = sent();
    expect(request.url).toBe(`${base("inkthread")}/documents`);
    expect(request.body).toBeInstanceOf(FormData);
    const sentFile = (request.body as FormData).get("file") as File;
    expect(sentFile.name).toBe("contract.pdf");
    expect(sentFile.size).toBe(file.size);
    expect(data).toMatchObject({ deduplicated: false, job: { status: "queued" } });
  });

  it("refuses an upload answer without its document", async () => {
    await expectMissingFieldRejected(
      inkthread.upload,
      { file: pdf(), fileName: "a.pdf" },
      upload,
      ["document"],
    );
  });

  it.each([
    ["an empty file", () => ({ file: pdf(0), fileName: "a.pdf" })],
    ["a file over 4 MB", () => ({ file: pdf(4 * 1024 * 1024 + 1), fileName: "a.pdf" })],
    ["no file name", () => ({ file: pdf() })],
    ["a file name with a slash", () => ({ file: pdf(), fileName: "../a.pdf" })],
    ["a string instead of a file", () => ({ file: "%PDF-1.7", fileName: "a.pdf" })],
  ])("refuses %s", async (_label, input) => {
    await expectInvalidInput(inkthread.upload, input());
  });

  it("spends the upload budget", async () => {
    vi.stubEnv("BUDGET_UPLOAD", "0");
    expect(await call(inkthread.upload, { file: pdf(), fileName: "a.pdf" })).toMatchObject({
      error: "budget_exhausted",
    });
  });
});
