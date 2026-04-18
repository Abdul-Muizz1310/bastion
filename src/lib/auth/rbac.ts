import { cookies } from "next/headers";
import { forbidden, unauthorized } from "next/navigation";
import { appendEvent } from "@/lib/audit/write";
import type { Role } from "@/lib/validation";
import { COOKIE_NAME, getSession, type HydratedSession } from "./session";

export type RbacUser = {
  id: string;
  role: Role;
} | null;

export class AccessDeniedError extends Error {
  constructor(
    public readonly requiredRoles: Role[],
    public readonly actualRole: string | null,
    public readonly action: string,
  ) {
    super(
      `Access denied: action "${action}" requires role [${requiredRoles.join(", ")}], got "${actualRole ?? "unauthenticated"}"`,
    );
    this.name = "AccessDeniedError";
  }
}

export async function withRole(
  requiredRoles: Role[],
  user: RbacUser,
  action: string,
): Promise<void> {
  // Empty roles array rejects everyone
  if (requiredRoles.length === 0) {
    await logDenial(user?.id ?? null, action, requiredRoles, user?.role ?? null);
    throw new AccessDeniedError(requiredRoles, user?.role ?? null, action);
  }

  // Unauthenticated
  if (!user) {
    await logDenial(null, action, requiredRoles, null);
    throw new AccessDeniedError(requiredRoles, null, action);
  }

  // Check role
  if (!requiredRoles.includes(user.role)) {
    await logDenial(user.id, action, requiredRoles, user.role);
    throw new AccessDeniedError(requiredRoles, user.role, action);
  }
}

/**
 * Page-layer RBAC. Reads the bastion session cookie, rejects with Next 16
 * `unauthorized()` if no session, `forbidden()` if role is wrong. On success
 * returns the hydrated session so the caller can use `session.user`.
 *
 * Use in Server Components:
 *   const session = await requireRole(["admin"], "time-travel.view");
 */
export async function requireRole(requiredRoles: Role[], action: string): Promise<HydratedSession> {
  const jar = await cookies();
  const cookie = jar.get(COOKIE_NAME);
  const session = await getSession(cookie?.value);

  if (!session) {
    unauthorized();
  }

  if (!requiredRoles.includes(session.user.role)) {
    await logDenial(session.user.id, action, requiredRoles, session.user.role);
    forbidden();
  }

  return session;
}

async function logDenial(
  actorId: string | null,
  action: string,
  requiredRoles: Role[],
  actualRole: string | null,
): Promise<void> {
  try {
    await appendEvent({
      actorId: actorId ?? undefined,
      action: "security.denied",
      entityType: "rbac",
      entityId: action,
      metadata: { requiredRoles, actualRole },
    });
  } catch {
    // Audit failure must not break the denial flow
    console.error("Failed to log RBAC denial event");
  }
}
