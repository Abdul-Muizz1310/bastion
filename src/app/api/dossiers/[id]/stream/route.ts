import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getDossier, listDossierEvents } from "@/features/dossier/server/query";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import type { Dossier, DossierEvent as DossierEventRow } from "@/lib/db/schema";

/**
 * Format a single SSE event. Pure — no I/O.
 */
export function formatSseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type StreamConfig = {
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxIterations?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type StreamDeps = {
  getDossierFn: (id: string) => Promise<Dossier | null>;
  listEventsFn: (id: string, sinceAt?: Date) => Promise<DossierEventRow[]>;
};

/**
 * Core streaming loop as an async generator. Yields SSE-formatted strings.
 * Pure-ish: all I/O is injected via deps, making this fully testable.
 */
export async function* streamDossierEvents(
  dossierId: string,
  initialDossier: Dossier,
  deps: StreamDeps,
  config: StreamConfig = {},
): AsyncGenerator<string, void, unknown> {
  const pollIntervalMs = config.pollIntervalMs ?? 1000;
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 15_000;
  const maxIterations = config.maxIterations ?? 180;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastSeenAt = new Date(0);
  let lastStatus = initialDossier.status;
  let lastHeartbeat = Date.now();

  for (let i = 0; i < maxIterations; i++) {
    // 1. Emit new events
    const events = await deps.listEventsFn(dossierId, lastSeenAt);
    for (const ev of events) {
      yield formatSseEvent("state", ev);
      const atDate = ev.at instanceof Date ? ev.at : new Date(ev.at);
      if (atDate > lastSeenAt) lastSeenAt = atDate;
    }

    // 2. Check current dossier state
    const current = await deps.getDossierFn(dossierId);
    if (!current) {
      // Dossier deleted mid-stream — emit done and close
      yield formatSseEvent("done", { status: "failed", reason: "dossier_deleted" });
      return;
    }

    if (current.status !== lastStatus) {
      yield formatSseEvent("status", {
        status: current.status,
        verdict: current.verdict,
        confidence: current.confidence,
      });
      lastStatus = current.status;
    }

    // 3. Terminal state — emit done and stop
    if (current.status === "succeeded" || current.status === "failed") {
      yield formatSseEvent("done", {
        status: current.status,
        verdict: current.verdict,
        confidence: current.confidence,
      });
      return;
    }

    // 4. Heartbeat
    if (Date.now() - lastHeartbeat >= heartbeatIntervalMs) {
      yield formatSseEvent("heartbeat", { t: new Date().toISOString() });
      lastHeartbeat = Date.now();
    }

    await sleep(pollIntervalMs);
  }

  // Hard cap reached
  yield formatSseEvent("timeout", {});
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 1. Auth
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Dossier must exist
  const dossier = await getDossier(id);
  if (!dossier) {
    return NextResponse.json({ error: "Dossier not found" }, { status: 404 });
  }

  // 3. Build the streaming response
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamDossierEvents(id, dossier, {
          getDossierFn: getDossier,
          listEventsFn: listDossierEvents,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            formatSseEvent("error", {
              message: err instanceof Error ? err.message : "stream_error",
            }),
          ),
        );
      } finally {
        controller.close();
      }
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
