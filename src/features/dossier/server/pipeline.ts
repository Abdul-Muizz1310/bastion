import crypto from "node:crypto";
import { z } from "zod/v4";
import type { DossierMode } from "@/features/dossier/schemas";
import { appendEvent } from "@/lib/audit/write";
import { withRole } from "@/lib/auth/rbac";
import { callService } from "@/lib/gateway/client";
import type { Role } from "@/lib/validation";

export type DossierRunInput = {
  userId: string;
  role: Role;
  claim: string;
  sources: string[];
  mode: DossierMode;
  requestId?: string;
};

export type DossierStepResult = {
  step: string;
  status: "ok" | "error";
  data?: unknown;
  error?: string;
};

export type TimelineEntry = {
  step: string;
  timestamp: Date;
  latencyMs: number;
};

export type Artifact = {
  title: string;
  type: string;
  data: unknown;
};

/**
 * A signed piece of evidence gathered by the pipeline: a scraped source item
 * (magpie) paired with the inkprint certificate that seals its content. These
 * become `evidence_items` rows so the verify endpoint can later re-check every
 * signature.
 */
export type EvidenceRow = {
  source: string;
  stableId: string;
  url: string;
  title: string;
  certificateId: string;
  contentHash: string;
};

export type DossierRunResult = {
  runId: string;
  requestId: string;
  steps: DossierStepResult[];
  artifacts: Artifact[];
  timeline: TimelineEntry[];
  evidence: EvidenceRow[];
};

const DOSSIER_STEPS = ["magpie", "inkprint", "paper-trail", "slowquery", "audit"] as const;

// Debate rounds per mode — mirrors the labels shown in DossierPrompt.tsx. The
// paper-trail platform endpoint caps this server-side, so higher values are safe.
const MODE_ROUNDS: Record<DossierMode, number> = { rapid: 3, standard: 5, adversarial: 8 };

// How many scraped items to sign + record as evidence per run. Bounds the
// number of downstream inkprint calls a single dossier can trigger.
const MAX_EVIDENCE_ITEMS = 3;
const MAX_ITEMS_PER_SOURCE = 5;

// ── Downstream response schemas — parse, don't trust ─────────────────────────

const magpieItemSchema = z.object({
  stable_id: z.string().min(1),
  url: z.string().default(""),
  title: z.string().default(""),
  content_text: z.string().default(""),
  content_hash: z.string().min(1),
});

const magpieBatchSchema = z.object({
  runs: z.array(z.object({ source: z.string(), items: z.array(magpieItemSchema) })),
  failed: z.array(z.object({ source: z.string(), error: z.string() })).default([]),
});

const inkprintCertSchema = z.object({ id: z.string().min(1) });

const paperTrailSchema = z.object({
  verdict: z.enum(["TRUE", "FALSE", "INCONCLUSIVE"]),
  confidence: z.number(),
});

type GatheredItem = {
  source: string;
  stableId: string;
  url: string;
  title: string;
  contentText: string;
  contentHash: string;
};

type StepContext = {
  claim: string;
  sources: string[];
  mode: DossierMode;
  actor: { id: string; role: Role };
  requestId: string;
  gatheredItems: GatheredItem[];
  evidence: EvidenceRow[];
};

export async function startDossierRun(input: DossierRunInput): Promise<DossierRunResult> {
  // Authorization goes through withRole rather than an inline role comparison
  // so the denial is audited (security.denied) like every other RBAC decision.
  await withRole(["admin", "editor"], { id: input.userId, role: input.role }, "dossier.run");

  const runId = crypto.randomUUID();
  const requestId = input.requestId ?? crypto.randomUUID();
  const steps: DossierStepResult[] = [];
  const timeline: TimelineEntry[] = [];
  const artifacts: Artifact[] = [];

  const ctx: StepContext = {
    claim: input.claim,
    sources: input.sources,
    mode: input.mode,
    actor: { id: input.userId, role: input.role },
    requestId,
    gatheredItems: [],
    evidence: [],
  };

  for (const stepName of DOSSIER_STEPS) {
    const start = Date.now();
    try {
      const data = await executeDossierStep(stepName, ctx);
      const latencyMs = Date.now() - start;

      steps.push({ step: stepName, status: "ok", data });
      timeline.push({ step: stepName, timestamp: new Date(start), latencyMs });

      await appendEvent({
        actorId: input.userId,
        action: `dossier.${stepName}.ok`,
        entityType: "dossier",
        entityId: runId,
        requestId,
        service: stepName === "audit" ? "bastion" : stepName,
      });

      // Collect artifacts from the steps whose output the result page renders.
      if (
        stepName === "magpie" ||
        stepName === "inkprint" ||
        stepName === "paper-trail" ||
        stepName === "slowquery"
      ) {
        artifacts.push({
          title: `${stepName} result`,
          type: stepName,
          data,
        });
      }
    } catch (err) {
      const latencyMs = Date.now() - start;
      const error = err instanceof Error ? err.message : "Unknown error";
      steps.push({ step: stepName, status: "error", error });
      timeline.push({ step: stepName, timestamp: new Date(start), latencyMs });

      await appendEvent({
        actorId: input.userId,
        action: `dossier.${stepName}.error`,
        entityType: "dossier",
        entityId: runId,
        requestId,
        service: stepName,
        metadata: { error },
      });

      // Stop on failure — don't run subsequent steps
      break;
    }
  }

  return { runId, requestId, steps, artifacts, timeline, evidence: ctx.evidence };
}

