import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { appendEvent } from "@/lib/audit/write";
import { withRole } from "@/lib/auth/rbac";
import { getDb } from "@/lib/db/client";
import { dossierEvents, dossiers } from "@/lib/db/schema";
import type { Role } from "@/lib/validation";
import type { DossierCreateRequest, DossierCreateResponse, DossierStep } from "../schemas";
import { startDossierRun } from "./pipeline";

/**
 * Maps the legacy pipeline step names (magpie/inkprint/paper-trail/slowquery/audit)
 * to the dossier-facing step vocabulary.
 */
const STEP_MAP: Record<string, DossierStep> = {
  magpie: "gather",
  inkprint: "seal",
  "paper-trail": "adjudicate",
  slowquery: "measure",
  audit: "record",
};

export async function createDossier(
  input: DossierCreateRequest,
  actor: { id: string; role: Role },
): Promise<DossierCreateResponse> {
  await withRole(["admin", "editor"], actor, "dossier.create");

  const dossierId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const db = getDb();
  await db.insert(dossiers).values({
    id: dossierId,
    userId: actor.id,
    claim: input.claim,
    sources: input.sources,
    mode: input.mode,
    status: "pending",
    requestId,
  });

  await appendEvent({
    actorId: actor.id,
    action: "dossier.created",
    entityType: "dossier",
    entityId: dossierId,
    service: "bastion",
    requestId,
    metadata: { claim: input.claim, sources: input.sources, mode: input.mode },
  });

  // Fire-and-forget pipeline — the client polls the SSE stream for progress.
  // We never await this; errors are captured into dossier status by runPipeline itself.
  void runPipeline(dossierId, requestId, input, actor);

  return {
    dossier_id: dossierId,
    request_id: requestId,
    stream_url: `/api/dossiers/${dossierId}/stream`,
  };
}

export async function runPipeline(
  dossierId: string,
  requestId: string,
  _input: DossierCreateRequest,
  actor: { id: string; role: Role },
): Promise<void> {
  const db = getDb();

  try {
    await db.update(dossiers).set({ status: "running" }).where(eq(dossiers.id, dossierId));

    const result = await startDossierRun({
      userId: actor.id,
      role: actor.role,
      requestId,
    });

    // Persist every step as a dossier_events row. Map the legacy step names
    // (magpie/inkprint/paper-trail/slowquery/audit) to the dossier vocabulary.
    for (const entry of result.timeline) {
      const step = STEP_MAP[entry.step];
      if (!step) continue;
      const stepResult = result.steps.find((s) => s.step === entry.step);
      await db.insert(dossierEvents).values({
        dossierId,
        step,
        status: stepResult?.status === "ok" ? "ok" : "error",
        latencyMs: entry.latencyMs,
        metadata: stepResult?.error ? { error: stepResult.error } : {},
      });
    }

    const allOk = result.steps.every((s) => s.status === "ok");
    const paperTrailData = result.artifacts.find((a) => a.type === "paper-trail")?.data as
      | { verdict?: "TRUE" | "FALSE" | "INCONCLUSIVE"; confidence?: number }
      | undefined;

    await db
      .update(dossiers)
      .set({
        status: allOk ? "succeeded" : "failed",
        verdict: paperTrailData?.verdict ?? null,
        confidence:
          typeof paperTrailData?.confidence === "number"
            ? paperTrailData.confidence.toFixed(2)
            : null,
        updatedAt: new Date(),
      })
      .where(eq(dossiers.id, dossierId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.insert(dossierEvents).values({
        dossierId,
        step: "gather",
        status: "error",
        latencyMs: null,
        metadata: { error: message },
      });
      await db
        .update(dossiers)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(dossiers.id, dossierId));
    } catch {
      // Defense-in-depth: never let a pipeline error escape as an unhandled rejection.
      console.error("runPipeline: failed to record failure for dossier", dossierId, message);
    }
  }
}
