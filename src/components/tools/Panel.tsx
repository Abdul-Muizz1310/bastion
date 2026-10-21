import type { ReactNode } from "react";

/**
 * One workbench section: a heading in the house style (the ▚ mark, small caps-like mono), a hint,
 * and its body. Panels are the page's h2s; results inside them use h3.
 */
export function Panel({
  id,
  title,
  hint,
  children,
  className = "",
}: {
  id: string;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`min-w-0 rounded-[var(--radius)] border border-border bg-background/70 ${className}`}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border px-4 py-3 md:px-5">
        <h2
          id={`${id}-title`}
          className="font-mono text-xs uppercase tracking-[0.22em] text-fg-muted"
        >
          <span aria-hidden="true" className="text-accent-violet">
            ▚{" "}
          </span>
          {title}
        </h2>
        {hint ? <p className="font-mono text-[11px] text-fg-muted">{hint}</p> : null}
      </header>
      <div className="space-y-5 px-4 py-5 md:px-5">{children}</div>
    </section>
  );
}

/**
 * The data and its receipt: side by side when the panel itself is wide (a container query, so a
 * half-width panel stacks them), the receipt never stretched past its own height.
 */
export function WithReceipt({ children, receipt }: { children: ReactNode; receipt: ReactNode }) {
  return (
    <div className="@container">
      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">{children}</div>
        <div className="min-w-0 self-start @max-3xl:max-w-sm">{receipt}</div>
      </div>
    </div>
  );
}
