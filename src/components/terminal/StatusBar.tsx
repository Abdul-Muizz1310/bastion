export function StatusBar({ left, right }: { left?: string; right?: string }) {
  return (
    <footer className="mt-auto flex items-center justify-between border-t border-border bg-background/80 px-4 py-1.5 font-mono text-[11px] text-fg-muted backdrop-blur-md">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-success pulse-ring" />
        <span>{left ?? "bastion · control plane"}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>{right ?? "UTF-8 · ok"}</span>
      </div>
    </footer>
  );
}
