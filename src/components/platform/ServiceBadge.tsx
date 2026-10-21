import type { DisplayState } from "@/features/health/model";
import { STATE_META, TONE_TEXT } from "./states";

/**
 * A service's health, written out: glyph (hidden from assistive tech), state word, optional detail
 * (latency, seconds spent waking). Colour follows the state but is never the only signal.
 */
export function ServiceBadge({
  state,
  detail,
  service,
  className = "",
}: {
  state: DisplayState;
  detail?: string;
  service?: string;
  className?: string;
}) {
  const meta = STATE_META[state];
  return (
    <span
      data-state={state}
      className={`inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums ${className}`}
    >
      {service ? (
        <span translate="no" className="text-foreground">
          {service}
        </span>
      ) : null}
      <span
        aria-hidden="true"
        className={`${TONE_TEXT[meta.tone]} ${meta.pulse ? "motion-safe:animate-pulse" : ""}`}
      >
        {meta.glyph}
      </span>
      <span className={TONE_TEXT[meta.tone]}>{meta.label}</span>
      {detail ? <span className="text-fg-muted">· {detail}</span> : null}
    </span>
  );
}
