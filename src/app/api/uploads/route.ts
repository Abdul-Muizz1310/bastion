import { randomUUID } from "node:crypto";
import { inkthread, MAX_UPLOAD_BYTES } from "@/capabilities/inkthread";
import { callCapability } from "@/platform/gateway/call";
import { errorResponse, toResponse } from "@/platform/gateway/http";
import { createRateLimiter } from "@/platform/ratelimit";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `POST /api/uploads` (spec 21 §3, §6.3): a visitor's PDF for inkthread. One multipart `file`, at
 * most 4 MB, whose first bytes are `%PDF-` (the bytes decide, not the declared type). The gateway
 * reserves the `upload` budget and releases it on a downstream 4xx; the visitor is the actor, so
 * the gateway's per-visitor limit applies, and their address is forwarded. 3 an hour per visitor.
 * The answer carries the `job_id` that `POST /api/dossiers` needs for an upload.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 70;

const uploadLimiter = createRateLimiter({ max: 3, windowMs: 3_600_000 });
const PDF_MAGIC = new TextEncoder().encode("%PDF-");
/** Multipart framing around the file: a declared length past this is refused unread. */
const FRAMING_SLACK_BYTES = 64 * 1024;

function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/** The last path component, so a client-sent `../x/a.pdf` never reaches inkthread as a path. */
function baseName(name: string): string {
  const last = name.split(/[\\/]/).pop() ?? "";
  const clean = last.replaceAll("..", "").trim();
  return clean === "" ? "upload.pdf" : clean.slice(0, 200);
}

export async function POST(req: Request): Promise<Response> {
  const requestId = randomUUID();
  const visitor = visitorFromRequest(req);

  const limit = await uploadLimiter.check(`upload:${visitor}`);
  if (!limit.success) {
    return errorResponse(429, {
      error: "rate_limited",
      retryAfterS: limit.retryAfter ?? 3600,
      requestId,
    });
  }

  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "multipart/form-data") {
    return errorResponse(415, {
      error: "unsupported_media_type",
      detail: "send multipart/form-data with a PDF in `file`",
      requestId,
    });
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES + FRAMING_SLACK_BYTES) {
    return errorResponse(413, { error: "payload_too_large", detail: "at most 4 MB", requestId });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return errorResponse(422, {
      error: "invalid_input",
      detail: "body is not multipart",
      requestId,
    });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return errorResponse(422, {
      error: "invalid_input",
      detail: "file: a PDF is required",
      requestId,
    });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return errorResponse(413, { error: "payload_too_large", detail: "at most 4 MB", requestId });
  }
  if (file.size === 0) {
    return errorResponse(422, {
      error: "invalid_input",
      detail: "file: must not be empty",
      requestId,
    });
  }
  const head = new Uint8Array(await file.slice(0, PDF_MAGIC.length).arrayBuffer());
  if (!hasPdfMagic(head)) {
    return errorResponse(415, {
      error: "unsupported_media_type",
      detail: "file is not a PDF",
      requestId,
    });
  }

  const result = await callCapability(
    inkthread.upload,
    { file, fileName: baseName(file.name) },
    { actor: visitor, requestId, clientIp: clientAddress(req) },
  );
  if (!result.ok) return toResponse(result, false);

  const { document, job, deduplicated } = result.data;
  // A deduplicated upload has no new job; its latest one is the reading the dossier can wait on.
  const jobId = job?.id ?? document.latest_job?.id ?? null;
  return Response.json(
    { document_id: document.id, job_id: jobId, deduplicated },
    { headers: { "cache-control": "no-store", "x-request-id": requestId } },
  );
}
