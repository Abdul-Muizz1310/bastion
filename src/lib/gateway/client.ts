import type { Role } from "@/lib/validation";
import { mintPlatformJwt, resolveService } from "./jwt";

const DEFAULT_TIMEOUT_MS = 30_000;
const KEY_ID = process.env.BASTION_KEY_ID ?? "bastion-ed25519-2026-04";

export type CallServiceOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  actor: { id: string; role: Role };
  requestId: string;
  timeoutMs?: number;
};

export type CallServiceResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string };

/**
 * Server-side service caller. Mints a short-lived Ed25519 JWT, forwards the
 * request to the downstream service, and returns a typed envelope.
 *
 * This is distinct from the public `/api/proxy/*` route handler — it's a
 * direct server-to-server call intended for internal orchestrations like the
 * dossier verify endpoint.
 */
export async function callService<T = unknown>(
  serviceId: string,
  path: string,
  opts: CallServiceOptions,
): Promise<CallServiceResult<T>> {
  const service = resolveService(serviceId);

  let jwt: string;
  try {
    jwt = await mintPlatformJwt({
      sub: opts.actor.id,
      role: opts.actor.role,
      service: serviceId,
    });
  } catch {
    return { ok: false, status: 0, error: "jwt_mint_failed" };
  }

  const targetUrl = `${service.backendUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const method = opts.method ?? (opts.body ? "POST" : "GET");
  const headers: Record<string, string> = {
    authorization: `Bearer ${jwt}`,
    "x-request-id": opts.requestId,
    "x-platform-key-id": KEY_ID,
  };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return { ok: false, status: 0, error: isAbort ? "timeout" : "network_error" };
  }
  clearTimeout(timer);

  if (response.status >= 500) {
    return { ok: false, status: 502, error: "bad_gateway" };
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { ok: false, status: response.status, error: "invalid_response" };
  }

  if (!response.ok) {
    const message =
      typeof (parsed as { detail?: unknown })?.detail === "string"
        ? (parsed as { detail: string }).detail
        : typeof (parsed as { error?: unknown })?.error === "string"
          ? (parsed as { error: string }).error
          : `downstream_${response.status}`;
    return { ok: false, status: response.status, error: message };
  }

  return { ok: true, status: response.status, data: parsed as T };
}
