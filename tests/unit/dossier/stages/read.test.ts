import { describe, expect, it, vi } from "vitest";
import { inkthread } from "@/capabilities/inkthread";
import type { DossierDocument } from "@/lib/db/schema";
import { callContext } from "@/dossier/stages/shared";
import { POLL_MS } from "@/dossier/stages";
import { type ReadDeps, documentCandidates, readStage } from "@/dossier/stages/read";
import type { Candidate } from "@/dossier/select-evidence";
import type { GatewayResult } from "@/platform/gateway/result";
import { DOSSIER_ID, dossier, fixture, stageCtx } from "./helpers";

type Job = ReturnType<typeof inkthread.job.output.parse>;
const graph = () => inkthread.graph.output.parse(fixture("inkthread", "graph.json"));
const reading = () => inkthread.reading.output.parse(fixture("inkthread", "reading.json"));
const job = (over: Partial<Job>) => ({ ...inkthread.job.output.parse(fixture("inkthread", "job.json")), ...over });

const SITE = "https://bastion.test";
const DOC = "d5152b39-8bbc-4141-ac06-9d5e70f98f99";

const ok = <T>(data: T): GatewayResult<T> => ({ ok: true, data, status: 200, requestId: "r", ms: 1 });

function row(over: Partial<DossierDocument> = {}): DossierDocument {
  return {
    dossierId: DOSSIER_ID,
    documentId: DOC,
    sha256: null,
    title: null,
    kind: "sample",
    graphHash: null,
    pageCount: null,
    jobId: null,
    ...over,
  };
}

function deps(over: Partial<ReadDeps> = {}): ReadDeps {
  return {
    documents: async () => [row()],
    save: vi.fn(async () => {}),
    job: async () => ok(job({})),
    graph: vi.fn(async () => ok(graph())),
    reading: vi.fn(async () => ok(reading())),
    ...over,
  };
}

const run = (d: ReadDeps, ctx = stageCtx({ dossier: dossier({ claim: "zebra" }) })) =>
  readStage(d, SITE)(ctx);

describe("read stage", () => {
  it("is skipped with no documents", async () => {
    expect(await run(deps({ documents: async () => [] }))).toEqual({
      kind: "skipped",
      reason: "no_documents",
    });
  });

  it("reads a sample (no job) directly into passages and tables, and records the graph hash", async () => {
    const d = deps();
    const out = await run(d);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    const list = out.output as unknown as Candidate[];
    const passage = list.find((c) => c.kind === "passage");
    expect(passage).toMatchObject({
      product: "inkthread",
      role: "obligation",
      title: expect.stringContaining("The fees subject to reduction"),
      locator: {
        kind: "document",
        documentId: DOC,
        sha256: graph().document.sha256,
        page: 1,
        nodeId: "p:c95bca1f83faa250",
      },
    });
    expect(passage?.url).toBe(`${SITE}/d/${DOSSIER_ID}#e-${passage?.key}`);
    const tables = list.filter((c) => c.kind === "table");
    expect(tables).toHaveLength(2);
    expect(tables[0]?.text).toBe(reading().tables[0]?.markdown);
    expect(tables[0]?.locator).toMatchObject({ page: 1, nodeId: "p:4109c48ee22fb618" });
    expect(new Set(list.map((c) => c.key)).size).toBe(list.length);
    expect(d.save).toHaveBeenCalledWith(DOSSIER_ID, DOC, {
      sha256: graph().document.sha256,
      graphHash: graph().provenance.graph_hash,
      pageCount: 15,
    });
  });

  it("waits while the upload's job is running, then reads when it succeeds", async () => {
    let status: Job["status"] = "running";
    const d = deps({
      documents: async () => [row({ kind: "upload", jobId: "j1" })],
      job: async () => ok(job({ status })),
    });
    const waiting = await run(d);
    expect(waiting).toEqual({ kind: "waiting", output: { docs: {} }, retryInMs: POLL_MS });
    expect(d.graph).not.toHaveBeenCalled();
    status = "queued";
    expect((await run(d)).kind).toBe("waiting");
    status = "succeeded";
    expect((await run(d)).kind).toBe("ok");
  });

  it("does not fetch a finished document again while another is still waiting", async () => {
    const other = "e0000000-0000-4000-8000-000000000000";
    const d = deps({
      documents: async () => [row(), row({ documentId: other, kind: "upload", jobId: "j2" })],
      job: async () => ok(job({ status: "running" })),
    });
    const first = await run(d);
    expect(first.kind).toBe("waiting");
    if (first.kind !== "waiting") return;
    expect(d.graph).toHaveBeenCalledTimes(1);
    await run(d, stageCtx({ dossier: dossier({ claim: "zebra" }), outputs: { read: first.output } }));
    expect(d.graph).toHaveBeenCalledTimes(1);
  });

  it("ignores a malformed previous output", async () => {
    for (const read of [null, ["a"], { docs: ["a"] }, { docs: null }]) {
      const out = await run(deps(), stageCtx({ outputs: { read } }));
      expect(out.kind).toBe("ok");
    }
  });

  it("errors non-retryably when the job failed", async () => {
    const out = await run(
      deps({
        documents: async () => [row({ kind: "upload", jobId: "j1" })],
        job: async () => ok(job({ status: "failed", error: { code: "no_text", message: "m" } })),
      }),
    );
    expect(out).toEqual({ kind: "error", error: "job_failed:no_text", retryable: false });
    const out2 = await run(
      deps({
        documents: async () => [row({ kind: "upload", jobId: "j1" })],
        job: async () => ok(job({ status: "failed", error: null })),
      }),
    );
    expect(out2).toMatchObject({ error: "job_failed:unknown" });
  });

  it("fails invalid_response, non-retryably, on a malformed graph", async () => {
    const out = await run(
      deps({
        graph: async () => ({
          ok: false,
          error: "invalid_response",
          status: 502,
          requestId: "r",
          detail: "nodes: invalid_type",
        }),
      }),
    );
    expect(out).toEqual({
      kind: "error",
      error: "inkthread.graph: invalid_response (nodes: invalid_type)",
      retryable: false,
    });
  });

  it("maps job, graph and reading gateway failures", async () => {
    const fail = { ok: false, error: "asleep", status: 504, requestId: "r" } as const;
    expect(await run(deps({ documents: async () => [row({ jobId: "j" })], job: async () => fail }))).toMatchObject({
      error: "inkthread.job: asleep",
      retryable: true,
    });
    expect(await run(deps({ graph: async () => fail }))).toMatchObject({ error: "inkthread.graph: asleep" });
    expect(await run(deps({ reading: async () => fail }))).toMatchObject({ error: "inkthread.reading: asleep" });
  });
});

