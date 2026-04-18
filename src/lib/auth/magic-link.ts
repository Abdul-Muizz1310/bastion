import crypto from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { magicLinks, users } from "@/lib/db/schema";
import type { Role } from "@/lib/validation";
import { isSafeReturnTo } from "./return-to";
import { createSession } from "./session";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const MAGIC_LINK_TTL_MIN = Number(process.env.MAGIC_LINK_TTL_MIN ?? "10");

export type MagicLinkResult = {
  token: string;
  url: string;
  emailSent: boolean;
};

export type AuthResult = {
  session: { sid: string; cookie: string };
  user: { id: string; email: string; role: Role };
  redirectTo: string;
  tokenUsedAt?: Date;
};

function generateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function validateEmail(email: string): void {
  if (!email?.includes("@") || email.length < 3) {
    throw new Error("Invalid email address");
  }
}

export async function sendMagicLink(email: string, returnTo?: string): Promise<MagicLinkResult> {
  validateEmail(email);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MIN * 60 * 1000);
  const baseUrl = `${SITE_URL}/auth/callback?token=${token}`;
  const url = isSafeReturnTo(returnTo)
    ? `${baseUrl}&returnTo=${encodeURIComponent(returnTo)}`
    : baseUrl;

  const db = getDb();
  await db.insert(magicLinks).values({ token, email, expiresAt });

  // Send email via Resend
  let emailSent = false;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM ?? "onboarding@resend.dev";
    await resend.emails.send({
      from,
      to: email,
      subject: "Sign in to Bastion",
      html: `<p>Click <a href="${url}">here</a> to sign in. This link expires in ${MAGIC_LINK_TTL_MIN} minutes.</p>`,
    });
    emailSent = true;
  } catch (err) {
    console.error("Failed to send magic link email:", err);
  }

  return { token: "[redacted]", url: emailSent ? "[redacted]" : url, emailSent };
}

export async function consumeMagicLink(token: string): Promise<AuthResult | null> {
  if (!token) return null;

  const db = getDb();
  const rows = await db.select().from(magicLinks).where(eq(magicLinks.token, token)).limit(1);

  if (rows.length === 0) return null;

  const link = rows[0];

  // Atomic check-and-mark: prevents TOCTOU race on concurrent requests.
  // WHERE includes usedAt IS NULL and expiresAt > now so only the first
  // concurrent caller wins, and expired tokens are never consumed.
  const now = new Date();
  const updated = await db
    .update(magicLinks)
    .set({ usedAt: now })
    .where(
      and(eq(magicLinks.token, token), isNull(magicLinks.usedAt), gt(magicLinks.expiresAt, now)),
    )
    .returning();

  if (updated.length === 0) return null;

  // Find or create user
  let userRows = await db.select().from(users).where(eq(users.email, link.email)).limit(1);

  if (userRows.length === 0) {
    userRows = await db.insert(users).values({ email: link.email, role: "viewer" }).returning();
  }

  const user = userRows[0];
  const session = await createSession(user.id, null, null);

  return {
    session: { sid: session.sid, cookie: session.cookie },
    user: { id: user.id, email: user.email, role: user.role as Role },
    redirectTo: "/dashboard",
    tokenUsedAt: now,
  };
}

const DEMO_ALLOWED_ROLES: Role[] = ["viewer", "editor"];

export async function demoSignIn(role: Role): Promise<AuthResult> {
  if (process.env.DEMO_MODE !== "true") {
    throw new Error("Demo mode is not enabled");
  }

  if (!DEMO_ALLOWED_ROLES.includes(role)) {
    throw new Error(`Role "${role}" is not permitted in demo mode`);
  }

  const email = `demo-${role}@bastion.local`;
  const db = getDb();

  // Find or create demo user
  let userRows = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (userRows.length === 0) {
    userRows = await db
      .insert(users)
      .values({ email, name: `Demo ${role}`, role })
      .returning();
  }

  const user = userRows[0];
  const session = await createSession(user.id, null, null);

  return {
    session: { sid: session.sid, cookie: session.cookie },
    user: { id: user.id, email: user.email, role: user.role as Role },
    redirectTo: "/dashboard",
  };
}
