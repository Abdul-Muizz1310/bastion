import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import {
  integer,
  isoDateTime,
  jsonObject,
  noInput,
  nonBlank,
  pemString,
  seg,
  uuid,
  withQuery,
} from "./shared";

/**
 * paper-trail (spec 21 §5, §6.1): start a debate over a claim and its sealed evidence, follow it,
 * fetch the signed transcript and the key it is signed with. Response schemas mirror
 * paper-trail-backend's `schemas/debates.py` (`DebateCreateOut`, `DebateOut`, `DebateListOut`,
 * `TranscriptJsonOut`) and `api/routers/platform.py::receipt_public_key`; `status` and `verdict`
 * are the `DebateStatus`/`DebateVerdict` enums the column stores (`models/debate.py`).
 *
 * Ruling I: `POST /debates` validates the body (422) and rate-limits (429) before it creates the
 * row; the model calls run in a background task after the 201, so a 4xx releases the budget.
 */

/** bastion's dearest mode is adversarial: three rounds. paper-trail itself would allow ten. */
export const MAX_DEBATE_ROUNDS = 3;
const MAX_EVIDENCE = 50;

export const DEBATE_STATUSES = ["pending", "running", "done", "error"] as const;
const verdict = z.enum(["TRUE", "FALSE", "INCONCLUSIVE"]);

const debateCreated = z.object({ debate_id: uuid, stream_url: z.string() });

const debateOut = z.object({
  id: uuid,
  claim: z.string(),
  status: z.enum(DEBATE_STATUSES),
  verdict: verdict.nullable(),
  confidence: z.number().nullable(),
  // `list[dict[str, Any]]` in paper-trail: the graph's raw round entries.
  rounds: z.array(jsonObject),
  transcript_md: z.string().nullable(),
  created_at: isoDateTime,
});

const citation = z.object({
  type: z.enum(["cert", "url"]),
  ref: z.string().min(1),
  title: z.string(),
});

const transcriptRound = z.object({
  side: z.enum(["proponent", "skeptic", "judge"]),
  round: z.number().int().min(1),
  argument_md: z.string(),
  citations: z.array(citation),
  confidence: z.number().nullable(),
});

const transcript = z.object({
  debate_id: uuid,
  claim: z.string(),
  verdict,
  confidence: z.number(),
  rounds: z.array(transcriptRound),
  transcript_hash: z.string().length(64),
  signature: z.string().nullable(),
  signature_alg: z.string().nullable(),
});

const receiptKey = z.object({ alg: z.string(), public_key: pemString });

export type DebateCreated = z.infer<typeof debateCreated>;
export type Debate = z.infer<typeof debateOut>;
export type DebateList = { items: Debate[]; next_cursor: string | null };
export type Transcript = z.infer<typeof transcript>;
export type ReceiptKey = z.infer<typeof receiptKey>;

/** paper-trail requires both a URL and a title on every pooled item; blank counts as missing. */
const evidenceItem = z.strictObject({
  certificate_id: uuid,
  url: nonBlank,
  title: nonBlank,
  text: nonBlank,
});

const debateInput = z.strictObject({
  claim: nonBlank.pipe(z.string().max(2000)),
  max_rounds: z.number().int().min(1).max(MAX_DEBATE_ROUNDS).default(1),
  evidence_pool: z.array(evidenceItem).max(MAX_EVIDENCE).optional(),
});

const byId = z.strictObject({ id: uuid });

const listInput = z.strictObject({
  // paper-trail's cursor is URL-safe base64 of `created_at|id`.
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/, "must be a cursor paper-trail issued")
    .max(512)
    .optional(),
  limit: integer(1, 100).optional(),
});

const debate: Capability<z.infer<typeof debateInput>, DebateCreated> = {
  id: "paper-trail.debate",
  service: "paper-trail",
  method: "POST",
  path: () => "/debates",
  body: (i) => i,
  input: debateInput,
  output: debateCreated,
  grant: "editor",
  cost: "llm",
  budget: "debate",
};

const debateGet: Capability<z.infer<typeof byId>, Debate> = {
  id: "paper-trail.debateGet",
  service: "paper-trail",
  method: "GET",
  path: (i) => `/debates/${seg(i.id)}`,
  input: byId,
  output: debateOut,
  grant: "viewer",
  cost: "free",
};

const transcriptGet: Capability<z.infer<typeof byId>, Transcript> = {
  id: "paper-trail.transcript",
  service: "paper-trail",
  method: "GET",
  path: (i) => `/debates/${seg(i.id)}/transcript.json`,
  input: byId,
  output: transcript,
  grant: "viewer",
  cost: "free",
};

const receiptKeyGet: Capability<z.infer<typeof noInput>, ReceiptKey> = {
  id: "paper-trail.receiptKey",
  service: "paper-trail",
  method: "GET",
  path: () => "/platform/receipt-public-key",
  input: noInput,
  output: receiptKey,
  grant: "viewer",
  cost: "free",
};

const list: Capability<z.infer<typeof listInput>, DebateList> = {
  id: "paper-trail.list",
  service: "paper-trail",
  method: "GET",
  path: (i) => withQuery("/debates", { cursor: i.cursor, limit: i.limit }),
  input: listInput,
  output: z.object({ items: z.array(debateOut), next_cursor: z.string().nullable() }),
  grant: "viewer",
  cost: "free",
};

export const paperTrail = {
  debate,
  debateGet,
  transcript: transcriptGet,
  receiptKey: receiptKeyGet,
  list,
} as const;
