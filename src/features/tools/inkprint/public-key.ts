import { type FetchLike, failureFrom, type ToolOutcome } from "../outcome";

/**
 * inkprint's public key (review fix 7). `inkprint.publicKey` is a raw capability — the tools route
 * passes the PEM through as text — so it is read without a JSON schema, but every failure is named
 * by `failureFrom` like any other call: a limit reads as a limit, asleep as asleep.
 */

export const PUBLIC_KEY_PATH = "/api/tools/inkprint.publicKey";

export async function readPublicKey(
  options: { signal?: AbortSignal; fetchImpl?: FetchLike } = {},
): Promise<ToolOutcome<string>> {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(PUBLIC_KEY_PATH, { cache: "no-store", signal: options.signal });
  } catch (err) {
    if (options.signal?.aborted) throw err;
    return {
      ok: false,
      kind: "unreachable",
      detail: "bastion could not be reached",
      requestId: null,
    };
  }
  const requestId = res.headers.get("x-request-id");
  const text = await res.text();
  if (!res.ok) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    return failureFrom(res.status, body, requestId, res.headers.get("retry-after"));
  }
  if (!text.includes("-----BEGIN PUBLIC KEY-----") || !text.includes("-----END PUBLIC KEY-----")) {
    return { ok: false, kind: "invalid_response", detail: "not a PEM public key", requestId };
  }
  if (requestId === null || requestId === "") {
    return {
      ok: false,
      kind: "invalid_response",
      detail: "bastion answered without a request id",
      requestId: null,
    };
  }
  return { ok: true, data: text, status: res.status, requestId };
}
