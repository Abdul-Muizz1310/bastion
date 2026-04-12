import Link from "next/link";

const links = [
  { href: "/dashboard", label: "registry" },
  { href: "/run", label: "demo" },
  { href: "/audit", label: "audit" },
  { href: "/time-travel", label: "time-travel" },
  { href: "/whoami", label: "whoami" },
];

export function AppNav({ active }: { active?: string }) {
  return (
    <nav className="sticky top-0 z-20 flex items-center gap-1 border-b border-border bg-background/80 px-4 py-2 font-mono text-sm backdrop-blur-md">
      <Link
        href="/dashboard"
        className="mr-3 flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-accent-violet transition-colors hover:border-border-bright"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <title>Bastion shield</title>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
        </svg>
        <span className="font-semibold">bastion</span>
      </Link>
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`rounded-md px-3 py-1 transition-colors ${
            active === l.label
              ? "text-accent-violet shadow-[0_1px_0_0_var(--accent-violet)]"
              : "text-fg-muted hover:text-foreground"
          }`}
        >
          {l.label}
        </Link>
      ))}
      <div className="ml-auto">
        <Link
          href="/login"
          className="rounded-md px-3 py-1 text-fg-muted transition-colors hover:text-foreground"
        >
          login
        </Link>
      </div>
    </nav>
  );
}
