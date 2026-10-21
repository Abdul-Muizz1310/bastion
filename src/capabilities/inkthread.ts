import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import type { RawBody } from "@/platform/raw-body";
import { hex64, integer, isoDateTime, noInput, pathSegment, pngBody, seg, uuid } from "./shared";

/**
 * inkthread (spec 21 §5, §9): the curated samples, a document's graph (`inkthread.graph/1`), its
 * inkgrid reading (interface I-3), the why of any element, a page image, a job, and uploads.
 * Response schemas mirror inkthread-backend's `schemas/documents.py`, `schemas/jobs.py`,
 * `schemas/readings.py` with `domain/digest.py`, `domain/model.py` (the graph contract, spec 01)
 * and `domain/why.py`. The graph's cross-node invariants (one document node, the contains tree,
 * spans that fit) are inkthread's to keep; bastion parses every field it reads.
 *
 * Ruling I: an upload is refused (413/415/422/429) while its bytes are read and checked, before a
 * document or job exists; the model calls run in the job, so a 4xx releases the `upload` budget.
 */

/** Uploads through bastion stop at 4 MB: Vercel's function body limit is 4.5 MB. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_PAGE = 100_000;

const bbox = z.tuple([z.number(), z.number(), z.number(), z.number()]);
const page = z.number().int().min(1);

// ---- documents and jobs -----------------------------------------------------------------------

const jobOut = z.object({
  id: uuid,
  document_id: uuid,
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  stage: z.string().nullable(),
  created_at: isoDateTime,
  started_at: isoDateTime.nullable(),
  finished_at: isoDateTime.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  llm: z.object({
    requests: z.number().int().min(0),
    cached: z.number().int().min(0),
    failed: z.number().int().min(0),
    rejected: z.number().int().min(0),
  }),
  stages: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      ms: z.number().int().nullable(),
      reason: z.string().nullable(),
    }),
  ),
});

const documentOut = z.object({
  id: uuid,
  sha256: hex64,
  file_name: z.string().nullable(),
  title: z.string().nullable(),
  page_count: z.number().int(),
  kind: z.enum(["sample", "upload"]),
  status: z.enum(["queued", "processing", "ready", "failed"]),
  created_at: isoDateTime,
  expires_at: isoDateTime.nullable(),
  stats: z
    .object({
      nodes: z.number().int(),
      edges: z.number().int(),
      tiers: z.record(z.string(), z.number().int()),
    })
    .nullable(),
  latest_job: jobOut.nullable(),
});

const uploadOut = z.object({
  document: documentOut,
  job: jobOut.nullable(),
  deduplicated: z.boolean(),
});

// ---- the graph (spec 01) ----------------------------------------------------------------------

export const NODE_KINDS = [
  "document",
  "section",
  "paragraph",
  "list_item",
  "table",
  "note",
  "definition",
  "term",
  "external",
] as const;

export const EDGE_TYPES = [
  "contains",
  "continues",
  "cites_note",
  "defines",
  "uses_term",
  "refers_to",
  "cites_external",
  "governs",
  "qualifies",
  "overrides",
  "illustrates",
] as const;

export const EDGE_FAMILIES = ["structure", "notes", "terms", "references", "logic"] as const;

export const ROLES = [
  "obligation",
  "permission",
  "prohibition",
  "condition",
  "exception",
  "definition",
  "computation",
  "method",
  "procedure",
  "temporal",
  "quantitative",
  "scope",
  "convention",
  "example",
  "external_pointer",
  "administrative",
  "summary",
  "claim",
] as const;

const tier = z.enum(["A", "B", "C", "D"]);
const basis = z.enum(["explicit", "semantic"]);

const span = z.object({
  start: z.number().int().min(0),
  end: z.number().int().positive(),
  quote: z.string().min(1),
});

const maker = z.object({
  actor: z.enum(["inkgrid", "rule", "agent", "verifier"]),
  id: z.string().min(1),
  model: z.string().nullable(),
  request_key: z.string().nullable(),
});

const REASON_CODES = [
  "verified_text",
  "text_defect",
  "explicit_rule",
  "explicit_inkgrid",
  "weak_rule",
  "semantic_agent",
  "verifier_supported",
  "verifier_rejected",
  "verifier_abstained",
  "verifier_unavailable",
  "unresolved_parts",
  "hidden_text",
  "target_defect",
] as const;

const FLAG_CODES = [
  "hidden_text",
  "text_defect",
  "header_not_found",
  "note_not_found",
  "reference_unresolved",
  "multiple_definitions",
  "merged_heading",
  "contested",
  "model_unavailable",
  "truncated_for_model",
] as const;

const OP_KINDS = [
  "set_aside",
  "add_node",
  "add_edge",
  "add_role",
  "add_flag",
  "add_unresolved",
  "verdict",
  "reject",
] as const;

const reason = z.object({
  code: z.enum(REASON_CODES),
  severity: z.enum(["info", "advice", "flag", "doubt", "critical"]),
  detail: z.string().nullable(),
});

const confidence = z.object({
  tier,
  score: z.number().min(0).max(1),
  reasons: z.array(reason),
});

const verdict = z.object({
  verdict: z.enum(["supported", "unsupported", "abstain"]),
  model: z.string(),
  request_key: z.string(),
});

const flag = z.object({ code: z.enum(FLAG_CODES), detail: z.string().nullable() });

const roleAssignment = z.object({
  role: z.enum(ROLES),
  evidence: span.nullable(),
  made_by: maker,
  basis,
  confidence,
  verdict: verdict.nullable(),
});

const cell = z.object({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  row_span: z.number().int().min(1),
  col_span: z.number().int().min(1),
  text: z.string(),
  is_header: z.boolean(),
  header_path: z.array(z.string()),
  row_labels: z.array(z.string()),
  markers: z.array(z.string()),
  carried: z.boolean(),
  page,
  bbox: bbox.nullable(),
});

const tableInfo = z.object({
  n_rows: z.number().int().min(1),
  n_cols: z.number().int().min(1),
  header_rows: z.number().int().min(0),
  banner_rows: z.array(z.number().int()),
  source: z.enum(["lattice", "corridor"]),
  cells: z.array(cell),
});

const node = z.object({
  id: z.string().min(3),
  kind: z.enum(NODE_KINDS),
  label: z.string(),
  label_truncated: z.boolean(),
  text: z.string(),
  order: z.number().int().min(0),
  section: z.string().nullable(),
  depth: z.number().int().min(0),
  regions: z.array(z.object({ page, bbox })),
  roles: z.array(roleAssignment),
  table: tableInfo.nullable(),
  marker: z.string().nullable(),
  flags: z.array(flag),
  hidden_spans: z.array(span),
  unresolved: z.array(
    z.object({
      kind: z.enum(["note", "reference"]),
      text: z.string(),
      span: span.nullable(),
      candidates: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  confidence,
  source: z.object({ blocks: z.array(z.string()), keys: z.array(z.string()) }),
  made_by: maker,
});

const edge = z.object({
  id: z.string().min(3),
  type: z.enum(EDGE_TYPES),
  family: z.enum(EDGE_FAMILIES),
  source: z.string(),
  target: z.string(),
  basis,
  evidence: span.nullable(),
  evidence_on: z.enum(["source", "target"]),
  anchor: z.object({ row: z.number().int().min(0), col: z.number().int().min(0) }).nullable(),
  label: z.string().nullable(),
  method: z.string().min(1),
  made_by: maker,
  confidence,
  flags: z.array(flag),
  verdict: verdict.nullable(),
});

const graph = z.object({
  schema: z.literal("inkthread.graph/1"),
  document: z.object({
    sha256: hex64,
    file_name: z.string().nullable(),
    title: z.string().nullable(),
    title_node: z.string().nullable(),
    page_count: z.number().int().min(1),
    pages: z.array(
      z.object({ number: page, width: z.number().positive(), height: z.number().positive() }),
    ),
  }),
  nodes: z.array(node),
  edges: z.array(edge),
  set_aside: z.array(
    z.object({
      block: z.string(),
      kind: z.enum(["furniture", "toc"]),
      text: z.string(),
      page,
      bbox,
      reason: z.string(),
    }),
  ),
  findings: z.array(
    z.object({
      code: z.string(),
      severity: z.string(),
      page: z.number().int().nullable(),
      detail: z.string().nullable(),
    }),
  ),
  stats: z.object({
    nodes_by_kind: z.record(z.string(), z.number().int()),
    edges_by_type: z.record(z.string(), z.number().int()),
    roles: z.record(z.string(), z.number().int()),
    tiers: z.record(z.string(), z.number().int()),
  }),
  provenance: z.object({
    pipeline_version: z.string(),
    inkgrid_version: z.string(),
    prompts_hash: z.string(),
    models: z.record(z.string(), z.string()),
    ops_head: z.string(),
    ops_count: z.number().int().min(0),
    graph_hash: hex64,
    rejected: z.array(
      z.object({ task: z.string(), request_key: z.string(), item: z.string(), reason: z.string() }),
    ),
  }),
});

// ---- the reading (I-3, spec 11) and the why (spec 06 § 6) -------------------------------------

const verification = z
  .object({
    ok: z.boolean(),
    engine: z.string().min(1),
    checked: z.number().int().min(0),
    disagreements: z.number().int().min(0),
    defects: z.array(z.object({ code: z.string().min(1), page, message: z.string() })),
  })
  .refine((v) => v.disagreements === v.defects.length, {
    message: "disagreements must count the defects",
  })
  .refine((v) => v.ok === (v.defects.length === 0), {
    message: "ok exactly when nothing disagrees",
  });

const reading = z.object({
  schema: z.literal("inkthread.reading/1"),
  document_id: uuid,
  doc_sha256: hex64,
  inkgrid_version: z.string(),
  verification,
  tables: z.array(
    z
      .object({
        id: z.string().min(1),
        node_id: z.string().nullable(),
        page,
        bbox,
        header_rows: z.number().int().min(0),
        rows: z.array(z.array(z.string())).min(1),
        markdown: z.string().min(1),
      })
      // A table cannot have more header rows than rows; one that claims to could not be drawn.
      .refine((t) => t.header_rows <= t.rows.length, {
        message: "header_rows must not exceed the rows",
      }),
  ),
  findings: z.array(
    z.object({ code: z.string().min(1), severity: z.string().min(1), page: page.nullable() }),
  ),
});

const why = z.object({
  element: z.string(),
  kind: z.enum(["node", "edge", "role"]),
  maker,
  statement: z.string(),
  evidence: span.nullable(),
  reasons: z.array(reason),
  verdict: verdict.nullable(),
  ops: z.array(
    z.object({
      seq: z.number().int().min(1),
      stage: z.string(),
      kind: z.enum(OP_KINDS),
      target: z.string(),
      actor: z.string(),
      method: z.string(),
      model: z.string().nullable(),
      request_key: z.string().nullable(),
      detail: z.string().nullable(),
    }),
  ),
});

export type InkthreadJob = z.infer<typeof jobOut>;
export type InkthreadDocument = z.infer<typeof documentOut>;
export type InkthreadUpload = z.infer<typeof uploadOut>;
export type Graph = z.infer<typeof graph>;
export type GraphNode = z.infer<typeof node>;
export type GraphEdge = z.infer<typeof edge>;
export type Reading = z.infer<typeof reading>;
export type Why = z.infer<typeof why>;

// ---- inputs and capabilities ------------------------------------------------------------------

const byDocument = z.strictObject({ documentId: uuid });
const whyInput = z.strictObject({ documentId: uuid, element: pathSegment });
const jobInput = z.strictObject({ jobId: uuid });
const pageInput = z.strictObject({ documentId: uuid, page: integer(1, MAX_PAGE) });

const uploadInput = z.strictObject({
  file: z
    .instanceof(Blob)
    .refine((f) => f.size > 0, { message: "file must not be empty" })
    .refine((f) => f.size <= MAX_UPLOAD_BYTES, { message: "file must be at most 4 MB" }),
  fileName: pathSegment,
});

const samples: Capability<z.infer<typeof noInput>, { items: InkthreadDocument[] }> = {
  id: "inkthread.samples",
  service: "inkthread",
  method: "GET",
  path: () => "/samples",
  input: noInput,
  output: z.object({ items: z.array(documentOut) }),
  grant: "viewer",
  cost: "free",
};

const document: Capability<z.infer<typeof byDocument>, InkthreadDocument> = {
  id: "inkthread.document",
  service: "inkthread",
  method: "GET",
  path: (i) => `/documents/${seg(i.documentId)}`,
  input: byDocument,
  output: documentOut,
  grant: "viewer",
  cost: "free",
};

const graphGet: Capability<z.infer<typeof byDocument>, Graph> = {
  id: "inkthread.graph",
  service: "inkthread",
  method: "GET",
  path: (i) => `/documents/${seg(i.documentId)}/graph`,
  input: byDocument,
  output: graph,
  grant: "viewer",
  cost: "free",
};

const readingGet: Capability<z.infer<typeof byDocument>, Reading> = {
  id: "inkthread.reading",
  service: "inkthread",
  method: "GET",
  path: (i) => `/documents/${seg(i.documentId)}/reading`,
  input: byDocument,
  output: reading,
  grant: "viewer",
  cost: "free",
};

const whyGet: Capability<z.infer<typeof whyInput>, Why> = {
  id: "inkthread.why",
  service: "inkthread",
  method: "GET",
  // Element ids carry `:` and, for a role, `#` — both must be encoded.
  path: (i) => `/documents/${seg(i.documentId)}/why/${seg(i.element)}`,
  input: whyInput,
  output: why,
  grant: "viewer",
  cost: "free",
};

const job: Capability<z.infer<typeof jobInput>, InkthreadJob> = {
  id: "inkthread.job",
  service: "inkthread",
  method: "GET",
  path: (i) => `/jobs/${seg(i.jobId)}`,
  input: jobInput,
  output: jobOut,
  grant: "viewer",
  cost: "free",
};

const pageGet: Capability<z.infer<typeof pageInput>, RawBody> = {
  id: "inkthread.page",
  service: "inkthread",
  method: "GET",
  path: (i) => `/documents/${seg(i.documentId)}/pages/${i.page}.png`,
  input: pageInput,
  output: pngBody,
  grant: "viewer",
  cost: "free",
  raw: "png",
};

const upload: Capability<z.infer<typeof uploadInput>, InkthreadUpload> = {
  id: "inkthread.upload",
  service: "inkthread",
  method: "POST",
  path: () => "/documents",
  body: (i) => {
    const form = new FormData();
    form.set("file", i.file, i.fileName);
    return form;
  },
  input: uploadInput,
  output: uploadOut,
  grant: "editor",
  cost: "llm",
  budget: "upload",
  timeoutMs: 60_000,
};

export const inkthread = {
  samples,
  document,
  graph: graphGet,
  reading: readingGet,
  why: whyGet,
  job,
  page: pageGet,
  upload,
} as const;
