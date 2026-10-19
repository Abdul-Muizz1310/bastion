import { type NextRequest, NextResponse } from "next/server";
import { securityHeaders } from "@/platform/security-headers";

/**
 * No sign-in (spec 21 §2): the proxy gates nothing. Every request passes through with the
 * security headers next.config.ts also declares — the proxy is the second layer that keeps
 * them on responses a config rule could miss.
 */
export function proxy(_request: NextRequest): NextResponse {
  const response = NextResponse.next();
  for (const { key, value } of securityHeaders(process.env.NODE_ENV)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|assets/).*)"],
};
