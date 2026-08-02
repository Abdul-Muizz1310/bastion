import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { CSRF_COOKIE_NAME, mintCsrfToken } from "@/lib/auth/csrf";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";
import { csrfLimiter } from "@/lib/rate-limit";

/**
 * Mint a double-submit CSRF token for the current session. Sets the token as a
 * non-httpOnly cookie (so client JS can echo it in the `x-csrf-token` header)
 * and returns it in the body. Mutating route handlers (POST /api/dossiers and
 * the gateway proxy) require the cookie and header to match a valid
 * HMAC-signed token.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Minting is cheap but not free (HMAC + Set-Cookie); throttle per session so
  // an authenticated client cannot spin the endpoint.
  const rl = await csrfLimiter.check(session.sid);
  if (!rl.success) {
    const retryAfter = rl.retryAfter ?? 60;
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const { token } = mintCsrfToken(session.sid);
  cookieStore.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  });

  return NextResponse.json({ token });
}
