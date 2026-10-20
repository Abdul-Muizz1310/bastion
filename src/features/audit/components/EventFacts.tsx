import type { ActorDisplay } from "../actor";
import type { KnownFields } from "../known-fields";
import { formatDuration } from "../waterfall";

/**
 * An event's known fields, written out (spec 21 §3.2): the status coloured by class (the number is
 * always written), the duration, a dossier stage and its attempt, an error code — or that the
 * error's detail is withheld. Renders on the server and in the slider alike.
 */

const STATUS_TONE = (status: number): string =>
  status >= 500
    ? "text-error"
    : status >= 400
      ? "text-warning"
      : status >= 300
        ? "text-fg-muted"
        : "text-success";

export function EventFacts({ facts, className = "" }: { facts: KnownFields; className?: string }) {
  const { status, ms, stage, attempt, error } = facts;
  const empty = status === null && ms === null && stage === null && error === null;
  if (empty) {
    return (
      <span className={`text-fg-muted ${className}`}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">no status or duration</span>
      </span>
    );
  }
  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums ${className}`}
    >
      {status !== null ? (
        <span className={STATUS_TONE(status)}>
          <span className="sr-only">status </span>
          {status}
        </span>
      ) : null}
      {ms !== null ? <span className="text-foreground/90">{formatDuration(ms)}</span> : null}
      {stage !== null ? (
        <span className="text-accent-cyan">
          {stage}
          {attempt !== null && attempt > 1 ? (
            <span className="text-fg-muted"> · attempt {attempt}</span>
          ) : null}
        </span>
      ) : null}
      {error?.kind === "code" ? (
        <span className="text-error" translate="no">
          {error.code}
        </span>
      ) : null}
      {error?.kind === "withheld" ? (
        <span className="text-error">error, detail withheld</span>
      ) : null}
    </span>
  );
}

const ACTOR_TONE: Readonly<Record<ActorDisplay["kind"], string>> = {
  visitor: "text-foreground",
  system: "text-accent-violet",
  "v1-user": "text-fg-muted",
  none: "text-fg-muted",
  unrecognised: "text-fg-muted",
};

/** An actor's pseudonym; system work in the accent, history and gaps muted. */
export function ActorName({ actor, className = "" }: { actor: ActorDisplay; className?: string }) {
  return (
    <span
      data-actor={actor.kind}
      translate={actor.kind === "visitor" || actor.kind === "system" ? "no" : undefined}
      className={`${ACTOR_TONE[actor.kind]} ${className}`}
    >
      {actor.label}
    </span>
  );
}
