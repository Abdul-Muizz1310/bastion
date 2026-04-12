import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { sessions, users } from "./schema";
import type { Role } from "./validation";

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "bastion_session";
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? "24");
function getPassword(): string {
  return process.env.IRON_SESSION_PASSWORD ?? "";
}

export type SessionPayload = { sid: string };

export type SessionResult = {
  sid: string;
  cookie: string;
  payload: SessionPayload;
  cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  };
};

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  name: string | null;
};

export type HydratedSession = {
  sid: string;
  user: SessionUser;
};

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: TTL_HOURS * 60 * 60,
  };
}

function sealSid(sid: string): string {
  // Simple HMAC-based seal using IRON_SESSION_PASSWORD
  const hmac = crypto.createHmac("sha256", getPassword());
  hmac.update(sid);
  const sig = hmac.digest("base64url");
  return `${sid}.${sig}`;
}

function unsealSid(cookie: string): string | null {
  const dotIndex = cookie.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const sid = cookie.slice(0, dotIndex);
  const sig = cookie.slice(dotIndex + 1);
  const hmac = crypto.createHmac("sha256", getPassword());
  hmac.update(sid);
  const expected = hmac.digest("base64url");
  if (sig !== expected) return null;
  return sid;
}

export async function createSession(
  userId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<SessionResult> {
  if (getPassword().length < 32) {
    throw new Error("IRON_SESSION_PASSWORD must be at least 32 characters");
  }

  const sid = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_HOURS * 60 * 60 * 1000);

  const db = getDb();
  await db.insert(sessions).values({
    id: sid,
    userId,
    expiresAt,
    ip,
    userAgent,
  });

  const cookie = sealSid(sid);
  const payload: SessionPayload = { sid };

  return {
    sid,
    cookie,
    payload,
    cookieOptions: getCookieOptions(),
  };
}

export async function getSession(
  cookieValue: string | undefined | null,
): Promise<HydratedSession | null> {
  if (!cookieValue) return null;

  const sid = unsealSid(cookieValue);
  if (!sid) return null;

  const db = getDb();
  const rows = await db.select().from(sessions).where(eq(sessions.id, sid)).limit(1);

  if (rows.length === 0) return null;

  const session = rows[0];

  // Check expiry
  if (session.expiresAt < new Date()) {
    // Clean up expired session
    await db.delete(sessions).where(eq(sessions.id, sid));
    return null;
  }

  // Hydrate user
  const userRows = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

  if (userRows.length === 0) return null;

  const user = userRows[0];
  return {
    sid,
    user: {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      name: user.name,
    },
  };
}

export async function destroySession(sid: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sid));
}

export { COOKIE_NAME };
