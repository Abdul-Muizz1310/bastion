import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eventView } from "@/features/audit/view";
import type { StoredEvent } from "@/platform/audit/read";
import { links, textOf } from "../../helpers/html";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

const connection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => connection(),
}));

const listAudit = vi.fn();
vi.mock("@/features/audit/server/query", () => ({
  listAudit: (...args: unknown[]) => listAudit(...args),
}));

import AuditPage, { metadata } from "@/app/audit/page";

/** `/audit` (spec 21 §3.2): the open, append-only log — everyone reads every event. */

const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function stored(id: number, more: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id,
    actor: "v_kk6eooepno",
    actorId: null,
    action: "gateway.call",
    entityType: "capability",
    entityId: "magpie.scrape",
    service: "magpie",
    requestId: `req-${id}`,
    metadata: { status: 200, ms: 312, ok: true },
    createdAt: new Date("2026-10-20T18:13:26.282Z"),
    ...more,
  };
}

async function render(search: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve(search) }));
}

beforeEach(() => {
  listAudit.mockReset();
  listAudit.mockResolvedValue({ events: [], older: null });
  connection.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("/audit: the page", () => {
  it("is titled, is the audit page of the nav, and has one h1", async () => {
    expect(metadata).toMatchObject({ title: "audit log" });
    const html = await render();
    const current = links(html).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/audit"]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("is rendered per request: connection() comes before the read", async () => {
    await render();
    expect(connection).toHaveBeenCalledTimes(1);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      listAudit.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("states the append-only guarantee honestly, with its proof", async () => {
    const html = await render();
    const text = textOf(html);
    expect(text).toMatch(/UPDATE, DELETE and TRUNCATE/);
    expect(text).toMatch(/could still drop/);
    const proof = links(html).map((l) => l.href);
    expect(proof).toContain(
      "https://github.com/Abdul-Muizz1310/bastion/blob/main/drizzle/0001_append_only_events.sql",
    );
    expect(proof).toContain(
      "https://github.com/Abdul-Muizz1310/bastion/blob/main/tests/integration/db/append-only.test.ts",
    );
  });

  it("has a GET filter form that works without script, holding the current filters", async () => {
    const html = await render({ service: "inkprint", action: "dossier.", request: "req-7" });
    expect(html).toMatch(/<form[^>]*action="\/audit"[^>]*method="get"|<form[^>]*method="get"[^>]*action="\/audit"/);
    expect(html).toMatch(/<select[^>]*name="service"/);
    expect(html).toMatch(/<option value="inkprint" selected="">/);
    expect(html).toMatch(/<input[^>]*name="action"[^>]*value="dossier\."/);
    expect(html).toMatch(/<input[^>]*name="request"[^>]*value="req-7"/);
  });
});

describe("/audit: the events", () => {
  it("shows every event's actor as its pseudonym (invariant 2)", async () => {
    listAudit.mockResolvedValueOnce({
      events: [
        eventView(stored(4)),
        eventView(stored(3, { actor: "bastion" })),
        eventView(stored(2, { actor: null, actorId: DOSSIER })),
        eventView(stored(1, { actor: null })),
      ],
      older: null,
    });
    const text = textOf(await render());
    expect(text).toContain("v_kk6eooepno");
    expect(text).toContain("bastion");
    expect(text).toContain("v1 user");
    expect(text).toContain("no actor");
    expect(text).not.toContain("550e8400");
  });

  it("links each request id to its trail and a dossier to its page", async () => {
    listAudit.mockResolvedValueOnce({
      events: [
        eventView(stored(2, { requestId: "req-a" })),
        eventView(stored(1, { entityType: "dossier", entityId: DOSSIER, requestId: null })),
      ],
      older: null,
    });
    const hrefs = links(await render()).map((l) => l.href);
    expect(hrefs).toContain("/audit/req-a");
    expect(hrefs).toContain(`/d/${DOSSIER}`);
    expect(hrefs).not.toContain("/audit/null");
  });

  it("shows the known fields: status, duration, stage and an error code", async () => {
    listAudit.mockResolvedValueOnce({
      events: [
        eventView(stored(2, { metadata: { status: 502, ms: 1234.4, error: "downstream_error" } })),
        eventView(
          stored(1, {
            action: "dossier.stage.ok",
            entityType: "dossier",
            entityId: DOSSIER,
            metadata: { stage: "seal", attempt: 2 },
          }),
        ),
      ],
      older: null,
    });
    const text = textOf(await render());
    expect(text).toContain("502");
    expect(text).toContain("1.23 s");
    expect(text).toContain("downstream_error");
    expect(text).toContain("seal");
    expect(text).toContain("attempt 2");
  });

  it("never renders raw metadata (invariant 6)", async () => {
    listAudit.mockResolvedValueOnce({
      events: [
        eventView(
          stored(1, {
            metadata: { body: "SECRET_DOWNSTREAM_BODY", error: "ECONNREFUSED 10.0.0.4:5432" },
          }),
        ),
      ],
      older: null,
    });
    const html = await render();
    expect(html).not.toContain("SECRET_DOWNSTREAM_BODY");
    expect(html).not.toContain("ECONNREFUSED");
    expect(textOf(html)).toContain("detail withheld");
  });

  it("writes each time in UTC", async () => {
    listAudit.mockResolvedValueOnce({ events: [eventView(stored(1))], older: null });
    const html = await render();
    expect(html).toContain('dateTime="2026-10-20T18:13:26.282Z"');
    expect(textOf(html)).toMatch(/18:13:26\.282/);
  });
});

describe("/audit: pages (invariant 4)", () => {
  it("offers older from the smallest id shown, keeping the filters", async () => {
    listAudit.mockResolvedValueOnce({ events: [eventView(stored(200))], older: 151 });
    const html = await render({ service: "magpie" });
    const older = links(html).find((l) => /older/.test(l.name));
    expect(older?.href).toBe("/audit?service=magpie&before=151");
  });

  it("offers no older link at the end of the log, and says it is the end", async () => {
    listAudit.mockResolvedValueOnce({ events: [eventView(stored(1))], older: null });
    const html = await render();
    expect(links(html).some((l) => /older/.test(l.name))).toBe(false);
    expect(textOf(html)).toMatch(/start of the log/);
  });

  it("past the first page, offers the newest page, keeping the filters", async () => {
    listAudit.mockResolvedValueOnce({ events: [eventView(stored(10))], older: null });
    const html = await render({ action: "gateway.", before: "11" });
    expect(listAudit).toHaveBeenCalledWith({ filters: { action: "gateway." }, before: 11 });
    const newest = links(html).find((l) => /newest/.test(l.name));
    expect(newest?.href).toBe("/audit?action=gateway.");
  });

  it("on the first page there is no newest link", async () => {
    listAudit.mockResolvedValueOnce({ events: [eventView(stored(10))], older: null });
    const html = await render();
    expect(links(html).some((l) => /newest/.test(l.name))).toBe(false);
  });
});

describe("/audit: empty, refused and unavailable", () => {
  it("nothing matches: says so and names the filters", async () => {
    const text = textOf(await render({ service: "magpie", action: "dossier." }));
    expect(text).toMatch(/no events match/);
    expect(text).toContain("service magpie");
    expect(text).toContain("action dossier.");
  });

  it("an empty log with no filter says the log is empty", async () => {
    expect(textOf(await render())).toMatch(/no events yet/);
  });

  it("refuses filters it does not understand, reads nothing, and offers to clear them (invariant 3)", async () => {
    const html = await render({ sort: "asc", service: "everything" });
    expect(listAudit).not.toHaveBeenCalled();
    const text = textOf(html);
    expect(text).toMatch(/sort.*not a filter/);
    expect(text).toMatch(/service.*not a value/);
    const clear = links(html).find((l) => /clear filters/.test(l.name));
    expect(clear?.href).toBe("/audit");
    expect(text).not.toContain("everything");
  });

  it("the database unreachable: the page renders and says the log is unavailable", async () => {
    listAudit.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const html = await render();
    const text = textOf(html);
    expect(text).toMatch(/unavailable/);
    expect(text).not.toContain("ECONNREFUSED");
  });
});
