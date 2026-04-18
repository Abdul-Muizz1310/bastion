import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepTimeline } from "@/features/dossier/components/StepTimeline";
import type { DossierEvent } from "@/features/dossier/schemas";

const DOSSIER_ID = "550e8400-e29b-41d4-a716-446655440000";

function event(overrides: Partial<DossierEvent>): DossierEvent {
  return {
    step: "gather",
    status: "ok",
    latency_ms: 10,
    metadata: {},
    at: "2026-04-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("17-step-timeline: render", () => {
  it("case 19: renders 6 step rows in order", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [],
        initialStatus: "running",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    for (const step of ["gather", "seal", "adjudicate", "measure", "envelope", "record"]) {
      expect(html).toContain(step);
    }
  });

  it("case 20: shows 'pending' for steps with no events", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [],
        initialStatus: "pending",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    // All 6 steps should say 'pending'
    const pendingMatches = html.match(/>pending</g) ?? [];
    expect(pendingMatches.length).toBe(6);
  });

  it("case 21: shows 'running' for a step whose latest event is 'started'", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [event({ step: "gather", status: "started", latency_ms: null })],
        initialStatus: "running",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    expect(html).toContain(">running<");
  });

  it("case 22: shows 'ok' badge and latency when step succeeded", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [event({ step: "gather", status: "ok", latency_ms: 1234 })],
        initialStatus: "running",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    expect(html).toContain(">ok<");
    expect(html).toContain("1234ms");
  });

  it("case 22b: shows 'error' badge and error text", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [
          event({
            step: "seal",
            status: "error",
            latency_ms: 50,
            metadata: { error: "inkprint down" },
          }),
        ],
        initialStatus: "running",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    expect(html).toContain(">error<");
    expect(html).toContain("inkprint down");
  });

  it("renders 'running' verdict badge when status is running", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [],
        initialStatus: "running",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    expect(html).toContain(">running<");
  });

  it("renders verdict badge with verdict + confidence when status is succeeded", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [],
        initialStatus: "succeeded",
        initialVerdict: "TRUE",
        initialConfidence: 0.87,
      }),
    );
    expect(html).toContain("TRUE");
    // React SSR emits <!-- --> between adjacent text nodes; check substrings separately
    expect(html).toContain("87");
    expect(html).toMatch(/87.*%/);
  });

  it("renders 'failed' badge when status is failed", () => {
    const html = renderToString(
      createElement(StepTimeline, {
        dossierId: DOSSIER_ID,
        initialEvents: [],
        initialStatus: "failed",
        initialVerdict: null,
        initialConfidence: null,
      }),
    );
    expect(html).toContain(">failed<");
  });
});
