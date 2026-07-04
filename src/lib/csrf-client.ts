import { CSRF_HEADER_NAME } from "@/lib/auth/csrf";

/**
 * Fetch a fresh double-submit CSRF token from `/api/csrf`. The endpoint also
 * sets the matching cookie; the returned token must be echoed in the
 * `x-csrf-token` header of the subsequent mutating request.
 */
export async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/csrf", { method: "GET", credentials: "same-origin" });
  if (!res.ok) {
    throw new Error("Could not obtain CSRF token");
  }
  const data = (await res.json()) as { token?: unknown };
  if (typeof data.token !== "string") {
    throw new Error("Malformed CSRF token response");
  }
  return data.token;
}

/**
 * POST JSON to `url` with a valid CSRF token attached. Mirrors the double-submit
 * contract enforced by mutating route handlers.
 */
export async function postWithCsrf(url: string, body: unknown): Promise<Response> {
  const token = await fetchCsrfToken();
  return fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      [CSRF_HEADER_NAME]: token,
    },
    body: JSON.stringify(body),
  });
}
