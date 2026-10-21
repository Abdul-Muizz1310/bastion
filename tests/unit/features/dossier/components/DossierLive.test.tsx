import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { DossierLive } from "@/features/dossier/components/DossierLive";
import { buttonNamed, buttons, isDisabled } from "../../../components/tools/gate-fixtures";
import { sliceByAttr, textOf } from "../../../helpers/html";
import { DOSSIER_ID, viewsAt } from "../fixtures";

/**
 * Spec 21 §6.6: the live island — the timeline from the server's render, the state of the
 * connection in words, and on a failed dossier "retry from this stage" on the error stage.
 */

describe("DossierLive", () => {
  it("renders the timeline of a running dossier and says it is following the run", () => {
    const html = renderToStaticMarkup(
      <DossierLive
        dossierId={DOSSIER_ID}
        initial={{ status: "running", verdict: null, confidence: null, steps: viewsAt("debate", "waiting") }}
      />,
    );
    expect(html.match(/data-stage=/g)).toHaveLength(8);
    expect(textOf(html)).toMatch(/connecting to the live run/);
    expect(buttons(html)).toHaveLength(0);
  });

  it("offers retry from the failed stage of a failed dossier", () => {
    const html = renderToStaticMarkup(
      <DossierLive
        dossierId={DOSSIER_ID}
        initial={{
          status: "failed",
          verdict: null,
          confidence: null,
          steps: viewsAt("seal", "error", { error: "inkprint.certifyBatch: downstream_error (500)" }),
        }}
      />,
    );
    const seal = sliceByAttr(html, "data-stage", "seal");
    expect(isDisabled(buttonNamed(seal, /retry from this stage/))).toBe(false);
    expect(textOf(html)).toMatch(/the run stopped at seal/);
  });

  it("says a refused retry for what it is", () => {
    const html = renderToStaticMarkup(
      <DossierLive
        dossierId={DOSSIER_ID}
        initial={{
          status: "failed",
          verdict: null,
          confidence: null,
          steps: viewsAt("seal", "error", { error: "x" }),
        }}
        initialRetry={{ ok: false, kind: "rate_limited", retryAfterS: 1800, requestId: "rid" }}
      />,
    );
    expect(textOf(sliceByAttr(html, "data-stage", "seal"))).toMatch(/rate limited.*1800 s/);
  });
});
