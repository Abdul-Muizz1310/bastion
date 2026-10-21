import Link from "next/link";
import { AUDIT_SERVICES, type AuditFilters } from "../filters";

/**
 * `/audit`'s filters as a plain GET form (spec 21 §3.2): it works without script, an empty field is
 * no filter, and the fields hold the filters in force.
 */

/** Prefixes worth offering: the gateway's one action and the dossier's. */
const ACTION_HINTS = [
  "gateway.call",
  "dossier.",
  "dossier.created",
  "dossier.stage.",
  "dossier.stage.error",
  "dossier.verified",
];

const FIELD =
  "mt-1.5 block w-full rounded-[calc(var(--radius)*0.6)] border border-border-bright bg-background px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-fg-muted focus-visible:border-accent-violet";

const LABEL = "block font-mono text-[11px] uppercase tracking-[0.18em] text-fg-muted";

export function AuditFilterForm({ filters }: { filters: AuditFilters }) {
  return (
    <form
      action="/audit"
      method="get"
      aria-label="filter the log"
      className="grid gap-4 rounded-[var(--radius)] border border-border bg-background/70 p-4 sm:grid-cols-2 md:p-5 lg:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto]"
    >
      <div>
        <label htmlFor="audit-service" className={LABEL}>
          service
        </label>
        <select
          id="audit-service"
          name="service"
          defaultValue={filters.service ?? ""}
          className={FIELD}
        >
          <option value="">every service</option>
          {AUDIT_SERVICES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="audit-action" className={LABEL}>
          action starts with
        </label>
        <input
          id="audit-action"
          name="action"
          type="text"
          list="audit-action-hints"
          defaultValue={filters.action ?? ""}
          placeholder="gateway.call…"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={64}
          className={FIELD}
        />
        <datalist id="audit-action-hints">
          {ACTION_HINTS.map((a) => (
            <option key={a} value={a} />
          ))}
        </datalist>
      </div>
      <div>
        <label htmlFor="audit-request" className={LABEL}>
          request id
        </label>
        <input
          id="audit-request"
          name="request"
          type="text"
          defaultValue={filters.request ?? ""}
          placeholder="4c6a0f3e-1b2d-4e5f-…"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="none"
          maxLength={128}
          className={FIELD}
        />
      </div>
      <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-1">
        <button
          type="submit"
          className="rounded-[calc(var(--radius)*0.6)] border border-accent-violet/60 bg-accent-violet-soft px-4 py-2 font-mono text-[13px] text-accent-violet transition-colors hover:border-accent-violet hover:text-foreground"
        >
          filter
        </button>
        <Link
          href="/audit"
          className="py-2 font-mono text-xs text-fg-muted underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          clear
        </Link>
      </div>
    </form>
  );
}
