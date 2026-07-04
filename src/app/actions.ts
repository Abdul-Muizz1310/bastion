"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod/v4";
import { demoSignIn, sendMagicLink } from "@/lib/auth/magic-link";
import { getSafeReturnTo } from "@/lib/auth/return-to";
import { COOKIE_NAME } from "@/lib/auth/session";
import { authLimiter } from "@/lib/rate-limit";
import type { Role } from "@/lib/validation";

// Parse, don't validate: the email is checked at the Server Action boundary
// with the same Zod primitive used for user inserts, not a hand-rolled string
// test. `FormData.get` may return `File | null`, both of which Zod rejects.
const magicLinkFormSchema = z.object({
  email: z.email(),
  returnTo: z.string().optional(),
});

export async function sendMagicLinkAction(
  formData: FormData,
): Promise<{ error?: string; sent?: boolean; magicLinkUrl?: string }> {
  const rawReturnTo = formData.get("returnTo");
  const parsed = magicLinkFormSchema.safeParse({
    email: formData.get("email"),
    returnTo: typeof rawReturnTo === "string" ? rawReturnTo : undefined,
  });
  if (!parsed.success) {
    return { error: "A valid email address is required" };
  }
  const { email, returnTo } = parsed.data;

  // Rate limit BEFORE inserting a magic_links row / sending email. Keyed by
  // client IP (falling back to the email), fail-closed: a Redis outage must
  // never open unlimited magic-link sends.
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || hdrs.get("x-real-ip") || email;
  const rl = await authLimiter.check(`magic-link:${ip}`);
  if (!rl.success) {
    return { error: "Too many requests. Please try again in a minute." };
  }

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
