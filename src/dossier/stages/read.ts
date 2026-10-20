import {
  type Graph,
  type GraphNode,
  type InkthreadJob,
  inkthread,
  type Reading,
} from "@/capabilities/inkthread";
import type { DossierDocument } from "@/lib/db/schema";
import { SITE } from "@/lib/site/config";
import { callCapability } from "@/platform/gateway/call";
import type { GatewayResult } from "@/platform/gateway/result";
import { type DocumentFacts, listDocuments, saveDocumentFacts } from "../documents";
import { BOOSTED_ROLES, type Candidate, stems } from "../select-evidence";
import { type Json, POLL_MS, type StageContext, type StageHandler } from "../stages";
import { callContext, failure } from "./shared";

/**
 * Stage `read` (spec 21 §6.1): turn each of the dossier's inkthread documents into passage and
 * table candidates. A sample has no job; an upload's job is polled (`waiting`) until it succeeds.
 * Passages are graph nodes whose roles include one of the five evidence roles, or whose text shares
 * a word stem of four letters or more with the claim. Tables come from the reading, as Markdown.
 * The output is the flat `Candidate[]` (Task 7's seal reads `ctx.outputs.read`); while waiting, the
 * output is `{ docs: { [documentId]: Candidate[] } }` so finished documents are not fetched again.
 */

export type ReadDeps = {
  documents: (dossierId: string) => Promise<DossierDocument[]>;
  save: (dossierId: string, documentId: string, facts: DocumentFacts) => Promise<void>;
  job: (ctx: StageContext, jobId: string) => Promise<GatewayResult<InkthreadJob>>;
  graph: (ctx: StageContext, documentId: string) => Promise<GatewayResult<Graph>>;
  reading: (ctx: StageContext, documentId: string) => Promise<GatewayResult<Reading>>;
};

const MIN_OVERLAP_STEM = 4;

function bbox4(b: readonly number[]): [number, number, number, number] {
  return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0];
}

function shortId(documentId: string): string {
  return documentId.slice(0, 8);
}

/** Pure: the passage and table candidates of one document. */
export function documentCandidates(
  claim: string,
  siteUrl: string,
  dossierId: string,
  documentId: string,
  graph: Graph,
  reading: Reading,
): Candidate[] {
  const sha256 = graph.document.sha256;
  const claimStems = new Set(stems(claim).filter((s) => s.length >= MIN_OVERLAP_STEM));
  const out: Candidate[] = [];
  const url = (key: string) => `${siteUrl}/d/${dossierId}#e-${key}`;

  for (const node of graph.nodes as GraphNode[]) {
    const region = node.regions[0];
    if (region === undefined || node.kind === "table" || node.text.trim() === "") continue;
    const roles = node.roles.map((r) => r.role);
    const boosted = roles.find((r) => BOOSTED_ROLES.has(r));
    const overlaps = stems(node.text).some((s) => claimStems.has(s));
    if (boosted === undefined && !overlaps) continue;
    const key = `${shortId(documentId)}-${node.id.replace(/[^A-Za-z0-9]/g, "")}`;
    const role = boosted ?? roles[0];
    out.push({
      key,
      kind: "passage",
      product: "inkthread",
      title: node.label.trim() === "" ? `Page ${region.page}` : node.label,
      url: url(key),
      text: node.text,
      locator: {
        kind: "document",
        documentId,
        sha256,
        page: region.page,
        bbox: bbox4(region.bbox),
        nodeId: node.id,
      },
      ...(role === undefined ? {} : { role }),
    });
  }

  for (const table of reading.tables) {
    const key = `${shortId(documentId)}-t-${table.id.replace(/[^A-Za-z0-9]/g, "")}`;
    out.push({
      key,
      kind: "table",
      product: "inkthread",
      title: `Table on page ${table.page}`,
      url: url(key),
      text: table.markdown,
      locator: {
        kind: "document",
        documentId,
        sha256,
        page: table.page,
        bbox: bbox4(table.bbox),
        nodeId: table.node_id,
      },
    });
  }
  return out;
}

type Docs = Record<string, Candidate[]>;

function previousDocs(output: Json | undefined): Docs {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return {};
  const docs = (output as Record<string, Json>).docs;
  if (typeof docs !== "object" || docs === null || Array.isArray(docs)) return {};
  return docs as unknown as Docs;
}

type Step =
  | { kind: "done"; candidates: Candidate[] }
  | { kind: "waiting" }
  | { kind: "error"; outcome: Extract<Awaited<ReturnType<StageHandler>>, { kind: "error" }> };

export function readStage(deps: ReadDeps, siteUrl: string): StageHandler {
  async function readOne(ctx: StageContext, doc: DossierDocument): Promise<Step> {
    if (doc.jobId !== null) {
      const job = await deps.job(ctx, doc.jobId);
      if (!job.ok) return { kind: "error", outcome: failure("inkthread.job", job) };
      if (job.data.status === "failed") {
        const code = job.data.error?.code ?? "unknown";
        return {
          kind: "error",
          outcome: { kind: "error", error: `job_failed:${code}`, retryable: false },
        };
      }
      if (job.data.status !== "succeeded") return { kind: "waiting" };
    }
    const graph = await deps.graph(ctx, doc.documentId);
    if (!graph.ok) return { kind: "error", outcome: failure("inkthread.graph", graph) };
    const reading = await deps.reading(ctx, doc.documentId);
    if (!reading.ok) return { kind: "error", outcome: failure("inkthread.reading", reading) };
    await deps.save(ctx.dossier.id, doc.documentId, {
      sha256: graph.data.document.sha256,
      graphHash: graph.data.provenance.graph_hash,
      pageCount: graph.data.document.page_count,
    });
    return {
      kind: "done",
      candidates: documentCandidates(
        ctx.dossier.claim,
        siteUrl,
        ctx.dossier.id,
        doc.documentId,
        graph.data,
        reading.data,
      ),
    };
  }

  return async (ctx) => {
    const documents = await deps.documents(ctx.dossier.id);
    if (documents.length === 0) return { kind: "skipped", reason: "no_documents" };
    const done: Docs = previousDocs(ctx.outputs.read);
    let waiting = false;
    for (const doc of documents) {
      if (done[doc.documentId] !== undefined) continue;
      const step = await readOne(ctx, doc);
      if (step.kind === "error") return step.outcome;
      if (step.kind === "waiting") waiting = true;
      else done[doc.documentId] = step.candidates;
    }
    if (waiting) {
      return { kind: "waiting", output: { docs: done } as unknown as Json, retryInMs: POLL_MS };
    }
    const all = documents.flatMap((d) => done[d.documentId] ?? []);
    return { kind: "ok", output: all as unknown as Json };
  };
}

export const read: StageHandler = readStage(
  {
    documents: listDocuments,
    save: saveDocumentFacts,
    job: (ctx, jobId) => callCapability(inkthread.job, { jobId }, callContext(ctx)),
    graph: (ctx, documentId) => callCapability(inkthread.graph, { documentId }, callContext(ctx)),
    reading: (ctx, documentId) =>
      callCapability(inkthread.reading, { documentId }, callContext(ctx)),
  },
  SITE.url,
);
