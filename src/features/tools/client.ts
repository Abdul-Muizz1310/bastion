import type { Capability } from "@/platform/gateway/call";
import { type FetchLike, failureFrom, type ToolOutcome } from "./outcome";

/**
 * The browser edge of every workbench action (spec 21 §5.1): one call to `/api/tools/<id>` — a GET
 * with its input in the query string, anything else a POST with a JSON body — and the answer parsed
 * with the capability's own output schema (`src/capabilities/*`), never a copy of it.
 *
 * An abort is rethrown, so a page that was left never sets state from a late answer.
 */

export type CallOptions = { signal?: AbortSignal; fetchImpl?: FetchLike };

type Query = Readonly<Record<string, unknown>>;

function isQuery(input: unknown): input is Query {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/** The tools route's URL for this call; a GET's defined input values become its query string. */
export function toolPath<I, O>(cap: Capability<I, O>, input: I): string {
  const path = `/api/tools/${encodeURIComponent(cap.id)}`;
  if (cap.method !== "GET") return path;
  if (!isQuery(input)) throw new TypeError(`${cap.id}: a GET's input must be an object`);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new TypeError(`${cap.id}: ${key} cannot go in a query string`);
    }
    search.append(key, String(value));
  }
  const query = search.toString();
  return query === "" ? path : `${path}?${query}`;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function readJson(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await res.text();
  if (text === "") return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export async function callTool<I, O>(
  cap: Capability<I, O>,
  input: I,
  options: CallOptions = {},
): Promise<ToolOutcome<O>> {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const isGet = cap.method === "GET";
  let res: Response;
  try {
    res = await fetchImpl(toolPath(cap, input), {
      method: isGet ? "GET" : "POST",
      cache: "no-store",
      signal: options.signal,
      headers: isGet
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
      ...(isGet ? {} : { body: JSON.stringify(input) }),
    });
  } catch (err) {
    if (isAbort(err) || options.signal?.aborted) throw err;
    return {
      ok: false,
      kind: "unreachable",
      detail: "bastion could not be reached",
      requestId: null,
    };
  }

  const headerRequestId = res.headers.get("x-request-id");
  const body = await readJson(res);
  if (!res.ok) {
    return failureFrom(res.status, body.ok ? body.value : undefined, headerRequestId);
  }
  if (headerRequestId === null || headerRequestId === "") {
    return {
      ok: false,
      kind: "invalid_response",
      detail: "bastion answered without a request id",
      requestId: null,
    };
  }
  if (!body.ok) {
    return {
      ok: false,
      kind: "invalid_response",
      detail: "the answer is not JSON",
      requestId: headerRequestId,
    };
  }
  const parsed = cap.output.safeParse(body.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      kind: "invalid_response",
      detail: `${issue?.path.join(".") || "(root)"}: ${issue?.code ?? "invalid"}`,
      requestId: headerRequestId,
    };
  }
  return { ok: true, data: parsed.data, status: res.status, requestId: headerRequestId };
}
