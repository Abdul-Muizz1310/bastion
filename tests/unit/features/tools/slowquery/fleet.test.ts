import { describe, expect, it } from "vitest";
import type { QueryRow } from "@/capabilities/slowquery";
import { fleetView, rankMs } from "@/features/tools/slowquery/fleet";
import type { ToolOutcome } from "@/features/tools/outcome";
import { fixture } from "../../../capabilities/harness";

/**
 * slowquery's fleet view (spec 21 §5.1): the slowest fingerprints across the five hosts, merged and
 * ranked, each host's own state said — one asleep host never hides the others.
 */

const library = fixture("slowquery", "queries.json") as QueryRow[];
const demo = fixture("slowquery", "queries-demo.json") as QueryRow[];

const ok = (rows: QueryRow[], requestId: string): ToolOutcome<QueryRow[]> => ({
  ok: true,
  data: rows,
  status: 200,
  requestId,
});

const row = (over: Partial<QueryRow>): QueryRow => ({ ...(library[0] as QueryRow), ...over });

describe("rankMs", () => {
  it("ranks by p95, else max, else the mean", () => {
    expect(rankMs(row({ p95_ms: 40, max_ms: 90 }))).toBe(40);
    expect(rankMs(row({ p95_ms: null, max_ms: 90 }))).toBe(90);
    expect(rankMs(row({ p95_ms: null, max_ms: null, total_ms: 300, call_count: 3 }))).toBe(100);
    expect(rankMs(row({ p95_ms: null, max_ms: null, total_ms: 300, call_count: 0 }))).toBe(0);
  });
});

describe("fleetView", () => {
  it("merges every host's rows, tagged with their host, slowest first", () => {
    const view = fleetView([
      { service: "magpie", outcome: ok(library, "r1") },
      { service: "slowquery", outcome: ok(demo, "r2") },
    ]);
    expect(view.rows.length).toBe(library.length + demo.length);
    const ranks = view.rows.map((r) => rankMs(r.row));
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(view.rows.map((r) => r.service))).toEqual(new Set(["magpie", "slowquery"]));
  });

  it("keeps the slowest few when asked", () => {
    const view = fleetView([{ service: "slowquery", outcome: ok(demo, "r") }], 1);
    expect(view.rows).toHaveLength(1);
  });

  it("says each host's state: its row count, or its failure — asleep is not empty", () => {
    const view = fleetView([
      { service: "magpie", outcome: ok(library, "r1") },
      { service: "inkprint", outcome: { ok: false, kind: "asleep", requestId: "r2" } },
      { service: "paper-trail", outcome: ok([], "r3") },
    ]);
    expect(view.hosts).toEqual([
      { service: "magpie", state: "ok", count: library.length, requestId: "r1" },
      { service: "inkprint", state: "failed", failure: { ok: false, kind: "asleep", requestId: "r2" } },
      { service: "paper-trail", state: "ok", count: 0, requestId: "r3" },
    ]);
  });

  it("refuses a limit that is not a positive whole number", () => {
    expect(() => fleetView([], 0)).toThrow(RangeError);
  });
});
