import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { actorSchema, SYSTEM_ACTOR } from "@/platform/audit/event";
import { appendEvent } from "@/platform/audit/write";
import {
  type BudgetKey,
  releaseBudget,
  reserveBudget,
  secondsUntilUtcMidnight,
} from "@/platform/budget";
import { createRateLimiter } from "@/platform/ratelimit";
import { isServiceId, SERVICES, type ServiceId } from "@/platform/registry/products";
import type { VisitorId } from "@/platform/visitor";
import {
  GATEWAY_ERROR_STATUS,
  type GatewayError,
  type GatewayResult,
  RAW_CONTENT_TYPES,
  type RawBody,
  type RawKind,
} from "./result";
import { type Grant, mintToken, tokenClaims } from "./token";

/**
 * The one gateway pipeline (spec 21 §4). Every call to a downstream service goes through
 * `callCapability`, in this order:
 *
 *   parse input → build a canonical request → per-visitor rate limit → reserve the daily budget →
 *   mint a contract-v2 token → call (X-Request-Id, X-Forwarded-For = the visitor's address) →
 *   parse the response → append exactly one `gateway.call` audit event → return a typed
 *   `GatewayResult`.
 *
 * Refusals that cost nothing — `invalid_input` and the gateway's own `rate_limited` — are not
 * audited (Ruling H): they would let one visitor grow the append-only log without bound. Each is
 * one structured console line instead. Every call that reaches the budget is audited.
 *
 * Downstream failures are results, never throws. Throws are bastion's own bugs (a malformed
 * capability or context) and configuration errors (no signing key), raised before any side effect
 * except where noted.
 */

export type Capability<I, O> = {
  id: string;
  /** The service the capability belongs to, and where it is called unless `routeTo` says. */
  service: ServiceId;
  /**
   * The service one call goes to, when that depends on the input (slowquery's routes are installed
   * in several services). The token's audience and the audit event follow it.
   */
  routeTo?: (input: I) => ServiceId;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: (input: I) => string;
  /** JSON-serialised, or a `FormData` passed through as multipart. Never on a GET. */
  body?: (input: I) => unknown;
  input: z.ZodType<I>;
  /** Parses the downstream body; for a `raw` capability it parses the `RawBody` (`rawBodySchema`). */
  output: z.ZodType<O>;
  /** The role minted into the token. */
  grant: Grant;
  cost: "free" | "quota" | "llm";
  /** Required when `cost` is `llm`: model calls are the scarcest thing the platform spends. */
  budget?: BudgetKey;
  /** A per-visitor limit for this capability, on top of the gateway's 30 calls a minute. */
  perVisitorPerMin?: number;
  timeoutMs?: number;
  /** Pass the bytes through (skip JSON); the content type must match the kind. */
  raw?: RawKind;
};

export type CallContext = {
  actor: VisitorId | typeof SYSTEM_ACTOR;
  requestId: string;
  /** The visitor's address as bastion resolved it — never a client-supplied header chain. */
  clientIp?: string;
};

export const VISITOR_CALLS_PER_MIN = 30;
export const DEFAULT_TIMEOUT_MS = 30_000;

const RATE_WINDOW_MS = 60_000;
const DEFAULT_RETRY_AFTER_S = 60;
const MAX_RETRY_AFTER_S = 86_400;
const DETAIL_MAX = 200;
const MAX_ISSUES = 5;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

// ---- guards: programming errors throw before any side effect ---------------------------------

function assertContext(ctx: CallContext): void {
  if (!actorSchema.safeParse(ctx.actor).success) {
    throw new TypeError("callCapability: actor must be a visitor id (v_…) or bastion");
  }
  if (typeof ctx.requestId !== "string" || !REQUEST_ID.test(ctx.requestId)) {
    throw new TypeError("callCapability: requestId must be 1–128 characters of [A-Za-z0-9._:-]");
  }
  if (ctx.clientIp !== undefined && isIP(ctx.clientIp) === 0) {
    throw new TypeError("callCapability: clientIp must be a single IPv4 or IPv6 address");
  }
}

function isPositiveInteger(n: number | undefined): boolean {
  return n === undefined || (Number.isSafeInteger(n) && n > 0);
}

