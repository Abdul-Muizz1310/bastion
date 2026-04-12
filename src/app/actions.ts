"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { consumeMagicLink, demoSignIn, sendMagicLink } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/session";
import type { Role } from "@/lib/validation";

export async function sendMagicLinkAction(
  formData: FormData,
): Promise<{ error?: string; sent?: boolean }> {
  const email = formData.get("email") as string;
  if (!email) return { error: "Email is required" };

  try {
    const result = await sendMagicLink(email);
    return { sent: result.emailSent };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to send magic link" };
  }
}

export async function demoSignInAction(role: Role): Promise<void> {
  const result = await demoSignIn(role);
  const jar = await cookies();
  jar.set(COOKIE_NAME, result.session.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  redirect("/dashboard");
}

export async function consumeCallbackToken(token: string): Promise<{ error?: string }> {
  const result = await consumeMagicLink(token);
  if (!result) return { error: "Invalid or expired token" };

  const jar = await cookies();
  jar.set(COOKIE_NAME, result.session.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  redirect("/dashboard");
}
