import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/features/time-travel/server/query", () => ({
  loadTimeTravelState: vi.fn(),
}));

import { TimeTravelSlider } from "@/features/time-travel/components/TimeTravelSlider";
import { SLIDER_MAX } from "@/features/time-travel/controller";
import type { TimeTravelView } from "@/features/time-travel/view";

const MIN_ISO = "2026-01-01T00:00:00.000Z";
const MAX_ISO = "2026-01-11T00:00:00.000Z";

function populated(): TimeTravelView {
  return {
    asOf: MAX_ISO,
    bounds: { min: MIN_ISO, max: MAX_ISO },
    entities: [
      {
        entityType: "dossier",
        entityId: "dossier-42",
        service: "bastion",
        state: { status: "succeeded" },
        lastAction: "dossier.completed",
        lastEventAt: "2026-01-10T09:00:00.000Z",
      },
    ],
    message: null,
  };
}

function empty(): TimeTravelView {
  return {
    asOf: MAX_ISO,
    bounds: { min: null, max: MAX_ISO },
    entities: [],
    message: "No audit data yet.",
  };
}

describe("07-replay TimeTravelSlider (case 1, 4, 6)", () => {
  it("renders a controlled range input parked at the newest position", () => {
    const html = renderToString(createElement(TimeTravelSlider, { initial: populated() }));
    expect(html).toContain('type="range"');
    expect(html).toContain(`max="${SLIDER_MAX}"`);
    expect(html).toContain(`value="${SLIDER_MAX}"`);
  });

  it("renders the entities returned by the query, not a placeholder", () => {
    const html = renderToString(createElement(TimeTravelSlider, { initial: populated() }));
    expect(html).toContain("dossier-42");
    expect(html).toContain("dossier.completed");
    // The mockup copy this component replaced must be gone.
    expect(html).not.toContain("drag slider to rewind");
  });

  it("shows the selected timestamp so the user can see where they rewound to", () => {
    const html = renderToString(createElement(TimeTravelSlider, { initial: populated() }));
    expect(html).toContain("2026-01-11T00:00:00.000Z");
  });

  it("case 9: disables the slider and shows the message when there is no audit data", () => {
    const html = renderToString(createElement(TimeTravelSlider, { initial: empty() }));
    expect(html).toContain("disabled");
    expect(html).toContain("No audit data yet.");
  });

  it("case 7: renders a 'no events before this time' message with an empty entity list", () => {
    const view = populated();
    view.entities = [];
    view.message = "No events before this time";
    const html = renderToString(createElement(TimeTravelSlider, { initial: view }));
    expect(html).toContain("No events before this time");
    expect(html).not.toContain("dossier-42");
  });

  it("reports how many entities were reconstructed at the selected time", () => {
    const html = renderToString(createElement(TimeTravelSlider, { initial: populated() }));
    expect(html).toMatch(/1\s*entit/i);
  });
});
