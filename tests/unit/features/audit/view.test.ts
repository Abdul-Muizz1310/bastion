import { describe, expect, it } from "vitest";
import { type AuditEventView, entityHref, eventView, pageOf } from "@/features/audit/view";
import type { StoredEvent } from "@/platform/audit/read";

/** Spec 21 §3.2: what one event shows, and how a page of them is cut. */

const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function stored(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 7,
    actor: "v_kk6eooepno",
    actorId: null,
    action: "gateway.call",
    entityType: "capability",
    entityId: "magpie.scrape",
    service: "magpie",
    requestId: "req-1",
    metadata: { status: 200, ms: 312, ok: true },
    createdAt: new Date("2026-10-20T18:13:26.282Z"),
    ...overrides,
  };
}

describe("eventView", () => {
  it("keeps the event's identity and reads only its known fields", () => {
    expect(eventView(stored())).toEqual({
      id: 7,
      at: new Date("2026-10-20T18:13:26.282Z"),
      actor: { kind: "visitor", label: "v_kk6eooepno" },
      action: "gateway.call",
      service: "magpie",
      entity: { type: "capability", id: "magpie.scrape", href: null },
      requestId: "req-1",
      facts: { status: 200, ms: 312, stage: null, attempt: null, error: null },
    });
  });

  it("links a dossier entity to its page", () => {
    const view = eventView(
      stored({ entityType: "dossier", entityId: DOSSIER, metadata: { stage: "seal", attempt: 1 } }),
    );
    expect(view.entity).toEqual({ type: "dossier", id: DOSSIER, href: `/d/${DOSSIER}` });
  });

  it("never carries the metadata itself (invariant 6)", () => {
    const view = eventView(
      stored({ metadata: { status: 200, body: "the downstream answer", error: "Traceback (most…" } }),
    );
    expect(JSON.stringify(view)).not.toMatch(/downstream answer|Traceback/);
    expect(view).not.toHaveProperty("metadata");
  });

  it("names a v1 row's actor without its uuid", () => {
    const view = eventView(stored({ actor: null, actorId: DOSSIER }));
    expect(view.actor).toEqual({ kind: "v1-user", label: "v1 user" });
  });
});

describe("entityHref", () => {
  it("links a dossier whose id is a uuid", () => {
    expect(entityHref("dossier", DOSSIER)).toBe(`/d/${DOSSIER}`);
  });

  it.each([
    ["a dossier id that is not a uuid", "dossier", "dossier-42"],
    ["an upper-case uuid", "dossier", DOSSIER.toUpperCase()],
    ["a capability", "capability", "magpie.scrape"],
    ["a v1 type", "user", DOSSIER],
  ])("links nothing for %s", (_what, type, id) => {
    expect(entityHref(type, id)).toBeNull();
  });
});

describe("pageOf (invariant 4)", () => {
  const views = (ids: number[]): AuditEventView[] => ids.map((id) => eventView(stored({ id })));

  it("a full page plus one more row: shows the page and offers older from its last id", () => {
    const page = pageOf(views([10, 9, 8, 7]), 3);
    expect(page.events.map((e) => e.id)).toEqual([10, 9, 8]);
    expect(page.older).toBe(8);
  });

  it("exactly a page: nothing older exists", () => {
    const page = pageOf(views([10, 9, 8]), 3);
    expect(page.events.map((e) => e.id)).toEqual([10, 9, 8]);
    expect(page.older).toBeNull();
  });

  it("an empty read: an empty page and nothing older", () => {
    expect(pageOf([], 3)).toEqual({ events: [], older: null });
  });

  it("consecutive pages neither overlap nor skip", () => {
    const all = Array.from({ length: 11 }, (_, i) => 11 - i); // 11..1, newest first
    const seen: number[] = [];
    let before: number | null = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const rows = all.filter((id) => before === null || id < before).slice(0, 4);
      const page = pageOf(views(rows), 3);
      seen.push(...page.events.map((e) => e.id));
      if (page.older === null) break;
      before = page.older;
    }
    expect(seen).toEqual(all);
  });

  it("refuses rows that are not newest first, or more than one extra", () => {
    expect(() => pageOf(views([8, 9]), 3)).toThrow(RangeError);
    expect(() => pageOf(views([5, 4, 3, 2, 1]), 3)).toThrow(RangeError);
  });

  it("refuses a page size that is not a positive whole number", () => {
    expect(() => pageOf([], 0)).toThrow(RangeError);
  });
});
