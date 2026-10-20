import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { links, textOf } from "../../helpers/html";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

// The page must wait for a request before it reads the database.
const connection = vi.fn().mockResolvedValue(undefined);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: () => connection(),
}));

const getTimeTravelState = vi.fn();
vi.mock("@/lib/audit/replay", () => ({
  getTimeTravelState: (...args: unknown[]) => getTimeTravelState(...args),
}));

// The Server Action the slider calls is never invoked during SSR, and must not drag the DB client
// into this test's module graph.
vi.mock("@/features/time-travel/server/query", () => ({
  loadTimeTravelState: vi.fn(),
}));

import TimeTravelPage, { metadata } from "@/app/time-travel/page";

/** `/time-travel` (spec 07, spec 21 §3.2): public, seeded with the state at this moment. */

const MIN = new Date("2026-01-01T00:00:00.000Z");
const MAX = new Date("2026-01-11T00:00:00.000Z");
const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";

function prime(overrides: Record<string, unknown> = {}) {
  getTimeTravelState.mockResolvedValue({
    entities: [
      {
        entityType: "dossier",
        entityId: DOSSIER,
        service: "bastion",
        lastAction: "dossier.stage.ok",
        lastEventAt: new Date("2026-01-10T09:00:00.000Z"),
        requestId: "req-1",
        actor: "bastion",
        actorId: null,
        metadata: { stage: "record", attempt: 1, body: "SECRET_BODY" },
      },
    ],
    bounds: { min: MIN, max: MAX },
    truncated: false,
    ...overrides,
  });
}

const render = async () => renderToStaticMarkup(await TimeTravelPage());

beforeEach(() => {
  vi.clearAllMocks();
  prime();
});

describe("/time-travel", () => {
  it("is titled, is the time-travel page of the nav, and has one h1", async () => {
    expect(metadata).toMatchObject({ title: "time travel" });
    const html = await render();
    const current = links(html).filter((l) => l.tag.includes('aria-current="page"'));
    expect(current.map((l) => l.href)).toEqual(["/time-travel"]);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("case 2: seeds the first render from one replay query at this moment", async () => {
    const before = Date.now();
    const html = await render();
    expect(getTimeTravelState).toHaveBeenCalledTimes(1);
    const [options] = getTimeTravelState.mock.calls[0] ?? [];
    expect(options.asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(options.asOf.getTime()).toBeLessThanOrEqual(Date.now());
    expect(textOf(html)).toContain("dossier.stage.ok");
    expect(links(html).map((l) => l.href)).toContain(`/d/${DOSSIER}`);
  });

  it("never sends the metadata to the browser (spec 21 §3.2 invariant 6)", async () => {
    expect(await render()).not.toContain("SECRET_BODY");
  });

  it("case 9: an empty log renders the disabled slider and says so", async () => {
    prime({ entities: [], bounds: { min: null, max: MAX }, message: "No audit data yet." });
    const html = await render();
    expect(textOf(html)).toContain("No audit data yet.");
    expect(html).toMatch(/<input[^>]*disabled=""/);
  });

  it("is rendered per request: connection() precedes the query", async () => {
    await render();
    expect(connection).toHaveBeenCalledTimes(1);
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      getTimeTravelState.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("explains what it reconstructs and links the log it reads", async () => {
    const html = await render();
    expect(textOf(html)).toMatch(/DISTINCT ON/);
    expect(links(html).map((l) => l.href)).toContain("/audit");
  });

  it("claims nothing about sign-in or roles", async () => {
    expect(textOf(await render())).not.toMatch(/admin only|sign in/i);
  });
});
