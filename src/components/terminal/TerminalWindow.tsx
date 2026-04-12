import type { ReactNode } from "react";

export function TerminalWindow({
  title,
  children,
  status,
}: {
  title?: string;
  children: ReactNode;
  status?: "green" | "yellow" | "red";
}) {
  const dotColor =
    status === "green"
      ? "bg-mac-green"
      : status === "yellow"
        ? "bg-mac-yellow"
        : status === "red"
          ? "bg-mac-red"
          : "bg-fg-faint";

  return (
    <div className="terminal-glow overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="h-3 w-3 rounded-full bg-mac-red" />
        <span className="h-3 w-3 rounded-full bg-mac-yellow" />
        <span className="h-3 w-3 rounded-full bg-mac-green" />
        {title && <span className="ml-2 font-mono text-xs text-fg-muted">{title}</span>}
        {status && <span className={`ml-auto h-2 w-2 rounded-full ${dotColor} pulse-ring`} />}
      </div>
      <div className="p-5 font-mono text-sm">{children}</div>
    </div>
  );
}
