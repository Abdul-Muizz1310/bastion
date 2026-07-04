import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import type { Role } from "@/lib/validation";
import { sealSid, unsealSid } from "./seal";

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
  // Single round-trip: join sessions -> users and hydrate in one query. An
  // inner join naturally returns no row if the session is missing OR its user
  // row is gone, so both map to "return null".
  const rows = await db
    .select({
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      role: users.role,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sid))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  // Check expiry
  if (row.expiresAt < new Date()) {
    // Clean up expired session
    await db.delete(sessions).where(eq(sessions.id, sid));
    return null;
  }

  return {
    sid,
    user: {
      id: row.userId,
      email: row.email,
      role: row.role as Role,
      name: row.name,
    },
  };
}

export async function getSessionExpiry(sid: string): Promise<Date | null> {
  const db = getDb();
  const rows = await db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, sid))
    .limit(1);
  return rows[0]?.expiresAt ?? null;
}

export async function destroySession(sid: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, sid));
}

export { COOKIE_NAME };
