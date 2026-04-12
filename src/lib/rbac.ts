import { appendEvent } from "./audit";
import type { Role } from "./validation";

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