function assertCapability<I, O>(cap: Capability<I, O>): void {
  if (cap.id.length === 0) throw new TypeError("capability: id must not be empty");
  if (!isServiceId(cap.service)) throw new TypeError(`capability ${cap.id}: unknown service`);
  if (!isPositiveInteger(cap.timeoutMs) || !isPositiveInteger(cap.perVisitorPerMin)) {
    throw new TypeError(`capability ${cap.id}: timeoutMs and perVisitorPerMin must be positive`);
  }
  if (cap.raw !== undefined && !Object.hasOwn(RAW_CONTENT_TYPES, cap.raw)) {
    throw new TypeError(`capability ${cap.id}: unknown raw kind`);
  }
  if (cap.cost === "llm" && cap.budget === undefined) {
    throw new TypeError(`capability ${cap.id}: an llm capability needs a daily budget`);
  }
}

function routedService<I, O>(cap: Capability<I, O>, input: I): ServiceId {
  const service = cap.routeTo?.(input) ?? cap.service;
  if (!isServiceId(service)) {
    throw new TypeError(`capability ${cap.id}: routed to an unknown service`);
  }
  return service;
}

// ---- pure core -------------------------------------------------------------------------------

type Outbound = { url: string; method: Capability<unknown, unknown>["method"]; body?: BodyInit };

type Built = { ok: true; request: Outbound } | { ok: false; detail: string };

/** `.` or `..`, spelled plainly or with `%2e` in either case — what a URL parser resolves away. */
function isDotSegment(segment: string): boolean {
  const decoded = segment.replace(/%2e/gi, ".");
  return decoded === "." || decoded === "..";
}

/**
 * The path as sent must be the path as built: no dot segment (the request would land on another
 * route), and nothing the URL parser rewrites (a space, a backslash, a `#`, a non-ASCII letter).
 */
function canonicalUrl(baseUrl: string, path: string): URL | null {
  const pathname = path.split(/[?#]/, 1)[0] ?? "";
  if (pathname.split("/").some(isDotSegment)) return null;
  const base = new URL(baseUrl);
  let url: URL;
  try {
    url = new URL(`${baseUrl}${path}`);
  } catch {
    return null;
  }
  const expected = `${base.pathname.replace(/\/$/, "")}${path}`;
  return url.origin === base.origin && `${url.pathname}${url.search}` === expected ? url : null;
}

function buildRequest<I, O>(cap: Capability<I, O>, service: ServiceId, input: I): Built {
  const path = cap.path(input);
  // The base URL carries no trailing slash (products.ts), so a leading "/" can never move the
  // request to another origin ("https://host" + "@evil/x" would).
  if (!path.startsWith("/")) throw new TypeError(`capability ${cap.id}: path must start with /`);
  const url = canonicalUrl(SERVICES[service].baseUrl, path);
  if (url === null) return { ok: false, detail: "path: not a canonical URL path" };
  const payload = cap.body?.(input);
  if (payload === undefined) return { ok: true, request: { url: url.href, method: cap.method } };
  if (cap.method === "GET") throw new TypeError(`capability ${cap.id}: a GET carries no body`);
  return {
    ok: true,
    request: {
      url: url.href,
      method: cap.method,
      body: payload instanceof FormData ? payload : JSON.stringify(payload),
    },
  };
}

function truncate(text: string): string {
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/** Issue paths (and, for the visitor's own input, messages) — never the offending values. */
function describeIssues(error: z.ZodError, withMessages: boolean): string {
  const parts = error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".") || "(root)";
    return `${path}: ${withMessages ? issue.message : issue.code}`;
  });
  return truncate(parts.join("; "));
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** FastAPI's `{"detail": "..."}`; any other error body is reduced to its status. */
const errorBody = z.object({ detail: z.string().min(1) });

function downstreamDetail(body: Uint8Array, status: number): string {
  const json = parseJson(new TextDecoder().decode(body));
  const parsed = json.ok ? errorBody.safeParse(json.value) : null;
  return parsed?.success ? truncate(parsed.data.detail) : `HTTP ${status}`;
}

function retryAfterSeconds(header: string | null, now: number): number {
  if (header === null) return DEFAULT_RETRY_AFTER_S;
  const seconds = /^\d+$/.test(header.trim())
    ? Number(header.trim())
    : Math.ceil((Date.parse(header) - now) / 1000);
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_S;
  return Math.min(MAX_RETRY_AFTER_S, Math.max(1, seconds));
}

type Sent =
  | { kind: "response"; status: number; headers: Headers; body: Uint8Array<ArrayBuffer> }
  | { kind: "timeout" }
  | { kind: "network_error" };

type Outcome<O> =
  | { ok: true; data: O; status: number }
  | { ok: false; error: GatewayError; status?: number; detail?: string; retryAfterS?: number };

type Interpreted<O> = { outcome: Outcome<O>; release: boolean };

/** The refusals that happen before the budget, and so are logged rather than audited. */
type Refusal = {
  ok: false;
  error: "invalid_input" | "rate_limited";
  detail?: string;
  retryAfterS?: number;
};

function parseSuccess<I, O>(
  cap: Capability<I, O>,
  sent: Extract<Sent, { kind: "response" }>,
): Outcome<O> {
  let candidate: unknown;
  if (cap.raw !== undefined) {
    const contentType = sent.headers.get("content-type") ?? "";
    const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!RAW_CONTENT_TYPES[cap.raw].includes(mediaType)) {
      return { ok: false, error: "invalid_response", detail: `unexpected content type` };
    }
    candidate = { contentType, bytes: sent.body } satisfies RawBody;
  } else {
    const json = parseJson(new TextDecoder().decode(sent.body));
    if (!json.ok) return { ok: false, error: "invalid_response", detail: "not_json" };
    candidate = json.value;
  }
  const parsed = cap.output.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: "invalid_response", detail: describeIssues(parsed.error, false) };
  }
  return { ok: true, data: parsed.data, status: sent.status };
}

