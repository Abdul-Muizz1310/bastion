import { randomUUID } from "node:crypto";
import { z } from "zod";
import { paperTrail } from "@/capabilities/paper-trail";
import { checkTranscript } from "@/features/tools/paper-trail/transcript-check";
import { callCapability } from "@/platform/gateway/call";
import { errorResponse, toResponse } from "@/platform/gateway/http";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `GET /api/platform/transcript-check?id=<uuid>` (spec 21 §5.1): paper-trail's signed transcript
 * and its published key, fetched through the gateway as the visitor under one request id (so the
 * audit trail shows both calls together), then checked: the hash recomputed, the Ed25519 signature
 * verified. The transcript's own failure is passed through as the gateway named it; a key that
 * cannot be fetched leaves the signature `unavailable`, never a pass.
 */

export const dynamic = "force-dynamic";

const debateId = z.uuid();

export async function GET(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const values = new URL(req.url).searchParams.getAll("id");
  const parsed = values.length === 1 ? debateId.safeParse(values[0]) : null;
  if (!parsed?.success) {
    return errorResponse(422, {
      error: "invalid_input",
      detail: "id: one debate id (a UUID)",
      requestId,
    });
  }

  const ctx = { actor: visitorFromRequest(req), requestId, clientIp: clientAddress(req) };
  const [transcript, key] = await Promise.all([
    callCapability(paperTrail.transcript, { id: parsed.data }, ctx),
    callCapability(paperTrail.receiptKey, {}, ctx),
  ]);
  if (!transcript.ok) return toResponse(transcript, false);

  const check = checkTranscript(transcript.data, key.ok ? key.data : null);
  return Response.json(
    { ...check, requestId },
    { headers: { "x-request-id": requestId, "cache-control": "no-store" } },
  );
}
