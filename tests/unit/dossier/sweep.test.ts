import { describe, expect, it, vi } from "vitest";
import type { DriveResult } from "@/dossier/drive";
import { UnknownDossierError } from "@/dossier/runner";
import {
  isSweepAuthorized,
  SWEEP_LIMIT,
  sweepDue,
  sweepTokenFromEnv,
} from "@/dossier/sweep";

/**
 * Spec 21 §6.2 "The sweep": a token-gated request that drives every dossier whose frontier stage
 * is due, oldest first, with the foreground loop, until its budget is spent. The token is compared
 * in constant time; the summary carries ids, stages and statuses only.
 */

const A = "550e8400-e29b-41d4-a716-446655440001";
const B = "550e8400-e29b-41d4-a716-446655440002";
const C = "550e8400-e29b-41d4-a716-446655440003";
const TOKEN = "s3cr3t-sweep-token-of-a-decent-length";

describe("the sweep token", () => {
  it("is read from BASTION_SWEEP_TOKEN, trimmed; blank or unset is none", () => {
    expect(sweepTokenFromEnv({ BASTION_SWEEP_TOKEN: ` ${TOKEN}\n` })).toBe(TOKEN);
    expect(sweepTokenFromEnv({ BASTION_SWEEP_TOKEN: "  " })).toBeNull();
    expect(sweepTokenFromEnv({})).toBeNull();
  });

  it("accepts exactly `Bearer <token>` (the scheme in any case)", () => {
    expect(isSweepAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isSweepAuthorized(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it.each([
    ["no header", null],
    ["an empty header", ""],
    ["another token", "Bearer not-the-token"],
    ["a prefix of the token", `Bearer ${TOKEN.slice(0, -1)}`],
    ["the token plus more", `Bearer ${TOKEN}x`],
    ["another scheme", `Basic ${TOKEN}`],
    ["no scheme", TOKEN],
    ["two spaces", `Bearer  ${TOKEN}`],
  ])("refuses %s", (_name, header) => {
    expect(isSweepAuthorized(header, TOKEN)).toBe(false);
  });
});

describe("sweepDue", () => {
  const START = 1_000_000;
  const DEADLINE = START + 300_000;
  const driven = (stages: DriveResult["stages"], stopped: DriveResult["stopped"]): DriveResult => ({
    last: { ran: stages.at(-1)?.stage ?? null, status: null, dossier: "succeeded", nextAt: null },
    stages,
    stopped,
  });

  it("asks for at most 25 due dossiers and drives them in the order given, with the shared deadline", async () => {
    expect(SWEEP_LIMIT).toBe(25);
    const due = vi.fn(async () => [A, B]);
    const drive = vi.fn(async (_id: string, _deadline: number) =>
      driven([{ stage: "debate", status: "ok" }], "done"),
    );
    const out = await sweepDue({ due, drive, now: () => START, deadlineMs: DEADLINE });
    expect(due).toHaveBeenCalledWith(new Date(START), 25);
    expect(drive.mock.calls).toEqual([
      [A, DEADLINE],
      [B, DEADLINE],
    ]);
    expect(out).toEqual([
      { dossierId: A, stages: [{ stage: "debate", status: "ok" }], dossier: "succeeded", stopped: "done" },
      { dossierId: B, stages: [{ stage: "debate", status: "ok" }], dossier: "succeeded", stopped: "done" },
    ]);
  });

  it("starts no dossier with less than the loop's margin left", async () => {
    let clock = START;
    const drive = vi.fn(async () => {
      clock += 285_000; // the first dossier used most of the budget
      return driven([], "budget");
    });
    const out = await sweepDue({ due: async () => [A, B, C], drive, now: () => clock, deadlineMs: DEADLINE });
    expect(drive).toHaveBeenCalledTimes(1);
    expect(out.map((s) => s.dossierId)).toEqual([A]);
  });

  it("skips a dossier deleted since it was selected, and goes on", async () => {
    const drive = vi.fn(async (id: string) => {
      if (id === A) throw new UnknownDossierError(A);
      return driven([], "later");
    });
    const out = await sweepDue({ due: async () => [A, B], drive, now: () => START, deadlineMs: DEADLINE });
    expect(out).toEqual([
      { dossierId: A, stages: [], dossier: null, stopped: "gone" },
      { dossierId: B, stages: [], dossier: "succeeded", stopped: "later" },
    ]);
  });

  it("records a dossier whose drive threw as an error — its code only — and goes on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const drive = vi.fn(async (id: string) => {
      if (id === A) throw new Error("connection reset by peer at 10.0.0.7");
      return driven([], "done");
    });
    const out = await sweepDue({ due: async () => [A, B], drive, now: () => START, deadlineMs: DEADLINE });
    expect(out[0]).toEqual({ dossierId: A, stages: [], dossier: null, stopped: "error" });
    expect(JSON.stringify(out)).not.toContain("10.0.0.7");
    expect(out[1]?.stopped).toBe("done");
    expect(error).toHaveBeenCalled();
  });
});
