import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));

import { LiveDossierContext, type LiveDossierValue } from "@/features/dossier/components/LiveDossier";
import { VerdictSlip } from "@/features/dossier/components/VerdictSlip";
import { initialLive, liveReducer } from "@/features/dossier/live/model";
import type { SlipFacts } from "@/features/dossier/slip-view";
import { links, textOf } from "../../../helpers/html";
import { REQUEST_ID, viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6, "The live card": the slip renders the server's facts on its own, and inside the live
 * island it shows what the stream says — here, the state after a `status` event with a verdict.
 */

const facts: SlipFacts = {
  id: "5b1e0c3a-9d4f-4e2b-8a6c-7f1d2e3c4b5a",
  status: "running",
  verdict: null,
  confidence: null,
  evidence: { items: 0, certified: 0 },
  documents: 1,
  envelopeId: null,
  mode: "standard",
};

function inLive(state: LiveDossierValue["state"]) {
  const value: LiveDossierValue = {
    state,
    following: true,
    retry: { busy: false, outcome: null, onRetry: () => {} },
    nudged: null,
  };
  return renderToStaticMarkup(
    <LiveDossierContext value={value}>
      <VerdictSlip facts={facts} requestId={REQUEST_ID} />
    </LiveDossierContext>,
  );
}

describe("VerdictSlip", () => {
  it("renders the server's facts outside the island", () => {
    const html = renderToStaticMarkup(<VerdictSlip facts={facts} requestId={REQUEST_ID} />);
    expect(textOf(html)).toMatch(/no verdict yet/);
    expect(links(html).map((l) => l.href)).toContain(`/audit/${REQUEST_ID}`);
  });

  it("shows the verdict and confidence a status event brought, while the run goes on", () => {
    const start = initialLive({ status: "running", verdict: null, confidence: null, steps: viewsAt("measure", "running") });
    const html = inLive(
      liveReducer(start, {
        type: "event",
        event: { type: "status", status: { status: "running", verdict: "TRUE", confidence: 0.82 } },
      }),
    );
    expect(html).toContain('data-tone="pass"');
    expect(textOf(html)).toMatch(/\btrue\b/);
    expect(textOf(html)).toMatch(/confidence\s+82 %/);
    expect(textOf(html)).toMatch(/status\s+running/);
    expect(textOf(html)).not.toMatch(/no verdict yet/);
  });

  it("announces a change of verdict politely", () => {
    const html = inLive(initialLive({ status: "running", verdict: null, confidence: null, steps: viewsAt("debate", "running") }));
    expect(html).toMatch(/aria-live="polite"/);
  });
});
