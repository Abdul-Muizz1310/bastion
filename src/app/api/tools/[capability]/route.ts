import { randomUUID } from "node:crypto";
import { type AnyCapability, capabilityById } from "@/capabilities";
import { callCapability } from "@/platform/gateway/call";
import { errorResponse, toResponse } from "@/platform/gateway/http";
import { clientAddress, visitorFromRequest } from "@/platform/visitor";

/**
 * `/api/tools/[capability]` (spec 21 §3–§5): every workbench action, through the one gateway.
 * GET capabilities read their input from the query string, every other method from a JSON body
 * sent with POST. Each call gets a fresh request id, the visitor as its actor and the visitor's
 * single address for `X-Forwarded-For`.
 */

export const dynamic = "force-dynamic";
// The slowest capability (a synchronous scrape) times out at 90 s.
export const maxDuration = 100;

/**
 * Reached only through their own callers (spec 21 §5): uploads go through `/api/uploads` (size and
 * type checks); a feathers delete only through the soft-delete proof, which deletes the user it
 * created itself — as a tool it would let any visitor delete any user (review fix 1); a dossier
 * envelope only through the runner — inkprint keeps one envelope per `dossier_id` and answers 409
 * to any other bundle, so a visitor sealing a running dossier's id first would fail its envelope
 * stage for good (final review). Every other capability is a read or spends the visitor's own
 * budget on something no dossier owns.
 */
const NOT_TOOLS: ReadonlyMap<string, string> = new Map([
  ["inkthread.upload", "use /api/uploads"],
  ["feathers.deleteUser", "use /api/platform/feathers-proof"],
  ["inkprint.envelope", "the dossier runner only"],
]);

type Verb = "GET" | "POST";
type Context = { params: Promise<{ capability: string }> };
type Input =
  | { ok: true; value: unknown }
  | { ok: false; status: number; error: string; detail: string };

const verbOf = (cap: AnyCapability): Verb => (cap.method === "GET" ? "GET" : "POST");

/** Query parameters as an object of strings; a repeated key is refused rather than guessed at. */
/** Every capability's input keys are plain identifiers; `__proto__` and friends are not. */
const PARAMETER_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

function queryInput(url: URL): Input {
  const value = new Map<string, string>();
  for (const [key, entry] of url.searchParams) {
    if (!PARAMETER_NAME.test(key)) {
      return { ok: false, status: 422, error: "invalid_input", detail: "not a parameter name" };
    }
    if (value.has(key)) {
      return { ok: false, status: 422, error: "invalid_input", detail: `${key}: repeated` };
    }
    value.set(key, entry);
  }
  return { ok: true, value: Object.fromEntries(value) };
}

/** A JSON body (declared as such, so a cross-site form cannot post one); empty means no input. */
async function bodyInput(req: Request): Promise<Input> {
  const mediaType = (req.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return {
      ok: false,
      status: 415,
      error: "unsupported_media_type",
      detail: "send application/json",
    };
  }
  const text = await req.text();
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 422, error: "invalid_input", detail: "body is not JSON" };
  }
}

async function handle(req: Request, ctx: Context, verb: Verb): Promise<Response> {
  const requestId = randomUUID();
  const { capability: id } = await ctx.params;
  const elsewhere = NOT_TOOLS.get(id);
  if (elsewhere !== undefined) {
    return errorResponse(404, { error: "not_a_tool", detail: elsewhere, requestId });
  }
  const cap = capabilityById(id);
  if (cap === undefined) return errorResponse(404, { error: "unknown_capability", requestId });
  if (verbOf(cap) !== verb) {
    return errorResponse(405, { error: "method_not_allowed", requestId }, { allow: verbOf(cap) });
  }

  const input = verb === "GET" ? queryInput(new URL(req.url)) : await bodyInput(req);
  if (!input.ok) {
    return errorResponse(input.status, { error: input.error, detail: input.detail, requestId });
  }
  const result = await callCapability(cap, input.value, {
    actor: visitorFromRequest(req),
    requestId,
    clientIp: clientAddress(req),
  });
  return toResponse(result, cap.raw !== undefined);
}

export async function GET(req: Request, ctx: Context): Promise<Response> {
  return handle(req, ctx, "GET");
}

export async function POST(req: Request, ctx: Context): Promise<Response> {
  return handle(req, ctx, "POST");
}
