/** The terminal's bottom line. It claims nothing live: the map is where health is shown. */
export function StatusBar({ left, right }: { left?: string; right?: string }) {
  return (
    <footer className="mt-auto border-t border-border bg-background font-mono text-[11px] text-fg-muted">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-accent-violet">
            ▍
          </span>
          <span className="truncate">{left ?? "bastion · every call audited"}</span>
        </div>
        <div className="shrink-0">{right ?? "UTF-8 · ok"}</div>
      </div>
    </footer>
  );
}
