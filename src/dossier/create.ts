import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { sourceSlug } from "@/capabilities/magpie";
import type { EventInput } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import { releaseBudget, reserveBudget, secondsUntilUtcMidnight } from "@/platform/budget";
import type { VisitorId } from "@/platform/visitor";
import { knownSamples, knownSources } from "./catalog";
import { initialSteps, type StepRow } from "./stages";
import { insertDossier, type NewDossier, type NewDossierDocument } from "./store";

/**
 * Composing a dossier (spec 21 §3, §4 Budgets, §6.3): validate the selection, reserve the `debate`
 * budget, write the dossier with its 8 steps and its documents in one transaction, audit it. The
 * caller (the route) then starts the runner; nothing here talks to a stage.
 *
 * Order matters: the catalog checks come before the reservation (a refused request spends
 * nothing), the reservation before the transaction, and a failed transaction releases it.
 */

export const MAX_CLAIM = 1024;
export const MAX_SOURCES = 5;
export const MAX_DOCUMENTS = 3;
export const MODES = ["rapid", "standard", "adversarial"] as const;

const documentRef = z.strictObject({
  document_id: z.uuid(),
  kind: z.enum(["sample", "upload"]),
  job_id: z.string().min(1).max(128).optional(),
});

export const createBodySchema = z
  .strictObject({
    claim: z.string().trim().min(1).max(MAX_CLAIM),
    sources: z
      .array(sourceSlug)
      .max(MAX_SOURCES)
      .refine((s) => new Set(s).size === s.length, { message: "sources must not repeat" })
      .default([]),
    documents: z
      .array(documentRef)
      .max(MAX_DOCUMENTS)
      .refine((d) => new Set(d.map((x) => x.document_id)).size === d.length, {
        message: "documents must not repeat",
      })
      .default([]),
    mode: z.enum(MODES).default("standard"),
  })
  .refine((b) => b.sources.length + b.documents.length > 0, {
    message: "select at least one source or document",
  });

export type CreateInput = z.infer<typeof createBodySchema>;

export type CreateDeps = {
  knownSources: () => Promise<ReadonlySet<string> | null>;
  knownSamples: () => Promise<ReadonlySet<string> | null>;
  reserve: typeof reserveBudget;
  release: typeof releaseBudget;
  insert: (
    dossier: NewDossier,
    steps: readonly StepRow[],
    documents: readonly NewDossierDocument[],
  ) => Promise<void>;
  audit: (event: EventInput) => Promise<unknown>;
  now: () => Date;
  newId: () => string;
};

const defaultDeps: CreateDeps = {
  knownSources: () => knownSources.get(),
  knownSamples: () => knownSamples.get(),
  reserve: reserveBudget,
  release: releaseBudget,
  insert: insertDossier,
  audit: appendEvent,
  now: () => new Date(),
  newId: randomUUID,
};

export type CreateResult =
  | { ok: true; dossierId: string; requestId: string }
  | { ok: false; status: number; error: string; detail?: string; retryAfterS?: number };

const refuse = (status: number, error: string, detail?: string): CreateResult => ({
  ok: false,
  status,
  error,
  ...(detail === undefined ? {} : { detail }),
});

export async function createDossier(
  input: CreateInput,
  ctx: { visitor: VisitorId; requestId: string },
  deps: CreateDeps = defaultDeps,
): Promise<CreateResult> {
  if (input.sources.length > 0) {
    const known = await deps.knownSources();
    if (known === null) return refuse(503, "catalog_unavailable", "the source list is unreachable");
    const unknown = input.sources.find((s) => !known.has(s));
    if (unknown !== undefined) return refuse(422, "invalid_input", `unknown source: ${unknown}`);
  }
  const samples = input.documents.filter((d) => d.kind === "sample");
  if (samples.length > 0) {
    const known = await deps.knownSamples();
    if (known === null) return refuse(503, "catalog_unavailable", "the sample list is unreachable");
    const unknown = samples.find((d) => !known.has(d.document_id));
    if (unknown !== undefined) {
      return refuse(422, "invalid_input", `unknown sample document: ${unknown.document_id}`);
    }
  }

  const now = deps.now();
  const reservation = await deps.reserve("debate", 1);
  if (!reservation.ok) {
    return {
      ok: false,
      status: 429,
      error: "budget_exhausted",
      retryAfterS: secondsUntilUtcMidnight(now),
    };
  }

  const id = deps.newId();
  try {
    await deps.insert(
      {
        id,
        visitor: ctx.visitor,
        claim: input.claim,
        sources: input.sources,
        mode: input.mode,
        status: "pending",
        requestId: ctx.requestId,
      },
      initialSteps(id, now),
      input.documents.map((d) => ({
        dossierId: id,
        documentId: d.document_id,
        kind: d.kind,
        jobId: d.kind === "upload" ? (d.job_id ?? null) : null,
      })),
    );
  } catch (err) {
    await deps.release("debate", 1);
    throw err;
  }

  await deps.audit({
    actor: ctx.visitor,
    action: "dossier.created",
    entityType: "dossier",
    entityId: id,
    service: "bastion",
    requestId: ctx.requestId,
    metadata: {
      sources: input.sources.length,
      documents: input.documents.length,
      mode: input.mode,
    },
  });
  return { ok: true, dossierId: id, requestId: ctx.requestId };
}
