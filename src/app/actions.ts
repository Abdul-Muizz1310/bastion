"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { demoSignIn, sendMagicLink } from "@/lib/auth/magic-link";
import { getSafeReturnTo } from "@/lib/auth/return-to";
import { COOKIE_NAME } from "@/lib/auth/session";
import type { Role } from "@/lib/validation";

export async function sendMagicLinkAction(
  formData: FormData,
): Promise<{ error?: string; sent?: boolean; magicLinkUrl?: string }> {
  const email = formData.get("email") as string;
  if (!email) return { error: "Email is required" };

  const rawReturnTo = formData.get("returnTo");
  const returnTo = typeof rawReturnTo === "string" ? rawReturnTo : undefined;

  try {
    const result = await sendMagicLink(email, returnTo);
    const isDemoMode = process.env.DEMO_MODE === "true";
    return {
      sent: true,
      magicLinkUrl: isDemoMode ? result.url : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send magic link" };
  }
}

export async function demoSignInAction(role: Role, returnTo?: string): Promise<void> {
  const result = await demoSignIn(role);
  const jar = await cookies();
  jar.set(COOKIE_NAME, result.session.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  redirect(getSafeReturnTo(returnTo, "/dashboard"));
}
