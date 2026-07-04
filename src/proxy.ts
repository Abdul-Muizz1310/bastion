import { type NextRequest, NextResponse } from "next/server";
import { verifySealedCookie } from "@/lib/auth/seal";

const PUBLIC_PATHS = new Set([
  "/",
  "/login",
  "/auth/callback",
  "/api/health",
  "/api/status",
  "/api/public-key",
]);

export function proxy(request: NextRequest) {
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
  if (!sessionCookie?.value || !verifySealedCookie(sessionCookie.value)) {
    // API routes get 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes redirect to login with returnTo preserving pathname + query
    const loginUrl = new URL("/login", request.url);
    const searchStr = request.nextUrl.searchParams.toString();
    const returnTo = searchStr ? `${pathname}?${searchStr}` : pathname;
    loginUrl.searchParams.set("returnTo", returnTo);
    return NextResponse.redirect(loginUrl);
  }

  // Full RBAC enforcement happens in Server Actions via withRole()
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
