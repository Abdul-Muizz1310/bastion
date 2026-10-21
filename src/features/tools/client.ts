import type { Capability } from "@/platform/gateway/call";
import { type FetchLike, failureFrom, type ToolOutcome } from "./outcome";

/** Any schema with a `safeParse` — Zod classic (the capabilities) or zod/mini (route answers). */
export type Parser<O> = {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: O }
    | { success: false; error: { issues: readonly { path: PropertyKey[]; code: string }[] } };
};

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

type Exchange<O> = {
  path: string;
  init: RequestInit;
  parser: Parser<O>;
  /** A success must carry `x-request-id` (the tools route always sets it). */
  requireRequestId: boolean;
};

async function exchange<O>(x: Exchange<O>, options: CallOptions): Promise<ToolOutcome<O>> {
  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(x.path, { ...x.init, cache: "no-store", signal: options.signal });
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
    return failureFrom(
      res.status,
      body.ok ? body.value : undefined,
      headerRequestId,
      res.headers.get("retry-after"),
    );
  }
  if (x.requireRequestId && (headerRequestId === null || headerRequestId === "")) {
    return {
      ok: false,
      kind: "invalid_response",
      detail: "bastion answered without a request id",
      requestId: null,
    };
  }
  const requestId = headerRequestId ?? "";
  if (!body.ok) {
    return { ok: false, kind: "invalid_response", detail: "the answer is not JSON", requestId };
  }
  const parsed = x.parser.safeParse(body.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      kind: "invalid_response",
      detail: `${issue?.path.map(String).join(".") || "(root)"}: ${issue?.code ?? "invalid"}`,
      requestId,
    };
  }
  return { ok: true, data: parsed.data, status: res.status, requestId };
}

export async function callTool<I, O>(
  cap: Capability<I, O>,
  input: I,
  options: CallOptions = {},
): Promise<ToolOutcome<O>> {
  const isGet = cap.method === "GET";
  return exchange<O>(
    {
      path: toolPath(cap, input),
      init: isGet
        ? { method: "GET", headers: { accept: "application/json" } }
        : {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(input),
          },
      parser: cap.output,
      requireRequestId: true,
    },
    options,
  );
}

/** One of bastion's own JSON routes (token preview, transcript check), read like a tool call. */
export async function getRoute<O>(
  path: string,
  parser: Parser<O>,
  options: CallOptions = {},
): Promise<ToolOutcome<O>> {
  return exchange<O>(
    {
      path,
      init: { method: "GET", headers: { accept: "application/json" } },
      parser,
      requireRequestId: false,
    },
    options,
  );
}

/** A JSON POST to one of bastion's own routes (the feathers proof). */
export async function postRoute<O>(
  path: string,
  body: unknown,
  parser: Parser<O>,
  options: CallOptions = {},
): Promise<ToolOutcome<O>> {
  return exchange<O>(
    {
      path,
      init: {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      parser,
      requireRequestId: true,
    },
    options,
  );
}

/** A multipart POST to one of bastion's routes (`/api/uploads`). */
export async function postForm<O>(
  path: string,
  form: FormData,
  parser: Parser<O>,
  options: CallOptions = {},
): Promise<ToolOutcome<O>> {
  return exchange<O>(
    {
      path,
      init: { method: "POST", headers: { accept: "application/json" }, body: form },
      parser,
      requireRequestId: true,
    },
    options,
  );
}
