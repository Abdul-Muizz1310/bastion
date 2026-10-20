import type { Stage, StepStatus } from "@/dossier/stages";
import type { StepView } from "./step-view";

/**
 * The timeline as words (spec 21 §6.6, "The timeline"; §6.4): each stage's status written out
 * beside a glyph, the attempt past the first, the note, when a waiting stage is asked again (UTC,
 * so the server and the browser agree), and an error said for what it is. Pure.
 */

export type Tone = "muted" | "violet" | "success" | "warning" | "error";

export const STATUS_META: Readonly<
  Record<StepStatus, { word: string; glyph: string; tone: Tone }>
> = {
  pending: { word: "pending", glyph: "○", tone: "muted" },
  running: { word: "running", glyph: "◐", tone: "violet" },
  waiting: { word: "waiting", glyph: "◔", tone: "violet" },
  ok: { word: "ok", glyph: "✓", tone: "success" },
  error: { word: "error", glyph: "✕", tone: "error" },
  skipped: { word: "skipped", glyph: "–", tone: "muted" },
};

/** The product each stage calls (bastion's own for record). */
export const STAGE_PRODUCT: Readonly<Record<Stage, string>> = {
  wake: "bastion",
  gather: "magpie",
  read: "inkthread",
  seal: "inkprint",
  debate: "paper-trail",
  measure: "slowquery",
  envelope: "inkprint",
  record: "bastion",
};

export const STAGE_INFO: Readonly<Record<Stage, { does: string }>> = {
  wake: { does: "wakes every service the dossier needs, up to 90 s" },
  gather: { does: "scrapes the web sources with magpie" },
  read: { does: "reads the PDFs exactly with inkthread (inkgrid inside)" },
  seal: { does: "signs each piece of evidence with an inkprint certificate" },
  debate: { does: "argues the claim over the sealed evidence on paper-trail" },
  measure: { does: "collects the queries each service ran for it, with slowquery" },
  envelope: { does: "seals every receipt into one signed inkprint envelope" },
  record: { does: "digests bastion’s append-only audit log of the run" },
};

export type ErrorTone = "limit" | "product" | "bastion";
export type ErrorView = { tone: ErrorTone; title: string; detail: string };

const LIMIT_NOTE = "This is a limit of the platform, not a fault of the product.";

/** The product a `<product>.<capability>: …` error names, else the stage's own product. */
function productOf(stage: Stage, error: string): string {
  const named = /^([a-z][a-z-]*)\.[A-Za-z]+:/.exec(error)?.[1];
  return named ?? STAGE_PRODUCT[stage];
}

export function errorView(stage: Stage, error: string): ErrorView {
  if (/^(stage_threw|invalid_outcome)\b/.test(error)) {
    // Never the message: every public surface carries the bare code (publicStepError).
    return {
      tone: "bastion",
      title: "bastion hit an internal error running this stage",
      detail: "Nothing is wrong with the product it calls. Retry from this stage.",
    };
  }
  const product = productOf(stage, error);
  if (/\bbudget_exhausted\b/.test(error)) {
    return {
      tone: "limit",
      title: "today’s budget for this is spent",
      detail: `Budgets reset at 00:00 UTC and are shared by every visitor. ${LIMIT_NOTE}`,
    };
  }
  if (/\brate_limited\b/.test(error)) {
    return {
      tone: "limit",
      title: "rate limited",
      detail: `Too many calls in a short time; a retry runs once the window has passed. ${LIMIT_NOTE}`,
    };
  }
  const asleep = /^service_asleep:([a-z-]+)/.exec(error)?.[1];
  if (asleep !== undefined) {
    return {
      tone: "limit",
      title: `${asleep} did not wake within 90 s`,
      detail:
        "Free Render services sleep after 15 minutes and take about a minute to wake. Asleep is not down: retry from this stage.",
    };
  }
  if (/: asleep\b/.test(error)) {
    return {
      tone: "limit",
      title: `${product} is asleep (it did not answer in time)`,
      detail: `Asleep is not down: retry from this stage once it is awake. ${LIMIT_NOTE}`,
    };
  }
  if (/^stage_timeout\b/.test(error)) {
    return { tone: "bastion", title: "the stage ran out of time", detail: error };
  }
  if (/^lease_expired\b/.test(error)) {
    return { tone: "bastion", title: "the stage stopped without finishing", detail: error };
  }
  if (/^wait_timeout\b/.test(error)) {
    return { tone: "product", title: `${product} did not finish within 15 minutes`, detail: error };
  }
  if (/^[a-z][a-z-]*\.[A-Za-z]+: /.test(error)) {
    return { tone: "product", title: `${product} answered with an error`, detail: error };
  }
  return { tone: "product", title: `${product} could not finish this stage`, detail: error };
}

const CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `10:00:03 UTC` — always UTC, so the server's render and the browser's agree. */
export function clock(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? iso : `${CLOCK.format(t)} UTC`;
}

export type StageRow = {
  stage: Stage;
  index: number;
  does: string;
  status: StepStatus;
  word: string;
  glyph: string;
  tone: Tone;
  attempt: string | null;
  note: string | null;
  when: string | null;
  error: ErrorView | null;
  /** The error stage: "retry from this stage" belongs here and nowhere else. */
  retry: boolean;
};

export const MAX_ATTEMPTS = 3;

function whenOf(step: StepView): string | null {
  switch (step.status) {
    case "waiting":
      return step.nextAt === null ? null : `asked again at ${clock(step.nextAt)}`;
    case "running":
      return step.startedAt === null ? null : `started ${clock(step.startedAt)}`;
    case "pending":
      return step.attempt > 0 && step.nextAt !== null
        ? `runs again from ${clock(step.nextAt)}`
        : null;
    case "ok":
    case "skipped":
    case "error":
      return step.finishedAt === null ? null : `at ${clock(step.finishedAt)}`;
  }
}

export function stageRow(step: StepView, index = 0): StageRow {
  const meta = STATUS_META[step.status];
  return {
    stage: step.stage,
    index,
    does: STAGE_INFO[step.stage].does,
    status: step.status,
    word: meta.word,
    glyph: meta.glyph,
    tone: meta.tone,
    attempt: step.attempt > 1 ? `attempt ${step.attempt} of ${MAX_ATTEMPTS}` : null,
    note: step.note,
    when: whenOf(step),
    error: step.error === null ? null : errorView(step.stage, step.error),
    retry: step.status === "error",
  };
}