/** Pure: what a downstream answer means, and whether the reserved budget goes back. */
function interpret<I, O>(cap: Capability<I, O>, sent: Sent, now: number): Interpreted<O> {
  if (sent.kind === "timeout") return { outcome: { ok: false, error: "asleep" }, release: false };
  if (sent.kind === "network_error") {
    return {
      outcome: { ok: false, error: "downstream_error", detail: "network_error" },
      release: false,
    };
  }
  const { status } = sent;
  if (status === 429) {
    const retryAfterS = retryAfterSeconds(sent.headers.get("retry-after"), now);
    return { outcome: { ok: false, error: "rate_limited", retryAfterS }, release: true };
  }
  if (status >= 400 && status < 500) {
    // The caller's mistake: nothing was spent, and the visitor sees the backend's own reason.
    const detail = downstreamDetail(sent.body, status);
    return { outcome: { ok: false, error: "downstream_error", status, detail }, release: true };
  }
  if (status >= 300 && status < 400) {
    // Never followed: a redirect would carry the platform token to wherever it points.
    return {
      outcome: { ok: false, error: "downstream_error", detail: "unexpected_redirect" },
      release: false,
    };
  }
  if (status < 200 || status >= 300) {
    // A 5xx may have spent quota (an LLM call that crashed late): the budget stays reserved.
    return {
      outcome: { ok: false, error: "downstream_error", detail: `HTTP ${status}` },
      release: false,
    };
  }
  return { outcome: parseSuccess(cap, sent), release: false };
}

// ---- imperative shell ------------------------------------------------------------------------

const limiters = new Map<number, ReturnType<typeof createRateLimiter>>();

function limiter(max: number): ReturnType<typeof createRateLimiter> {
  let found = limiters.get(max);
  if (!found) {
    found = createRateLimiter({ max, windowMs: RATE_WINDOW_MS });
    limiters.set(max, found);
  }
  return found;
}

/** Seconds to wait when a limit is hit, else null. System work (the runner) is not rate-limited. */
async function rateLimited<I, O>(cap: Capability<I, O>, ctx: CallContext): Promise<number | null> {
  if (ctx.actor === SYSTEM_ACTOR) return null;
  const visitor = await limiter(VISITOR_CALLS_PER_MIN).check(`gateway:${ctx.actor}`);
  if (!visitor.success) return visitor.retryAfter ?? DEFAULT_RETRY_AFTER_S;
  if (cap.perVisitorPerMin !== undefined) {
    const own = await limiter(cap.perVisitorPerMin).check(`gateway:${cap.id}:${ctx.actor}`);
    if (!own.success) return own.retryAfter ?? DEFAULT_RETRY_AFTER_S;
  }
  return null;
}

async function send(request: Outbound, headers: Headers, timeoutMs: number): Promise<Sent> {
  try {
    const res = await fetch(request.url, {
      method: request.method,
      headers,
      body: request.body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
      cache: "no-store",
    });
    const body = new Uint8Array(await res.arrayBuffer());
    return { kind: "response", status: res.status, headers: res.headers, body };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return name === "TimeoutError" || name === "AbortError"
      ? { kind: "timeout" }
      : { kind: "network_error" };
  }
}

