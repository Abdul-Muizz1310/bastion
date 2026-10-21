import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Locator, type Page, request } from "@playwright/test";
import { z } from "zod";
import { STUB_ORIGIN, type Tenant } from "./env";
import { serverLogFile } from "./run-files";

/**
 * What the e2e specs share (spec 21 §10.1): the stub's control routes, a wake gate reaching live,
 * and the dossier read from the outside — over its SSE stream and its receipts bundle, the way a
 * stranger would, without opening the page that nudges the runner.
 */

// ---- the stub -------------------------------------------------------------------------------

async function stub(): Promise<APIRequestContext> {
  // The stub's certificate is made for the run; only the app trusts it (NODE_EXTRA_CA_CERTS).
  return request.newContext({ baseURL: STUB_ORIGIN, ignoreHTTPSErrors: true });
}

const callsSchema = z.object({
  calls: z.array(
    z.object({ tenant: z.string(), service: z.string(), method: z.string(), path: z.string() }),
  ),
});

export type StubCall = z.infer<typeof callsSchema>["calls"][number];

/** Every call one app made to the stub, oldest first. */
export async function stubCalls(tenant: Tenant): Promise<StubCall[]> {
  const ctx = await stub();
  try {
    const res = await ctx.get(`/__control/log?tenant=${tenant}`);
    expect(res.ok()).toBe(true);
    return callsSchema.parse(await res.json()).calls;
  } finally {
    await ctx.dispose();
  }
}

/** The limits app's feathers-demo: asleep (its /health hangs) or awake. */
export async function setLimitsFeathers(state: "asleep" | "awake"): Promise<void> {
  const ctx = await stub();
  try {
    const res = await ctx.post(state === "awake" ? "/__control/wake" : "/__control/sleep");
    expect(res.ok()).toBe(true);
  } finally {
    await ctx.dispose();
  }
}

/** What one app has written so far this run (`.e2e/<tenant>.log`, made by playwright.config.ts). */
export function serverLog(tenant: Tenant): string {
  return readFileSync(serverLogFile(join(__dirname, "..", "..", ".."), tenant), "utf8");
}

// ---- pages ----------------------------------------------------------------------------------

/** A workbench's (or a compose step's) wake gate answering live, its actions unlocked. */
export async function gateLive(gate: Locator): Promise<void> {
  await expect(gate).toHaveAttribute("data-gate", "live", { timeout: 30_000 });
}

/** The page's first wake gate. */
export function firstGate(page: Page): Locator {
  return page.locator("[data-gate]").first();
}

/** A receipt card by its kind (the header line of `ReceiptCard`), e.g. "magpie scrape". */
export function receipt(scope: Page | Locator, kind: string): Locator {
  const page = "goto" in scope ? scope : scope.page();
  const exact = new RegExp(`^${kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return scope
    .locator("article")
    .filter({ has: page.locator("header > span").filter({ hasText: exact }) });
}

/** Every receipt carries its copy button and the request id linking to its audit trail. */
export async function expectReceiptFooter(card: Locator): Promise<string> {
  await expect(card.getByRole("button", { name: /^copy the .+ receipt$/ })).toBeVisible();
  const audit = card.getByRole("link", { name: /^request [0-9a-f-]{8} · audit trail/ });
  await expect(audit).toBeVisible();
  const href = await audit.getAttribute("href");
  expect(href).toMatch(/^\/audit\/[A-Za-z0-9._:-]+$/);
  return href ?? "";
}

// ---- a dossier, from the outside ------------------------------------------------------------

export const stepSchema = z.object({
  stage: z.string(),
  status: z.string(),
  attempt: z.number(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type StreamStep = z.infer<typeof stepSchema>;
const statusSchema = z.object({ status: z.string() });

/**
 * One look at a dossier through its public SSE stream: the first tick sends every step row, then
 * the status. Reading the stream never advances the runner (only the page's nudge and the runner's
 * own chain do).
 */
export async function streamSnapshot(
  baseURL: string,
  dossierId: string,
): Promise<{ status: string; steps: StreamStep[] }> {
  const controller = new AbortController();
  const res = await fetch(`${baseURL}/api/dossiers/${dossierId}/stream`, {
    signal: controller.signal,
    headers: { accept: "text/event-stream" },
  });
  if (!res.ok || res.body === null) throw new Error(`stream answered ${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const steps: StreamStep[] = [];
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("the stream ended before its first status event");
      buffer += value;
      let end = buffer.indexOf("\n\n");
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const type = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (type === "step" && data) steps.push(stepSchema.parse(JSON.parse(data)));
        if (type === "status" && data) {
          return { status: statusSchema.parse(JSON.parse(data)).status, steps };
        }
        end = buffer.indexOf("\n\n");
      }
    }
  } finally {
    controller.abort();
  }
}

/**
 * Polls the public stream until the dossier is succeeded or failed, or the deadline passes. With
 * `stallMs`, it also gives up once no step's status or attempt has changed for that long — a stalled
 * chain fails fast instead of waiting out the deadline.
 */
export async function finishedDossier(
  baseURL: string,
  dossierId: string,
  timeoutMs: number,
  pollMs = 2_000,
  stallMs = Number.POSITIVE_INFINITY,
): Promise<{ status: string; steps: StreamStep[] }> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  let changedAt = Date.now();
  for (;;) {
    const snapshot = await streamSnapshot(baseURL, dossierId);
    if (snapshot.status === "succeeded" || snapshot.status === "failed") return snapshot;
    const where = snapshot.steps.map((s) => `${s.stage}:${s.status}:${s.attempt}`).join(" ");
    if (where !== seen) {
      seen = where;
      changedAt = Date.now();
    }
    if (Date.now() - changedAt > stallMs) {
      throw new Error(`dossier ${dossierId} stalled: no step changed for ${stallMs} ms (${where})`);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `dossier ${dossierId} still ${snapshot.status} after ${timeoutMs} ms (${where})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** How long one stage ran, from its row (null while it has no start or end). */
export function stageMs(step: StreamStep): number | null {
  if (step.startedAt === null || step.finishedAt === null) return null;
  return Date.parse(step.finishedAt) - Date.parse(step.startedAt);
}
