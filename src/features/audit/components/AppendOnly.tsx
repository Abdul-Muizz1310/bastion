/**
 * The log's guarantee, stated with its proof (spec 21 §3.2; DR-0015, DR-0019): what the database
 * enforces, what it cannot, and what covers the gap. Honest wording is the point — a trigger the
 * owner can drop is not called tamper-proof.
 */

const SOURCE = "https://github.com/Abdul-Muizz1310/bastion/blob/main";
export const TRIGGERS_URL = `${SOURCE}/drizzle/0001_append_only_events.sql`;
export const TRIGGERS_TEST_URL = `${SOURCE}/tests/integration/db/append-only.test.ts`;

export function AppendOnly() {
  return (
    <aside
      aria-labelledby="guarantee-title"
      className="receipt-torn relative bg-surface px-6 pt-5 pb-[calc(var(--tear)+1.25rem)] font-mono text-xs"
    >
      <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.2em] text-fg-muted">
        <h2 id="guarantee-title">the guarantee</h2>
        <span aria-hidden="true" translate="no" className="normal-case tracking-[0.08em]">
          public.events
        </span>
      </div>
      <p
        aria-hidden="true"
        className="receipt-stamp mt-4 inline-block rounded-[3px] border-2 border-current px-2.5 py-1 font-display text-sm font-bold uppercase tracking-[0.2em] text-success"
      >
        append-only
      </p>
      <div className="receipt-rule mt-4 space-y-3 pt-3 leading-relaxed">
        <p className="text-foreground">
          The database rejects every UPDATE, DELETE and TRUNCATE on this log — for every role,
          including the owner bastion connects as. Rows are only ever added.
        </p>
        <p className="text-fg-muted">
          A table owner could still drop the triggers, so the log does not ask you to trust it: each
          dossier’s envelope signs a digest of that dossier’s slice of this log, and an edit to the
          slice would no longer verify.
        </p>
      </div>
      <ul className="receipt-rule mt-4 space-y-1.5 pt-3">
        <li>
          <a
            href={TRIGGERS_URL}
            className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            the triggers <span className="text-fg-muted">· 0001_append_only_events.sql</span>
            <span aria-hidden="true"> ↗</span>
          </a>
        </li>
        <li>
          <a
            href={TRIGGERS_TEST_URL}
            className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
          >
            the test that tries to break them
            <span aria-hidden="true"> ↗</span>
          </a>
        </li>
      </ul>
    </aside>
  );
}
