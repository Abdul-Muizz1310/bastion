import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/time-travel/server/query", () => ({
  loadTimeTravelState: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { actorDisplay } from "@/features/audit/actor";
import { TimeTravelSlider } from "@/features/time-travel/components/TimeTravelSlider";
import { SLIDER_MAX } from "@/features/time-travel/controller";
import type { TimeTravelEntityView, TimeTravelView } from "@/features/time-travel/view";
import { links, textOf } from "../../../helpers/html";

/** Spec 07 cases 1, 4, 6, 7, 9 and spec 21 §3.2 `/time-travel`. */

const MIN_ISO = "2026-01-01T00:00:00.000Z";
const MAX_ISO = "2026-01-11T00:00:00.000Z";
const DOSSIER = "550e8400-e29b-41d4-a716-446655440000";
const VISITOR = actorDisplay({ actor: "v_kk6eooepno", actorId: null });

function entity(overrides: Partial<TimeTravelEntityView> = {}): TimeTravelEntityView {
  return {
    entityType: "dossier",
    entityId: DOSSIER,
    href: `/d/${DOSSIER}`,
    service: "bastion",
    lastAction: "dossier.stage.ok",
    lastEventAt: "2026-01-10T09:00:00.000Z",
    requestId: "req-1",
    actor: { kind: "system", label: "bastion" },
    facts: { status: null, ms: null, stage: "seal", attempt: 1, error: null },
    ...overrides,
  };
}

function populated(): TimeTravelView {
  return {
    asOf: MAX_ISO,
    bounds: { min: MIN_ISO, max: MAX_ISO },
    entities: [
      entity(),
      entity({
        entityType: "capability",
        entityId: "magpie.scrape",
        href: null,
        service: "magpie",
        lastAction: "gateway.call",
        requestId: "req-2",
        actor: VISITOR,
        facts: { status: 200, ms: 312, stage: null, attempt: null, error: null },
      }),
      entity({
        entityType: "capability",
        entityId: "inkprint.certify",
        href: null,
        service: "inkprint",
        lastAction: "gateway.call",
        requestId: null,
        actor: VISITOR,
        facts: { status: 503, ms: 8000, stage: null, attempt: null, error: { kind: "code", code: "asleep" } },
      }),
    ],
    message: null,
    truncated: false,
  };
}

function empty(): TimeTravelView {
  return {
    asOf: MAX_ISO,
    bounds: { min: null, max: MAX_ISO },
    entities: [],
    message: "No audit data yet.",
    truncated: false,
  };
}

const render = (view: TimeTravelView) =>
  renderToStaticMarkup(createElement(TimeTravelSlider, { initial: view }));

describe("TimeTravelSlider: the slider", () => {
  it("is a labelled, controlled range input parked at now", () => {
    const html = render(populated());
    expect(html).toContain('type="range"');
    expect(html).toContain(`max="${SLIDER_MAX}"`);
    expect(html).toContain(`value="${SLIDER_MAX}"`);
    expect(html).toMatch(/<label[^>]*for="time-slider"/);
    expect(html).toMatch(/aria-valuetext="[^"]*2026/);
  });

  it("shows the moment it rewound to, in UTC", () => {
    const html = render(populated());
    expect(html).toContain(`dateTime="${MAX_ISO}"`);
    expect(textOf(html)).toMatch(/11 Jan 2026.*00:00:00.*UTC/);
  });

  it("case 9: disables the slider and says the log is empty", () => {
    const html = render(empty());
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(textOf(html)).toContain("No audit data yet.");
  });
});

describe("TimeTravelSlider: the entities", () => {
  it("lists every entity with its type, id, service, last action and known fields", () => {
    const text = textOf(render(populated()));
    expect(text).toContain("magpie.scrape");
    expect(text).toContain("gateway.call");
    expect(text).toContain("200");
    expect(text).toContain("312 ms");
    expect(text).toContain("seal");
    expect(text).toContain("asleep");
    expect(text).toMatch(/3\s*entities/);
  });

  it("links a dossier to its page and a request id to its trail", () => {
    const hrefs = links(render(populated())).map((l) => l.href);
    expect(hrefs).toContain(`/d/${DOSSIER}`);
    expect(hrefs).toContain("/audit/req-2");
    expect(hrefs).not.toContain("/audit/null");
  });

  it("names each actor by its pseudonym", () => {
    const text = textOf(render(populated()));
    expect(text).toContain("v_kk6eooepno");
    expect(text).toContain("bastion");
  });

  it("offers each type as a toggle with its count, none pressed at first", () => {
    const html = render(populated());
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?all types/);
    const chips = [...html.matchAll(/<button[^>]*aria-pressed="false"[^>]*>([\s\S]*?)<\/button>/g)].map(
      (m) => textOf(m[1] ?? ""),
    );
    expect(chips).toEqual(["capability 2", "dossier 1"]);
  });

  it("case 7: a moment before the first event says so and lists nothing", () => {
    const view = populated();
    view.entities = [];
    view.message = "No events before this time";
    const html = render(view);
    expect(textOf(html)).toContain("No events before this time");
    expect(html).not.toContain("magpie.scrape");
  });

  it("says when the replay was cut at 1000 entities", () => {
    const view = populated();
    view.truncated = true;
    expect(textOf(render(view))).toMatch(/first 1000/);
  });

  it("nothing moves unless motion is welcome (reduced motion)", () => {
    const html = render(populated());
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => (m[1] ?? "").split(/\s+/));
    const moving = classes.filter((c) => /transition|animate/.test(c));
    for (const c of moving) expect(c.startsWith("motion-safe:")).toBe(true);
  });
});
