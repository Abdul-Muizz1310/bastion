import { CopyButton } from "@/components/tools/CopyButton";
import type { PerfView } from "../receipt-view";

/**
 * The perf receipt (spec 21 §6.1, §6.6): the queries each service ran for this dossier's request
 * id, as slowquery logged them — fingerprint, calls, total and slowest time — with the exact SQL of
 * every suggestion slowquery made. A service that did not answer says why (Ruling U: measuring
 * never fails the dossier, so the gap is recorded instead). Rendered on the server.
 */

function ms(value: number): string {
  return `${Math.round(value * 10) / 10} ms`;
}

export function PerfReceipt({ perf }: { perf: PerfView }) {
  return (
    <div className="space-y-5">
      <p className="font-mono text-xs text-fg-muted">
        receipt hash{" "}
        <span translate="no" className="break-all text-foreground tabular-nums">
          {perf.hash ?? "none stored"}
        </span>
      </p>
      {perf.services.length === 0 ? (
        <p className="font-mono text-xs text-fg-muted">
          The dossier called no service that keeps a slowquery log, so there was nothing to measure.
        </p>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {perf.services.map((s) => (
            <li
              key={s.service}
              data-service={s.service}
              className="min-w-0 rounded-[3px] border border-border bg-surface/40 px-4 py-3 font-mono text-xs"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-x-4">
                <span translate="no" className="font-semibold text-foreground">
                  {s.service}
                </span>
                <span className="text-fg-muted tabular-nums">
                  {s.error !== null
                    ? "no answer"
                    : `${s.queries.length} ${s.queries.length === 1 ? "query" : "queries"}`}
                </span>
              </p>
              {s.error !== null ? (
                <p className="mt-2 leading-relaxed text-warning">
                  did not answer: {s.error}.{" "}
                  <span className="text-fg-muted">
                    The receipt records the gap; nothing was guessed.
                  </span>
                </p>
              ) : s.queries.length === 0 ? (
                <p className="mt-2 text-fg-muted">answered: no queries for this request.</p>
              ) : (
                <ol className="mt-3 space-y-3">
                  {s.queries.map((q) => (
                    <li key={q.id} className="space-y-1.5">
                      <code className="block break-words text-foreground/90 [overflow-wrap:anywhere]">
                        {q.fingerprint}
                      </code>
                      <p className="text-fg-muted tabular-nums">
                        {q.calls} {q.calls === 1 ? "call" : "calls"} · {ms(q.totalMs)} total
                        {q.maxMs === null ? "" : ` · slowest ${ms(q.maxMs)}`}
                      </p>
                      {q.suggestions.map((sug, i) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: suggestions keep slowquery's order
                          key={i}
                          className="rounded-[3px] border border-accent-cyan/40 bg-background px-3 py-2"
                        >
                          <p className="text-[11px] uppercase tracking-[0.16em] text-accent-cyan">
                            suggests · {sug.kind}
                          </p>
                          {sug.sql === null ? (
                            <p className="mt-1 text-fg-muted">no SQL given</p>
                          ) : (
                            <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
                              <code className="min-w-0 flex-1 break-words text-foreground [overflow-wrap:anywhere]">
                                {sug.sql}
                              </code>
                              <CopyButton text={sug.sql} label={`the ${sug.kind} SQL`} />
                            </div>
                          )}
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