function outboundHeaders<I, O>(
  cap: Capability<I, O>,
  request: Outbound,
  token: string,
  ctx: CallContext,
): Headers {
  const headers = new Headers({
    accept: cap.raw === undefined ? "application/json" : RAW_CONTENT_TYPES[cap.raw].join(", "),
    authorization: `Bearer ${token}`,
    "x-platform-token": token,
    "x-request-id": ctx.requestId,
  });
  if (ctx.clientIp !== undefined) headers.set("x-forwarded-for", ctx.clientIp);
  if (typeof request.body === "string") headers.set("content-type", "application/json");
  return headers;
}

/** Exactly one event per audited call: service, capability, status, latency — never a body. */
async function audit<I, O>(
  cap: Capability<I, O>,
  service: ServiceId,
  ctx: CallContext,
  result: GatewayResult<O>,
  ms: number,
): Promise<void> {
  const metadata: Record<string, unknown> = { status: result.status, ms, ok: result.ok };
  if (!result.ok) metadata.error = result.error;
  try {
    await appendEvent({
      actor: ctx.actor,
      action: "gateway.call",
      entityType: "capability",
      entityId: cap.id,
      service,
      requestId: ctx.requestId,
      metadata,
    });
  } catch (err) {
    console.error(`gateway: audit append failed for ${cap.id}`, err);
  }
}

/** Ruling H: a refusal that cost nothing is one log line, not an audit row — and never a body. */
function logRefusal<I, O>(
  cap: Capability<I, O>,
  service: ServiceId,
  ctx: CallContext,
  error: Refusal["error"],
  status: number,
): void {
  console.warn(
    JSON.stringify({
      event: "gateway.refused",
      capability: cap.id,
      service,
      actor: ctx.actor,
      requestId: ctx.requestId,
      error,
      status,
    }),
  );
}

export async function callCapability<I, O>(
  cap: Capability<I, O>,
  input: unknown,
  ctx: CallContext,
): Promise<GatewayResult<O>> {
  const started = performance.now();
  assertContext(ctx);
  assertCapability(cap);

  const elapsed = () => Math.round(performance.now() - started);
  const toResult = (outcome: Outcome<O>, ms: number): GatewayResult<O> =>
    outcome.ok
      ? { ok: true, data: outcome.data, status: outcome.status, requestId: ctx.requestId, ms }
      : {
          ok: false,
          error: outcome.error,
          status: outcome.status ?? GATEWAY_ERROR_STATUS[outcome.error],
          requestId: ctx.requestId,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
          ...(outcome.retryAfterS === undefined ? {} : { retryAfterS: outcome.retryAfterS }),
        };
  const refuse = (service: ServiceId, outcome: Refusal): GatewayResult<O> => {
    const result = toResult(outcome, elapsed());
    logRefusal(cap, service, ctx, outcome.error, result.status);
    return result;
  };

  const parsed = cap.input.safeParse(input);
  if (!parsed.success) {
    return refuse(cap.service, {
      ok: false,
      error: "invalid_input",
      detail: describeIssues(parsed.error, true),
    });
  }
  const service = routedService(cap, parsed.data);
  const built = buildRequest(cap, service, parsed.data);
  if (!built.ok)
    return refuse(service, { ok: false, error: "invalid_input", detail: built.detail });
  const { request } = built;

  const retryAfterS = await rateLimited(cap, ctx);
  if (retryAfterS !== null)
    return refuse(service, { ok: false, error: "rate_limited", retryAfterS });

  const finish = async (outcome: Outcome<O>): Promise<GatewayResult<O>> => {
    const ms = elapsed();
    const result = toResult(outcome, ms);
    await audit(cap, service, ctx, result, ms);
    return result;
  };

  // One instant for the reservation and its release, so both hit the same UTC day's counter.
  const day = new Date();
  const budget = cap.budget;
  if (budget !== undefined) {
    const reserved = await reserveBudget(budget, 1, day);
    if (!reserved.ok) {
      return finish({
        ok: false,
        error: "budget_exhausted",
        retryAfterS: secondsUntilUtcMidnight(day),
      });
    }
  }
  const release = async () => {
    if (budget !== undefined) await releaseBudget(budget, 1, day);
  };

  let token: string;
  try {
    token = await mintToken(
      tokenClaims({
        service,
        sub: ctx.actor,
        role: cap.grant,
        cap: cap.id,
        nowS: Math.floor(Date.now() / 1000),
        jti: randomUUID(),
      }),
    );
  } catch (err) {
    await release();
    throw err;
  }

  const sent = await send(
    request,
    outboundHeaders(cap, request, token, ctx),
    cap.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const { outcome, release: shouldRelease } = interpret(cap, sent, Date.now());
  if (shouldRelease) await release();
  return finish(outcome);
}
