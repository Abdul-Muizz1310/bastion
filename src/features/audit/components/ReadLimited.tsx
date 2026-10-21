/**
 * A read the visitor's limit refused (Ruling AL): said for what it is — a limit, with the wait and
 * the limit named — never as the log failing. Nothing was read.
 */
export function ReadLimited({ retryAfterS, limit }: { retryAfterS: number; limit: number }) {
  return (
    <div className="rounded-[var(--radius)] border border-warning/40 bg-warning/5 px-5 py-4 font-mono text-xs leading-relaxed">
      <p className="text-warning">too many reads — try again in {retryAfterS} s</p>
      <p className="mt-1.5 text-fg-muted">
        Each visitor gets {limit} reads a minute of the open log, so nothing was read this time. The
        log is open to everyone; the limit keeps it that way.
      </p>
    </div>
  );
}
