import { describe, expect, it } from "vitest";
import { errorView, STAGE_INFO, STATUS_META, stageRow } from "@/features/dossier/timeline-view";
import { stepView } from "./fixtures";

/**
 * Spec 21 §6.6, "The timeline": each stage's status in words beside a glyph, the attempt past the
 * first, the note, when a waiting stage is asked again (UTC), and an error said for what it is —
 * the platform's limits never as the product failing (§6.4).
 */

describe("STATUS_META", () => {
  it("writes every status as its own word with its own glyph", () => {
    const words = Object.values(STATUS_META).map((m) => m.word);
    expect(words).toEqual(["pending", "running", "waiting", "ok", "error", "skipped"]);
    expect(new Set(Object.values(STATUS_META).map((m) => m.glyph)).size).toBe(6);
  });
});

describe("STAGE_INFO", () => {
  it("names what each of the eight stages does and which product it calls", () => {
    expect(Object.keys(STAGE_INFO)).toEqual([
      "wake",
      "gather",
      "read",
      "seal",
      "debate",
      "measure",
      "envelope",
      "record",
    ]);
    expect(STAGE_INFO.seal.does).toMatch(/inkprint/);
    expect(STAGE_INFO.debate.does).toMatch(/paper-trail/);
  });
});

describe("stageRow", () => {
  it("a waiting stage says when it is asked again, in UTC", () => {
    const row = stageRow(
      stepView("debate", "waiting", { nextAt: "2026-10-20T10:00:03.000Z", note: "debate 889d7f2b is running" }),
    );
    expect(row.word).toBe("waiting");
    expect(row.when).toBe("asked again at 10:00:03 UTC");
    expect(row.note).toBe("debate 889d7f2b is running");
    expect(row.retry).toBe(false);
  });

  it("a running stage says when it started; a pending one held off says when it may run", () => {
    expect(stageRow(stepView("seal", "running", { startedAt: "2026-10-20T10:01:00.000Z" })).when).toBe(
      "started 10:01:00 UTC",
    );
    expect(
      stageRow(stepView("seal", "pending", { attempt: 1, nextAt: "2026-10-20T10:06:00.000Z" })).when,
    ).toBe("runs again from 10:06:00 UTC");
    expect(stageRow(stepView("seal", "pending")).when).toBeNull();
  });

  it("a skipped stage says why", () => {
    const row = stageRow(stepView("gather", "skipped", { note: "no web sources were picked" }));
    expect(row.word).toBe("skipped");
    expect(row.note).toBe("no web sources were picked");
  });

  it("shows the attempt only past the first", () => {
    expect(stageRow(stepView("seal", "running", { attempt: 1 })).attempt).toBeNull();
    expect(stageRow(stepView("seal", "running", { attempt: 2 })).attempt).toBe("attempt 2 of 3");
  });

  it("an error stage carries its error and is the one that can be retried", () => {
    const row = stageRow(stepView("seal", "error", { error: "inkprint.certifyBatch: downstream_error (422)" }));
    expect(row.retry).toBe(true);
    expect(row.error?.tone).toBe("product");
  });

  it("a pending stage with a previous error shows that error as the reason it is held", () => {
    const row = stageRow(
      stepView("seal", "pending", { attempt: 1, error: "stage_timeout: exceeded 240000 ms", nextAt: "2026-10-20T10:06:00.000Z" }),
    );
    expect(row.retry).toBe(false);
    expect(row.error?.title).toMatch(/ran out of time/);
  });
});

describe("errorView", () => {
  it.each([
    ["seal", "inkprint.certifyBatch: budget_exhausted", "limit", /budget/],
    ["debate", "paper-trail.debate: rate_limited (retry in 30 s)", "limit", /rate limited/],
    ["wake", "service_asleep:magpie", "limit", /magpie did not wake within 90 s/],
    ["gather", "magpie.scrapeBatch: asleep", "limit", /magpie is asleep/],
  ] as const)("names %s's %s as a limit, never the product failing", (stage, error, tone, title) => {
    const v = errorView(stage, error);
    expect(v.tone).toBe(tone);
    expect(v.title).toMatch(title);
    expect(`${v.title} ${v.detail}`).not.toMatch(/\bfailed\b/);
  });

  it("names a product's own refusal as the product's, with its detail", () => {
    const v = errorView("seal", "inkprint.certifyBatch: downstream_error (422)");
    expect(v).toMatchObject({ tone: "product", title: "inkprint answered with an error" });
    expect(v.detail).toContain("downstream_error (422)");
  });

  it("names bastion's own time limits as bastion's", () => {
    expect(errorView("seal", "stage_timeout: exceeded 240000 ms")).toMatchObject({
      tone: "bastion",
      title: "the stage ran out of time",
    });
    expect(errorView("seal", "lease_expired: attempt 3 of 3 did not finish").tone).toBe("bastion");
    expect(errorView("debate", "wait_timeout: still waiting 15 min after the attempt started")).toMatchObject({
      tone: "product",
      title: "paper-trail did not finish within 15 minutes",
    });
  });

  it("falls back to the stage's product for anything else", () => {
    expect(errorView("debate", "debate_failed: 889d7f2b")).toMatchObject({
      tone: "product",
      title: "paper-trail could not finish this stage",
      detail: "debate_failed: 889d7f2b",
    });
    expect(errorView("record", "record: the stored audit receipt has no digest").title).toBe(
      "bastion could not finish this stage",
    );
  });
});
