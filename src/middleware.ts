import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/auth/callback",
  "/api/health",
  "/api/status",
  "/api/public-key",
]);
const _ADMIN_ONLY = new Set(["/time-travel"]);
const _ADMIN_EDITOR = new Set(["/run", "/audit"]);

function verifySessionCookie(cookie: string): boolean {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const sid = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);
  if (!sid || !sig) return false;
  const password = process.env.IRON_SESSION_PASSWORD ?? "";
  if (password.length < 32) return false;
  const hmac = crypto.createHmac("sha256", password);
  hmac.update(sid);
  const expected = hmac.digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expected, "base64url");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public routes — no auth needed
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/api/status") ||
    pathname.startsWith("/api/public-key")
  ) {
    return NextResponse.next();
  }

  // Check for session cookie and verify HMAC
  const sessionCookie = request.cookies.get("bastion_session");
  if (!sessionCookie?.value || !verifySessionCookie(sessionCookie.value)) {
    // API routes get 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Full RBAC enforcement happens in Server Actions via withRole()
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