async function executeDossierStep(step: string, ctx: StepContext): Promise<unknown> {
  // Each step reaches its backend through the server-to-server gateway caller,
  // which mints its own short-lived Ed25519 platform JWT. This is NOT a loopback
  // fetch to /api/proxy (which requires the browser session cookie a detached
  // server fetch can never carry) — see gateway/client.ts.
  const { actor, requestId } = ctx;

  switch (step) {
    case "magpie": {
      const res = await callService("magpie", "/api/scrape/batch", {
        method: "POST",
        body: { sources: ctx.sources, max_items_per_source: MAX_ITEMS_PER_SOURCE },
        actor,
        requestId,
      });
      if (!res.ok) {
        throw new Error(`magpie scrape failed: ${res.error} (status ${res.status})`);
      }
      const parsed = magpieBatchSchema.parse(res.data);
      ctx.gatheredItems = parsed.runs.flatMap((run) =>
        run.items.map((it) => ({
          source: run.source,
          stableId: it.stable_id,
          url: it.url,
          title: it.title,
          contentText: it.content_text,
          contentHash: it.content_hash,
        })),
      );
      return parsed;
    }

    case "inkprint": {
      // Seal each gathered source item into a signed certificate and record it
      // as dossier evidence. Bounded to MAX_EVIDENCE_ITEMS downstream calls.
      const toSign = ctx.gatheredItems.slice(0, MAX_EVIDENCE_ITEMS);
      const certificates: { id: string }[] = [];
      for (const item of toSign) {
        const text = item.contentText || item.title || ctx.claim;
        const res = await callService("inkprint", "/certificates", {
          method: "POST",
          body: {
            text,
            author: "bastion",
            metadata: { source: item.source, stable_id: item.stableId },
          },
          actor,
          requestId,
        });
        if (!res.ok) {
          throw new Error(`inkprint sign failed: ${res.error} (status ${res.status})`);
        }
        const cert = inkprintCertSchema.parse(res.data);
        ctx.evidence.push({
          source: item.source,
          stableId: item.stableId,
          url: item.url,
          title: item.title,
          certificateId: cert.id,
          contentHash: item.contentHash,
        });
        certificates.push(cert);
      }
      return { signed: certificates.length, certificates };
    }

    case "paper-trail": {
      const res = await callService("paper-trail", "/platform/debate", {
        method: "POST",
        body: { claim: ctx.claim, max_rounds: MODE_ROUNDS[ctx.mode] },
        actor,
        requestId,
      });
      if (!res.ok) {
        throw new Error(`paper-trail debate failed: ${res.error} (status ${res.status})`);
      }
      return paperTrailSchema.parse(res.data);
    }

    case "slowquery": {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const res = await callService(
        "slowquery",
        `/_slowquery/queries?since=${encodeURIComponent(since)}`,
        { method: "GET", actor, requestId },
      );
      if (!res.ok) {
        throw new Error(`slowquery fetch failed: ${res.error} (status ${res.status})`);
      }
      return res.data;
    }

    case "audit":
      // Events for this request were appended by every prior step; nothing to
      // fetch downstream. Report the request id + how much evidence we sealed.
      return {
        requestId,
        message: "Audit events collected",
        evidenceCount: ctx.evidence.length,
      };

    /* v8 ignore next 2 */
    default:
      throw new Error(`Unknown dossier step: ${step}`);
  }
}
