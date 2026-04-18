import { type NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/auth/magic-link";
import { getSafeReturnTo } from "@/lib/auth/return-to";
import { COOKIE_NAME } from "@/lib/auth/session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  const returnTo = request.nextUrl.searchParams.get("returnTo");

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const result = await consumeMagicLink(token);
    if (!result) {
      return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
    }

    const destination = getSafeReturnTo(returnTo, "/dashboard");
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.set(COOKIE_NAME, result.session.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 24 * 60 * 60,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=server_error", request.url));
  }
}
