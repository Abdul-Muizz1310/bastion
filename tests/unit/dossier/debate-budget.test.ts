import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VisitorId } from "@/platform/visitor";
import { fetchMock, stubGateway } from "../capabilities/harness";
import { dossier, fixture, stageCtx } from "./stages/helpers";

/**
 * Spec 21 §4 (Budgets): a dossier spends exactly one `debate` unit — reserved at compose, and the
 * debate stage's first start is prepaid — composed end to end: the real compose, the real debate
 * stage wiring, the real gateway and the real (in-process) budget store; only the network, the
 * audit writer, the rate limiter and the stores the stage reads and writes are stubbed. A restart
 * after a failed debate (Ruling T) reserves one more unit.
 */

vi.mock("@/platform/ratelimit", () => ({
  createRateLimiter: () => ({
    check: async () => ({ success: true, limit: 30, remaining: 29 }),
  }),
}));
vi.mock("@/platform/audit/write", () => ({ appendEvent: vi.fn(async () => 1) }));
vi.mock("@/dossier/evidence", () => ({ listSealed: vi.fn(async () => []) }));
vi.mock("@/dossier/receipts", () => ({ recordTranscript: vi.fn(async () => ({ ok: true })) }));

type Modules = {
  budget: typeof import("@/platform/budget");
  create: typeof import("@/dossier/create");
  stage: typeof import("@/dossier/stages/debate");
};

let m: Modules;
let ids: number;

const CREATED = fixture("paper-trail", "debate-create.json");
const DONE = fixture("paper-trail", "debate.json");
const FAILED = { ...(DONE as Record<string, unknown>), status: "error", verdict: null };
const TRANSCRIPT = fixture("paper-trail", "transcript.json");
const answer = (body: unknown, status = 200) =>
  fetchMock.mockResolvedValueOnce(Response.json(body, { status }));

const debatesLeft = async () => (await m.budget.budgetsLeft()).debate.left;
const debatesStarted = () =>
  fetchMock.mock.calls.filter(([url, init]) => url.endsWith("/debates") && init.method === "POST")
    .length;

async function compose() {
  ids += 1;
  const id = `00000000-0000-4000-8000-${String(ids).padStart(12, "0")}`;
  const result = await m.create.createDossier(
    m.create.createBodySchema.parse({ claim: "small entity fees are reduced", sources: ["uspto"] }),
    { visitor: "v_kk6eooepno" as VisitorId, requestId: `req-${id}` },
    {
      knownSources: async () => new Set(["uspto"]),
      knownSamples: async () => new Set(),
      reserve: m.budget.reserveBudget,
      release: m.budget.releaseBudget,
      insert: async () => {},
      audit: async () => 1,
      now: () => new Date(),
      newId: () => id,
    },
  );
  return { result, row: dossier({ id, requestId: `req-${id}` }) };
}

beforeEach(async () => {
  stubGateway();
  vi.stubEnv("BUDGET_DEBATE", "4");
  vi.resetModules();
  m = {
    budget: await import("@/platform/budget"),
    create: await import("@/dossier/create"),
    stage: await import("@/dossier/stages/debate"),
  };
  ids = 0;
});

describe("one dossier, one debate unit", () => {
  it("spends exactly one unit across compose and the whole debate stage", async () => {
    const { result, row } = await compose();
    expect(result.ok).toBe(true);
    expect(await debatesLeft()).toBe(3);

    answer(CREATED, 201);
    const started = await m.stage.debate(stageCtx({ dossier: row }));
    expect(started.kind).toBe("waiting");
    expect(debatesStarted()).toBe(1);
    expect(await debatesLeft()).toBe(3);

    answer(DONE);
    answer(TRANSCRIPT);
    const finished = await m.stage.debate(
      stageCtx({ dossier: row, outputs: { debate: started.kind === "waiting" ? started.output : null } }),
    );
    expect(finished.kind).toBe("ok");
    expect(await debatesLeft()).toBe(3);
  });

  it("reserves one more unit for a restart after the debate failed (Ruling T)", async () => {
    const { row } = await compose();
    answer(CREATED, 201);
    const started = await m.stage.debate(stageCtx({ dossier: row }));
    answer(FAILED);
    const failed = await m.stage.debate(
      stageCtx({ dossier: row, outputs: { debate: started.kind === "waiting" ? started.output : null } }),
    );
    expect(failed).toMatchObject({ kind: "error", retryable: false });
    expect(await debatesLeft()).toBe(3);

    answer(CREATED, 201);
    const restarted = await m.stage.debate(
      stageCtx({ dossier: row, outputs: { debate: failed.kind === "error" ? (failed.output ?? null) : null } }),
    );
    expect(restarted.kind).toBe("waiting");
    expect(debatesStarted()).toBe(2);
    expect(await debatesLeft()).toBe(2);
  });

  it("runs the debate of the day's last unit: composing it spent it, the start does not ask again", async () => {
    vi.stubEnv("BUDGET_DEBATE", "1");
    const { result, row } = await compose();
    expect(result.ok).toBe(true);
    expect(await debatesLeft()).toBe(0);
    // The day is spent for every other dossier…
    expect((await compose()).result).toMatchObject({ ok: false, error: "budget_exhausted" });
    // …but the composed one still reaches paper-trail.
    answer(CREATED, 201);
    expect((await m.stage.debate(stageCtx({ dossier: row }))).kind).toBe("waiting");
    expect(debatesStarted()).toBe(1);
    expect(await debatesLeft()).toBe(0);
  });

  it("refuses a restart after a failed debate once the day is spent", async () => {
    vi.stubEnv("BUDGET_DEBATE", "1");
    const { row } = await compose();
    const out = await m.stage.debate(
      stageCtx({
        dossier: row,
        outputs: { debate: { failedDebateIds: ["11111111-2222-4333-8444-555555555555"] } },
      }),
    );
    expect(out).toMatchObject({ kind: "error", retryable: false });
    expect(out.kind === "error" && out.error).toContain("budget_exhausted");
    expect(debatesStarted()).toBe(0);
  });
});
