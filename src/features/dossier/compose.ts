import * as z from "zod/mini";
import { MAX_CLAIM, MAX_DOCUMENTS, MAX_SOURCES, type Mode } from "@/dossier/limits";
import { type CallOptions, postRoute } from "@/features/tools/client";
import type { ToolOutcome } from "@/features/tools/outcome";

/**
 * Composing a dossier in the browser (spec 21 §6.6, "Compose"), the pure part: the draft, the
 * checks run when the visitor submits (invariant 1 — the submit is never pre-disabled for a bad
 * field), and the body `POST /api/dossiers` accepts. The limits are the route's own (`@/dossier/limits`).
 */

export type PickedDocument = {
  documentId: string;
  kind: "sample" | "upload";
  /** An upload's job (the read stage waits on it); null for a sample or a deduplicated upload. */
  jobId: string | null;
  label: string;
};

export type ComposeDraft = {
  claim: string;
  sources: readonly string[];
  documents: readonly PickedDocument[];
  mode: Mode;
};

export type ComposeErrors = { claim?: string; evidence?: string };

export function emptyDraft(): ComposeDraft {
  return { claim: "", sources: [], documents: [], mode: "standard" };
}

export function validateCompose(d: ComposeDraft): ComposeErrors {
  const errors: ComposeErrors = {};
  const claim = d.claim.trim();
  if (claim === "") errors.claim = "Write the claim to check.";
  else if (claim.length > MAX_CLAIM) {
    errors.claim = `At most ${MAX_CLAIM} characters — this one has ${claim.length}.`;
  }
  if (d.sources.length + d.documents.length === 0) {
    errors.evidence = "Pick at least one web source or document.";
  } else if (d.sources.length > MAX_SOURCES) {
    errors.evidence = `Pick at most ${MAX_SOURCES} web sources.`;
  } else if (d.documents.length > MAX_DOCUMENTS) {
    errors.evidence = `Pick at most ${MAX_DOCUMENTS} documents.`;
  }
  return errors;
}

export type ComposeBody = {
  claim: string;
  sources: string[];
  documents: (
    | { document_id: string; kind: "sample" }
    | { document_id: string; kind: "upload"; job_id?: string }
  )[];
  mode: Mode;
};

export function composeBody(d: ComposeDraft): ComposeBody {
  return {
    claim: d.claim.trim(),
    sources: [...d.sources],
    documents: d.documents.map((doc) =>
      doc.kind === "upload" && doc.jobId !== null
        ? { document_id: doc.documentId, kind: "upload", job_id: doc.jobId }
        : { document_id: doc.documentId, kind: doc.kind },
    ),
    mode: d.mode,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The 202 answer; its `url` must be this dossier's own page, nothing else is navigated to. */
export const composeAnswer = z
  .object({
    dossier_id: z.string().check(z.regex(UUID)),
    request_id: z.string().check(z.minLength(1)),
    url: z.string(),
  })
  .check(z.refine((a) => a.url === `/d/${a.dossier_id}`, "url is not the dossier's page"));

export type ComposeAnswer = z.infer<typeof composeAnswer>;

export function submitCompose(
  body: ComposeBody,
  options: CallOptions = {},
): Promise<ToolOutcome<ComposeAnswer>> {
  return postRoute("/api/dossiers", body, composeAnswer, options);
}

export type RunDeps = {
  /** Sends the body; null when the page was left mid-call (the call was aborted). */
  submit: (body: ComposeBody) => Promise<ToolOutcome<ComposeAnswer> | null>;
  navigate: (url: string) => void;
  refreshBudgets: () => void;
};

export type RunResult = { errors: ComposeErrors; outcome: ToolOutcome<ComposeAnswer> | null };

/**
 * The run button, composed (spec 21 §6.6, invariant 1): a draft that fails its checks sends
 * nothing and says why; otherwise the body is sent, today's budgets are re-read whatever the
 * answer, and a 202 goes to the dossier's own page. A refusal stays on the form.
 */
export async function runCompose(d: ComposeDraft, deps: RunDeps): Promise<RunResult> {
  const errors = validateCompose(d);
  if (errors.claim !== undefined || errors.evidence !== undefined) return { errors, outcome: null };
  const outcome = await deps.submit(composeBody(d));
  if (outcome === null) return { errors, outcome };
  deps.refreshBudgets();
  if (outcome.ok) deps.navigate(outcome.data.url);
  return { errors, outcome };
}
