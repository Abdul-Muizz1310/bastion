import { z } from "zod/v4";

export const dossierModeSchema = z.enum(["rapid", "standard", "adversarial"]);
export type DossierMode = z.infer<typeof dossierModeSchema>;

export const dossierStatusSchema = z.enum(["pending", "running", "succeeded", "failed"]);
export type DossierStatus = z.infer<typeof dossierStatusSchema>;

export const verdictSchema = z.enum(["TRUE", "FALSE", "INCONCLUSIVE"]);
export type Verdict = z.infer<typeof verdictSchema>;

export const dossierStepSchema = z.enum([
  "gather",
  "seal",
  "adjudicate",
  "measure",
  "envelope",
  "record",
]);
export type DossierStep = z.infer<typeof dossierStepSchema>;

export const dossierEventStatusSchema = z.enum(["started", "ok", "error"]);
export type DossierEventStatus = z.infer<typeof dossierEventStatusSchema>;

export const sourceSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/, "source must be lowercase alphanumeric with dashes");
export type SourceSlug = z.infer<typeof sourceSlugSchema>;

export const dossierCreateRequestSchema = z.object({
  claim: z.string().min(1).max(1024),
  sources: z.array(sourceSlugSchema).min(1).max(10),
  mode: dossierModeSchema.default("standard"),
});
export type DossierCreateRequest = z.infer<typeof dossierCreateRequestSchema>;

export const dossierCreateResponseSchema = z.object({
  dossier_id: z.uuid(),
  request_id: z.string().min(1),
  stream_url: z.string().regex(/^\/api\/dossiers\/[^/]+\/stream$/),
});
export type DossierCreateResponse = z.infer<typeof dossierCreateResponseSchema>;

export const dossierEventSchema = z.object({
  step: dossierStepSchema,
  status: dossierEventStatusSchema,
  latency_ms: z.number().int().nonnegative().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  at: z.iso.datetime(),
});
export type DossierEvent = z.infer<typeof dossierEventSchema>;
