import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { appendEvent } from "@/lib/audit/write";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CsrfError, validateCsrf } from "@/lib/auth/csrf";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import { mintPlatformJwt, parseRequestId, resolveService } from "@/lib/gateway/jwt";
import { gatewayLimiter } from "@/lib/rate-limit";

const TIMEOUT_MS = 30_000;
const KEY_ID = process.env.BASTION_KEY_ID ?? "bastion-ed25519-2026-04";

const HOP_BY_HOP_RESPONSE = new Set(["transfer-encoding", "content-encoding", "connection"]);
const STRIPPED_REQUEST = new Set(["cookie", "authorization", "host", "content-length"]);
/** Verbs that cannot change downstream state — exempt from CSRF (spec 04). */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ service: string; path: string[] }> },
) {
  const { service: serviceId, path } = await params;
  const pathJoined = path.join("/");
  const entityId = `${serviceId}:${pathJoined}`;
  const requestId = parseRequestId(request.headers.get("x-request-id"));
  const start = Date.now();

  // 1. Auth
  const cookieStore = await cookies();
  const cookie = cookieStore.get(COOKIE_NAME);
  const session = await getSession(cookie?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1b. CSRF double-submit on state-changing verbs. This is a plain route
  // handler, so it gets none of Next's Server Action origin checking — without
  // this, SameSite=Lax is the only thing standing between a cross-site form
  // and an authenticated POST/PUT/PATCH/DELETE to any downstream service.
  const isMutating = !SAFE_METHODS.has(request.method.toUpperCase());
  if (isMutating) {
    try {
      validateCsrf(
        cookieStore.get(CSRF_COOKIE_NAME)?.value,
        request.headers.get(CSRF_HEADER_NAME) ?? undefined,
      );
    } catch (err) {
      if (err instanceof CsrfError) {
        await appendEvent({
          actorId: session.user.id,
          action: "security.csrf_failed",
          entityType: "session",
          entityId: session.sid,
          service: "bastion",
          requestId,
          metadata: { reason: err.message },
        });
        return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
      }
      throw err;
    }
  }

  // 2. Resolve service
  let service: { id: string; backendUrl: string };
  try {
    service = resolveService(serviceId);
  } catch {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId,
      service: serviceId,
      requestId,
      metadata: { reason: "unknown_service" },
    });
    return NextResponse.json({ error: "Unknown service" }, { status: 404 });
  }

  // 3. Rate limit (keyed by session sid)
  const rl = await gatewayLimiter.check(session.sid);
  if (!rl.success) {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId,
      service: serviceId,
      requestId,
      metadata: { reason: "rate_limited" },
    });
    const retryAfter = rl.retryAfter ?? 60;
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  // 4. Mint short-lived JWT
  let jwt: string;
  try {
    jwt = await mintPlatformJwt({
      sub: session.user.id,
      role: session.user.role,
      service: serviceId,
    });
  } catch {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId,
      service: serviceId,
      requestId,
      metadata: { reason: "jwt_mint_failed" },
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }

  // 5. Build forward request
  const targetUrl = `${service.backendUrl}/${pathJoined}${request.nextUrl.search}`;
  const forwardHeaders = new Headers();
  for (const [k, v] of request.headers.entries()) {
    if (STRIPPED_REQUEST.has(k.toLowerCase())) continue;
    forwardHeaders.set(k, v);
  }
  forwardHeaders.set("authorization", `Bearer ${jwt}`);
  forwardHeaders.set("x-request-id", requestId);
  forwardHeaders.set("x-platform-key-id", KEY_ID);

  const hasBody = !["GET", "HEAD"].includes(request.method.toUpperCase());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let downstream: Response;
  try {
    downstream = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      body: hasBody ? await request.arrayBuffer() : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId,
      service: serviceId,
      requestId,
      metadata: { reason: isAbort ? "timeout" : "network_error" },
    });
    return NextResponse.json({ error: "Gateway Timeout" }, { status: 504 });
  }
  clearTimeout(timer);

  const latencyMs = Date.now() - start;

  // 6. Map downstream 5xx → 502 (but let 4xx pass through)
  if (downstream.status >= 500) {
    await appendEvent({
      actorId: session.user.id,
      action: "gateway.proxy.error",
      entityType: "proxy",
      entityId,
      service: serviceId,
      requestId,
      metadata: { status: 502, downstreamStatus: downstream.status, latencyMs },
    });
    return NextResponse.json({ error: "Bad Gateway" }, { status: 502 });
  }

  // 7. Pass through (2xx and 4xx) — audit as ok
  await appendEvent({
    actorId: session.user.id,
    action: "gateway.proxy.ok",
    entityType: "proxy",
    entityId,
    service: serviceId,
    requestId,
    metadata: { status: downstream.status, latencyMs },
  });

  const responseHeaders = new Headers();
  for (const [k, v] of downstream.headers.entries()) {
    if (HOP_BY_HOP_RESPONSE.has(k.toLowerCase())) continue;
    responseHeaders.set(k, v);
  }
  responseHeaders.set("x-request-id", requestId);

  return new NextResponse(downstream.body, {
    status: downstream.status,
    headers: responseHeaders,
  });
}

export { handler as DELETE, handler as GET, handler as PATCH, handler as POST, handler as PUT };
