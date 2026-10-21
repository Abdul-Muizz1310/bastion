import { randomUUID } from "node:crypto";
import { chainTracer, newInvocationId } from "@/dossier/chain-trace";
import { driveDossier } from "@/dossier/drive-dossier";
import { dueDossiers } from "@/dossier/store";
import { isSweepAuthorized, sweepDue, sweepTokenFromEnv } from "@/dossier/sweep";
import { SYSTEM_ACTOR } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import { errorResponse } from "@/platform/gateway/http";

/**
 * `POST /api/dossiers/sweep` (spec 21 §6.2 "The sweep"): drives every pending or running dossier
 * whose frontier stage is due, oldest first, with the foreground loop, until about 280 s are spent;
 * answers `{swept: [{dossierId, stages, dossier, stopped}], ms}` — ids, stages and statuses only.
 * Called every 5 minutes by `.github/workflows/sweep.yml`. Gated by `Authorization: Bearer
 * <BASTION_SWEEP_TOKEN>` (constant-time; 503 when the token is not configured, 401 otherwise), so
 * it has no visitor limit. Its stage outcomes are audited by the runner as bastion, and the sweep
 * itself appends one `dossier.sweep` event.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const requestId = randomUUID();
  const expected = sweepTokenFromEnv(process.env);
  if (expected === null) {
    return errorResponse(503, { error: "sweep_unconfigured", requestId });
  }
  if (!isSweepAuthorized(req.headers.get("authorization"), expected)) {
    const refused = errorResponse(401, { error: "unauthorized", requestId });
    refused.headers.set("www-authenticate", "Bearer");
    return refused;
  }

  const invocation = newInvocationId();
  const deadlineMs = startedAt + maxDuration * 1000;
  let selected = 0;
  const swept = await sweepDue({
    due: async (now, limit) => {
      const ids = await dueDossiers(now, limit);
      selected = ids.length;
      await chainTracer({ event: "sweep.entry", dossierId: "sweep", invocation, selected });
      return ids;
    },
    drive: (dossierId, deadline) =>
      driveDossier(dossierId, {
        driver: "sweep",
        deadlineMs: deadline,
        invocation,
        emit: chainTracer,
      }),
    now: Date.now,
    deadlineMs,
  });
  const stages = swept.reduce((n, s) => n + s.stages.length, 0);
  await chainTracer({
    event: "sweep.done",
    dossierId: "sweep",
    invocation,
    driven: swept.length,
    stages,
    ms: Date.now() - startedAt,
  });
  try {
    await appendEvent({
      actor: SYSTEM_ACTOR,
      action: "dossier.sweep",
      entityType: "sweep",
      entityId: requestId,
      service: "bastion",
      requestId,
      metadata: { selected, driven: swept.length, stages },
    });
  } catch (err) {
    console.error("sweep: the audit event was not written", { requestId, err });
  }
  return Response.json(
    { swept, ms: Date.now() - startedAt },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