describe("documentCandidates", () => {
  it("includes a node with no evidence role when its text overlaps the claim", () => {
    const withClaim = documentCandidates("patent fees", SITE, DOSSIER_ID, DOC, graph(), reading());
    expect(withClaim.some((c) => c.title === "Patent fees")).toBe(true);
    const without = documentCandidates("zebra", SITE, DOSSIER_ID, DOC, graph(), reading());
    expect(without.some((c) => c.title === "Patent fees")).toBe(false);
  });

  it("skips table-kind graph nodes (the reading carries tables), nodes without regions, empty text", () => {
    const g = graph();
    const list = documentCandidates("zebra", SITE, DOSSIER_ID, DOC, g, reading());
    expect(list.filter((c) => c.kind === "passage").map((c) => c.locator)).not.toContainEqual(
      expect.objectContaining({ nodeId: "p:54a551b7d68fe9a8" }),
    );
    const empty = g.nodes.find((n) => n.id === "p:c95bca1f83faa250");
    if (empty) empty.text = "  ";
    expect(documentCandidates("zebra", SITE, DOSSIER_ID, DOC, g, reading()).some((c) => c.kind === "passage")).toBe(false);
  });

  it("falls back to a page title for a blank label and leaves role off for roleless nodes", () => {
    const g = graph();
    const node = g.nodes.find((n) => n.id === "s:b4481d18490e770e");
    if (node) node.label = " ";
    const list = documentCandidates("patent", SITE, DOSSIER_ID, DOC, g, reading());
    const section = list.find((c) => c.title === "Page 1" && c.locator.kind === "document" && c.locator.nodeId === "s:b4481d18490e770e");
    expect(section).toBeDefined();
    expect(section && "role" in section).toBe(false);
  });

  it("uses a non-evidence first role when no boosted role is present", () => {
    const g = graph();
    const node = g.nodes.find((n) => n.id === "p:c95bca1f83faa250");
    if (node) node.roles = node.roles.filter((r) => r.role === "scope");
    const c = documentCandidates("fees reduction", SITE, DOSSIER_ID, DOC, g, reading()).find(
      (x) => x.locator.kind === "document" && x.locator.nodeId === "p:c95bca1f83faa250",
    );
    expect(c?.role).toBe("scope");
  });
});

describe("callContext (ruling P)", () => {
  it("uses the dossier's request id, never a fresh one", () => {
    expect(callContext(stageCtx({ dossier: dossier({ requestId: "dossier-req-9" }), requestId: "other" }))).toEqual({
      actor: "bastion",
      requestId: "dossier-req-9",
      clientIp: undefined,
    });
  });
});
