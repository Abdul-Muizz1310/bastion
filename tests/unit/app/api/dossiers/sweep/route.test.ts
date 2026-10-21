import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/dossiers/sweep` (spec 21 §6.2 "The sweep"): token-gated (503 without a token
 * configured, 401 without the right one), no visitor limit, 300 s; drives every due dossier with the
 * foreground loop and answers a summary with ids only; one `dossier.sweep` audit event as bastion.
 */

const { dueDossiers, driveDossier, appendEvent, createRateLimiter } = vi.hoisted(() => ({
  dueDossiers: vi.fn(),
  driveDossier: vi.fn(),
  appendEvent: vi.fn(),
  createRateLimiter: vi.fn(),
}));
vi.mock("@/dossier/store", async (orig) => ({
  ...(await orig<typeof import("@/dossier/store")>()),
  dueDossiers,
}));
vi.mock("@/dossier/drive-dossier", () => ({ driveDossier }));
vi.mock("@/platform/audit/write", () => ({ appendEvent }));
vi.mock("@/platform/ratelimit", () => ({ createRateLimiter }));

import * as route from "@/app/api/dossiers/sweep/route";

const A = "550e8400-e29b-41d4-a716-446655440001";
const TOKEN = "s3cr3t-sweep-token-of-a-decent-length";
const NOW = new Date("2026-10-21T08:30:00.000Z");

const post = (authorization?: string) =>
  route.POST(
    new Request("https://bastion.test/api/dossiers/sweep", {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("BASTION_SWEEP_TOKEN", TOKEN);
  dueDossiers.mockReset().mockResolvedValue([A]);
  driveDossier.mockReset().mockResolvedValue({
    last: { ran: "record", status: "ok", dossier: "succeeded", nextAt: null },
    stages: [
      { stage: "debate", status: "ok" },
      { stage: "record", status: "ok" },
    ],
    stopped: "done",
  });
  appendEvent.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("POST /api/dossiers/sweep", () => {
  it("is dynamic, may run 300 s, and has no visitor limit (the token gates it)", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(route.maxDuration).toBe(300);
    expect(createRateLimiter).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("answers 503 when BASTION_SWEEP_TOKEN is %j, driving nothing", async (value) => {
    vi.stubEnv("BASTION_SWEEP_TOKEN", value as string);
    const res = await post(`Bearer ${TOKEN}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("sweep_unconfigured");
    expect(dueDossiers).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong", `Basic ${TOKEN}`])(
    "answers 401 to %j, driving nothing",
    async (authorization) => {
      const res = await post(authorization);
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe("Bearer");
      expect(dueDossiers).not.toHaveBeenCalled();
    },
  );

  it("drives each due dossier as the sweep, with its own deadline, and answers ids and stages only", async () => {
    const res = await post(`Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(dueDossiers).toHaveBeenCalledWith(NOW, 25);
    expect(driveDossier).toHaveBeenCalledExactlyOnceWith(
      A,
      expect.objectContaining({ driver: "sweep", deadlineMs: NOW.getTime() + 300_000 }),
    );
    const body = await res.json();
    expect(body).toEqual({
      swept: [
        {
          dossierId: A,
          stages: [
            { stage: "debate", status: "ok" },
            { stage: "record", status: "ok" },
          ],
          dossier: "succeeded",
          stopped: "done",
        },
      ],
      ms: expect.any(Number),
    });
  });

  it("appends one dossier.sweep audit event, as bastion", async () => {
    await post(`Bearer ${TOKEN}`);
    expect(appendEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        actor: "bastion",
        action: "dossier.sweep",
        service: "bastion",
        metadata: { selected: 1, driven: 1, stages: 2 },
      }),
    );
  });

  it("answers the summary even when the audit write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    appendEvent.mockRejectedValue(new Error("db down"));
    const res = await post(`Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
