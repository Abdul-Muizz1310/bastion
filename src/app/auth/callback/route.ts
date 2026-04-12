import { type NextRequest, NextResponse } from "next/server";
import { consumeMagicLink } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/session";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const result = await consumeMagicLink(token);
    if (!result) {
      return NextResponse.redirect(new URL("/login?error=invalid_token", request.url));
    }

    const response = NextResponse.redirect(new URL("/dashboard", request.url));
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
