import type { NextRequest } from "next/server";
import type { StepRow } from "@/dossier/stages";
import { findDossier, loadSteps } from "@/dossier/store";
import { sortByStage, stepFingerprint, stepView } from "@/features/dossier/step-view";
import type { Dossier } from "@/lib/db/schema";

/**
 * `GET /api/dossiers/[id]/stream` (spec 21 §6.6, "The live run"): a dossier's progress as
 * server-sent events, polled from the database every 2 s. Public: anyone holding the id may follow
 * it. Each tick reads the dossier first, then its `dossier_steps` rows (the runner updates the
 * dossier's status in the same transaction as the step that ends it, so a terminal status is never
 * seen before that step), and sends:
 *
 * - `step` for every row on the first tick and each row that changed since (`stepView`: never the
 *   row's output, only a note about it);
 * - `status` on the first tick and whenever the status, verdict or confidence change;
 * - `done` once the status is succeeded or failed — then the stream ends;
 * - `heartbeat` every 15 s, and `timeout` after 140 polls, so the stream always ends cleanly inside
 *   `maxDuration`; the page reconnects. A client that disconnects stops the polling.
 *
 * A database error mid-stream ends it with `stream_error` naming nothing of the cause (an
 * EventSource's own `error` event cannot carry data, hence not that name).
 */

export const dynamic = "force-dynamic";
// 140 polls 2 s apart, plus each poll's two reads, end well inside this.
export const maxDuration = 300;

type StatusRow = Pick<Dossier, "status" | "verdict" | "confidence">;

export type StreamDeps = {
  dossierFn: (id: string) => Promise<StatusRow | null>;
  stepsFn: (id: string) => Promise<StepRow[]>;
};

export type StreamConfig = {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxIterations?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Aborted when the client goes away: the loop stops before its next read. */
  signal?: AbortSignal;
};

export function formatSseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

function statusOf(row: StatusRow) {
  const confidence = row.confidence === null ? null : Number(row.confidence);
  return {
    status: row.status,
    verdict: row.verdict,
    confidence: confidence !== null && Number.isFinite(confidence) ? confidence : null,
  };
}

const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed"]);

export async function* streamDossier(
  dossierId: string,
  deps: StreamDeps,
  config: StreamConfig = {},
): AsyncGenerator<string, void, unknown> {
  const pollIntervalMs = config.pollIntervalMs ?? 2_000;
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 15_000;
  const maxIterations = config.maxIterations ?? 140;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const signal = config.signal;

  const sent = new Map<string, string>();
  let lastStatus: string | null = null;
  let lastHeartbeat = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    if (signal?.aborted) return;
    const dossier = await deps.dossierFn(dossierId);
    if (dossier === null) {
      yield formatSseEvent("done", { status: "failed", reason: "dossier_deleted" });
      return;
    }
    const steps = await deps.stepsFn(dossierId);
    if (signal?.aborted) return;

    for (const view of sortByStage(steps.map(stepView))) {
      const fingerprint = stepFingerprint(view);
      if (sent.get(view.stage) === fingerprint) continue;
      sent.set(view.stage, fingerprint);
      yield formatSseEvent("step", view);
    }

    const status = statusOf(dossier);
    const key = JSON.stringify(status);
    if (key !== lastStatus) {
      lastStatus = key;
      yield formatSseEvent("status", status);
    }

    if (TERMINAL.has(dossier.status)) {
      yield formatSseEvent("done", status);
      return;
    }

    if (Date.now() - lastHeartbeat >= heartbeatIntervalMs) {
      yield formatSseEvent("heartbeat", { t: new Date().toISOString() });
      lastHeartbeat = Date.now();
    }
    await sleep(pollIntervalMs);
  }
  yield formatSseEvent("timeout", {});
}

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Context): Promise<Response> {
  const { id } = await ctx.params;
  const dossier = await findDossier(id);
  if (dossier === null) {
    return Response.json(
      { error: "unknown_dossier" },
      { status: 404, headers: { "cache-control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  const gone = new AbortController();
  request.signal?.addEventListener("abort", () => gone.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Once the client has gone the controller is closed: writing to it would throw.
      const send = (chunk: string) => {
        if (!gone.signal.aborted) controller.enqueue(encoder.encode(chunk));
      };
      try {
        for await (const chunk of streamDossier(
          dossier.id,
          { dossierFn: findDossier, stepsFn: loadSteps },
          { signal: gone.signal },
        )) {
          send(chunk);
        }
      } catch (err) {
        console.error("dossier stream failed", { dossierId: dossier.id, err });
        send(formatSseEvent("stream_error", { error: "stream_error" }));
      } finally {
        if (!gone.signal.aborted) controller.close();
      }
    },
    cancel() {
      gone.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
