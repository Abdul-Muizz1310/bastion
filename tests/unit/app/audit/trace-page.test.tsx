import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventView } from "@/features/audit/view";
import type { StoredEvent } from "@/platform/audit/read";
import { links, sliceByAttr, textOf } from "../../helpers/html";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

const connection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => connection(),
}));

const requestTrace = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  requestTrace: (...args: unknown[]) => requestTrace(...args),
}));

import TracePage, { generateMetadata } from "@/app/audit/[requestId]/page";

/** `/audit/[requestId]` (spec 21 §3.2): one request's waterfall across services. */

const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";
const T0 = Date.parse("2026-10-20T09:00:00.000Z");

function at(id: number, offsetMs: number, more: Partial<StoredEvent> = {}) {
  return eventView({
    id,
    actor: "bastion",
    actorId: null,
    action: "gateway.call",
    entityType: "capability",
    entityId: "magpie.scrape",
    service: "magpie",
    requestId: "req-dossier-1",
    metadata: {},
    createdAt: new Date(T0 + offsetMs),
    ...more,
  });
}

async function render(requestId: string) {
  return renderToStaticMarkup(await TracePage({ params: Promise.resolve({ requestId }) }));
}

beforeEach(() => {
  requestTrace.mockReset();
  connection.mockClear();
});

describe("/audit/[requestId]: the waterfall", () => {
  const trace = {
    events: [
      at(10, 0, {
        service: "bastion",
        action: "dossier.created",
        entityType: "dossier",
        entityId: DOSSIER,
        actor: "v_kk6eooepno",
      }),
      at(12, 2000, { service: "inkprint", entityId: "inkprint.certify", metadata: { status: 201, ms: 1500 } }),
      at(11, 600, { metadata: { status: 200, ms: 400 } }),
    ],
    truncated: false,
  };

  it("draws the rows in order of start, each with its offset and a bar on the shared scale", async () => {
    requestTrace.mockResolvedValueOnce(trace);
    const html = await render("req-dossier-1");
    const rows = [...html.matchAll(/data-event="(\d+)"/g)].map((m) => Number(m[1]));
    // 10 starts at 0; 11 at 200 (600 − 400); 12 at 500 (2000 − 1500).
    expect(rows).toEqual([10, 11, 12]);
    const row12 = sliceByAttr(html, "data-event", "12");
    expect(textOf(row12)).toContain("+500 ms");
    expect(textOf(row12)).toContain("1.50 s");
    expect(textOf(row12)).toContain("201");
    expect(row12).toMatch(/left:25%;width:75%/);
  });

  it("names the services touched, the span and the count", async () => {
    requestTrace.mockResolvedValueOnce(trace);
    const text = textOf(await render("req-dossier-1"));
    expect(text).toMatch(/bastion.*magpie.*inkprint/);
    expect(text).toContain("2.00 s");
    expect(text).toMatch(/3 events/);
  });

  it("links the dossier the request belongs to, and the actor's pseudonym is shown", async () => {
    requestTrace.mockResolvedValueOnce(trace);
    const html = await render("req-dossier-1");
    expect(links(html).filter((l) => l.href === `/d/${DOSSIER}`).length).toBeGreaterThanOrEqual(1);
    expect(textOf(html)).toContain("v_kk6eooepno");
  });

  it("says when the request was cut at 500 events", async () => {
    requestTrace.mockResolvedValueOnce({ ...trace, truncated: true });
    expect(textOf(await render("req-dossier-1"))).toMatch(/first 500/);
  });

  it("links back to the log, filtered to this request", async () => {
    requestTrace.mockResolvedValueOnce(trace);
    const hrefs = links(await render("req-dossier-1")).map((l) => l.href);
    expect(hrefs).toContain("/audit");
    expect(hrefs).toContain("/audit?request=req-dossier-1");
  });

  it("never renders raw metadata (invariant 6)", async () => {
    requestTrace.mockResolvedValueOnce({
      events: [at(1, 0, { metadata: { status: 500, error: "Traceback: SECRET", body: "BODY" } })],
      truncated: false,
    });
    const html = await render("req-dossier-1");
    expect(html).not.toMatch(/Traceback|SECRET|BODY/);
    expect(textOf(html)).toContain("detail withheld");
  });

  it("is the audit page of the nav", async () => {
    requestTrace.mockResolvedValueOnce(trace);
    const current = links(await render("req-dossier-1")).filter((l) =>
      l.tag.includes('aria-current="page"'),
    );
    expect(current.map((l) => l.href)).toEqual(["/audit"]);
  });
});

describe("/audit/[requestId]: not found", () => {
  it("a request with no events is a 404", async () => {
    requestTrace.mockResolvedValueOnce({ events: [], truncated: false });
    await expect(render("req-none")).rejects.toThrow("NOT_FOUND");
  });

  it.each(["req id", "x".repeat(129), "a/b", "%00"])(
    "a malformed id (%s) is a 404 without a read",
    async (id) => {
      await expect(render(id)).rejects.toThrow("NOT_FOUND");
      expect(requestTrace).not.toHaveBeenCalled();
    },
  );

  it("is titled from the id alone", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ requestId: "0f8a1c2e-4b6d-4e8f-9a0b-1c2d3e4f5a6b" }) }),
    ).resolves.toEqual({ title: "request 0f8a1c2e" });
    expect(requestTrace).not.toHaveBeenCalled();
  });
});
