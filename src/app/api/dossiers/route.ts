import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { dossierCreateRequestSchema } from "@/features/dossier/schemas";
import { createDossier } from "@/features/dossier/server/create";
import { appendEvent } from "@/lib/audit/write";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CsrfError, validateCsrf } from "@/lib/auth/csrf";
import { AccessDeniedError } from "@/lib/auth/rbac";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import { gatewayLimiter } from "@/lib/rate-limit";

/**
 * Known magpie source slugs. In Block 4 this list can be driven by a live
 * registry lookup against magpie-backend; for now it's a small hardcoded set
 * that matches the YAML configs shipped in magpie.
 */
const KNOWN_SOURCES = new Set(["hackernews", "arxiv-cs", "weather-live"]);

export async function POST(request: NextRequest) {
  // 1. Auth
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1b. CSRF double-submit — plain route handlers do not get Next's Server
  // Action origin check, so this is the only defense beyond SameSite=Lax.
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
        metadata: { reason: err.message },
      });
      return NextResponse.json({ error: "CSRF validation failed" }, { status: 403 });
    }
    throw err;
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 422 });
  }
  const parsed = dossierCreateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // 3. Rate limit
  const rl = await gatewayLimiter.check(session.sid);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: rl.retryAfter },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } },
    );
  }

  // 4. Validate sources against the known magpie registry
  const unknownSource = parsed.data.sources.find((s) => !KNOWN_SOURCES.has(s));
  if (unknownSource) {
    return NextResponse.json({ error: `Unknown source: ${unknownSource}` }, { status: 422 });
  }

  // 5. Create + kick off pipeline
  try {
    const response = await createDossier(parsed.data, {
      id: session.user.id,
      role: session.user.role,
    });
    return NextResponse.json(response, { status: 202 });
  } catch (err) {
    if (err instanceof AccessDeniedError) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Unknown error — do not leak the message
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
