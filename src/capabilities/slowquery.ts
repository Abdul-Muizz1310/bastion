import { z } from "zod";
import type { Capability } from "@/platform/gateway/call";
import type { ServiceId } from "@/platform/registry/products";
import { isoDateTime, jsonObject, noInput, seg, withQuery } from "./shared";

/**
 * slowquery (spec 21 §5, §8; DR-0034): the query log every service with slowquery-detective keeps
 * at `/_slowquery`, and the demo's slow/fast branch switch. The query capabilities take the service
 * from their input (`routeTo`), so one capability reads any host.
 *
 * Response schemas: interface I-2 — slowquery-detective 0.2.0's `QueryRow` and `QueryDetail`
 * (`schemas.py`) — widened only where the demo backend's current shapes (`schemas/slowquery.py`:
 * an integer `total_ms`, a nullable `max_ms`, `plan_text`, samples without `request_id`) differ,
 * so both parse until the demo moves onto the library store (WP-8).
 */

/** Where `/_slowquery` is installed: the four product backends and the demo (DR-0034). */
export const SLOWQUERY_HOSTS = [
  "paper-trail",
  "magpie",
  "inkprint",
  "inkthread",
  "slowquery",
] as const satisfies readonly ServiceId[];

/** slowquery-detective's `REQUEST_ID_PATTERN` (tagging.py). */
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const suggestion = z.object({
  kind: z.enum(["index", "rewrite", "denormalize", "partition"]),
  source: z.enum(["rules", "llm"]),
  sql: z.string().nullable(),
  rationale: z.string(),
  applied_at: isoDateTime.nullable(),
});

const queryRow = z.object({
  id: z.string(),
  fingerprint: z.string(),
  first_seen: isoDateTime,
  last_seen: isoDateTime,
  call_count: z.number().int(),
  total_ms: z.number(),
  p50_ms: z.number().nullable(),
  p95_ms: z.number().nullable(),
  p99_ms: z.number().nullable(),
  max_ms: z.number().nullable(),
  suggestions: z.array(suggestion),
});

const queryDetail = z.object({
  fingerprint: queryRow,
  canonical_sql: z.string(),
  explain_plan: z
    .object({
      plan_json: jsonObject,
      cost: z.number().nullable(),
      captured_at: isoDateTime,
      plan_text: z.string().optional(),
    })
    .nullable(),
  suggestions: z.array(suggestion),
  recent_samples: z.array(
    z.object({
      duration_ms: z.number(),
      sampled_at: isoDateTime,
      request_id: z.string().nullable().optional(),
    }),
  ),
});

const branchName = z.enum(["slow", "fast"]);
const switchResponse = z.object({
  active: branchName,
  switched_at: isoDateTime,
  latency_ms: z.number().int(),
});

export type QueryRow = z.infer<typeof queryRow>;
export type QueryDetail = z.infer<typeof queryDetail>;
export type BranchSwitch = z.infer<typeof switchResponse>;

const host = z.enum(SLOWQUERY_HOSTS);

const queriesInput = z.strictObject({
  service: host,
  requestId: z.string().regex(REQUEST_ID, "must be a request id").optional(),
  since: isoDateTime.optional(),
});

const queryInput = z.strictObject({
  service: host,
  id: z.string().regex(/^[0-9a-f]{1,16}$/, "must be a fingerprint id"),
});

const switchInput = z.strictObject({ target: branchName });

const queries: Capability<z.infer<typeof queriesInput>, QueryRow[]> = {
  id: "slowquery.queries",
  service: "slowquery",
  routeTo: (i) => i.service,
  method: "GET",
  path: (i) => withQuery("/_slowquery/queries", { request_id: i.requestId, since: i.since }),
  input: queriesInput,
  output: z.array(queryRow),
  grant: "viewer",
  cost: "free",
};

const query: Capability<z.infer<typeof queryInput>, QueryDetail> = {
  id: "slowquery.query",
  service: "slowquery",
  routeTo: (i) => i.service,
  method: "GET",
  path: (i) => `/_slowquery/queries/${seg(i.id)}`,
  input: queryInput,
  output: queryDetail,
  grant: "viewer",
  cost: "free",
};

const branch: Capability<z.infer<typeof noInput>, { active: "slow" | "fast" }> = {
  id: "slowquery.branch",
  service: "slowquery",
  method: "GET",
  path: () => "/branches/current",
  input: noInput,
  output: z.object({ active: branchName }),
  grant: "viewer",
  cost: "free",
};

const switchBranch: Capability<z.infer<typeof switchInput>, BranchSwitch> = {
  id: "slowquery.switch",
  service: "slowquery",
  method: "POST",
  path: () => "/branches/switch",
  body: (i) => i,
  input: switchInput,
  output: switchResponse,
  grant: "editor",
  cost: "free",
  // A switch rebuilds the demo's engine for every visitor; the demo also keeps a cooldown.
  perVisitorPerMin: 2,
};

export const slowquery = { queries, query, branch, switch: switchBranch } as const;
