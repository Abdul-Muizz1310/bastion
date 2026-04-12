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

  // Check for session cookie
  const sessionCookie = request.cookies.get("bastion_session");
  if (!sessionCookie?.value) {
    // API routes get 401 JSON
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Page routes redirect to login
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // For demo mode, accept any session cookie and proceed
  // Full RBAC enforcement happens in Server Actions via withRole()
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
