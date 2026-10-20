import { describe, expect, it } from "vitest";
import type { Debate } from "@/capabilities/paper-trail";
import { readRounds } from "@/features/tools/paper-trail/rounds";
import { fixture } from "../../../capabilities/harness";

/**
 * paper-trail's rounds as the workbench shows them while a debate runs (spec 21 §5): its raw round
 * entries, parsed one by one — an entry bastion cannot read is said so, never dropped silently.
 */

const debate = fixture("paper-trail", "debate.json") as Debate;

describe("readRounds", () => {
  it("reads each round's side, number, argument and citations", () => {
    const rounds = readRounds(debate.rounds);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]).toMatchObject({
      ok: true,
      side: "proponent",
      round: 1,
      citations: [{ type: "cert", ref: "2b9f6a1e-4c3d-4e5f-9a7b-8c6d5e4f3a2b", title: "USPTO fee schedule" }],
    });
    expect(rounds[0]?.ok && rounds[0].argument).toMatch(/350\.00/);
  });

  it("accepts argument_md as well as argument, and no citations", () => {
    expect(readRounds([{ side: "judge", round: 2, argument_md: "TRUE" }])[0]).toMatchObject({
      ok: true,
      side: "judge",
      argument: "TRUE",
      citations: [],
    });
  });

  it("keeps an entry it cannot read as unreadable, in place", () => {
    const rounds = readRounds([{ side: "proponent", round: 1, argument: "a" }, { weird: true }]);
    expect(rounds.map((r) => r.ok)).toEqual([true, false]);
  });
});
