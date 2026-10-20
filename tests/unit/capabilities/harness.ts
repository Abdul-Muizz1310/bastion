import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, vi } from "vitest";
import { BUDGET_KEYS, budgetEnvName } from "@/platform/budget";
import { type Capability, callCapability } from "@/platform/gateway/call";
import type { GatewayResult } from "@/platform/gateway/result";
import { SERVICES, type ServiceId } from "@/platform/registry/products";
import { newSigningEnv, stubSigningEnv, VISITOR } from "../platform/gateway/keys-fixture";

/**
 * Contract-test harness for the capability modules: the real gateway (input parse, canonical
 * path, budget, token, response parse) runs against a stubbed `fetch` answering with a recorded
 * fixture. Each test file mocks `@/platform/ratelimit` and `@/platform/audit/write` itself (vi.mock
 * is hoisted per file).
 */

const FIXTURES = resolve(__dirname, "../../fixtures/downstream");

export const ctx = { actor: VISITOR, requestId: "req-capabilities-1", clientIp: "203.0.113.9" };

export function fixture(service: string, name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES, service, name), "utf8"));
}

export function fixtureBytes(service: string, name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(resolve(FIXTURES, service, name)));
}

/** A deep copy of `value` with the field at `path` removed. */
export function withoutField(value: unknown, path: readonly (string | number)[]): unknown {
  const copy = structuredClone(value);
  let cursor: unknown = copy;
  for (const key of path.slice(0, -1)) cursor = (cursor as Record<string | number, unknown>)[key];
  const last = path.at(-1);
  if (last === undefined || cursor === null || typeof cursor !== "object") {
    throw new Error(`withoutField: no field at ${path.join(".")}`);
  }
  if (!Object.hasOwn(cursor, last)) throw new Error(`withoutField: no field at ${path.join(".")}`);
  delete (cursor as Record<string | number, unknown>)[last];
  return copy;
}

export const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

/** Signing keys, the in-process budget store with room to spare, and a stubbed network. */
export function stubGateway(): void {
  stubSigningEnv(newSigningEnv());
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  for (const key of BUDGET_KEYS) vi.stubEnv(budgetEnvName(key), "100000");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
}

export type Sent = { url: string; method: string; body: unknown; headers: Headers };

export function sent(i = 0): Sent {
  const call = fetchMock.mock.calls[i];
  if (!call) throw new Error(`no request ${i} was sent`);
  const [url, init] = call;
  const raw = init.body;
  return {
    url,
    method: init.method ?? "GET",
    body: typeof raw === "string" ? JSON.parse(raw) : raw,
    headers: new Headers(init.headers),
  };
}

export const json = (value: unknown, status = 200) => Response.json(value, { status });

// The registry seam's `any`, mirrored: these helpers take any capability.
// biome-ignore lint/suspicious/noExplicitAny: test helper over heterogeneous capabilities
type AnyCapability = Capability<any, any>;

export async function call(
  cap: AnyCapability,
  input: unknown,
  answer?: Response,
): Promise<GatewayResult<unknown>> {
  if (answer) fetchMock.mockResolvedValueOnce(answer);
  return callCapability(cap, input, ctx);
}

/** The capability parses `body` and answers ok with the same status and the parsed data. */
export async function expectParses(
  cap: AnyCapability,
  input: unknown,
  body: unknown,
  status = 200,
): Promise<unknown> {
  const result = await call(cap, input, json(body, status));
  if (!result.ok) throw new Error(`${cap.id}: expected ok, got ${result.error} (${result.detail})`);
  expect(result.status).toBe(status);
  return result.data;
}

/** Removing a required field from a recorded answer makes it `invalid_response` naming the field. */
export async function expectMissingFieldRejected(
  cap: AnyCapability,
  input: unknown,
  body: unknown,
  path: readonly (string | number)[],
): Promise<void> {
  const result = await call(cap, input, json(withoutField(body, path)));
  expect(result).toMatchObject({ ok: false, error: "invalid_response", status: 502 });
  if (!result.ok) expect(result.detail).toContain(path.join("."));
}

/** The input schema refuses `input` before anything is sent. */
export async function expectInvalidInput(cap: AnyCapability, input: unknown): Promise<void> {
  const result = await call(cap, input);
  expect(result).toMatchObject({ ok: false, error: "invalid_input", status: 422 });
  expect(fetchMock).not.toHaveBeenCalled();
}

export const base = (service: ServiceId) => SERVICES[service].baseUrl;
