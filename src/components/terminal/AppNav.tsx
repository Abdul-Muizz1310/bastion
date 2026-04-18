import Link from "next/link";

const links = [
  { href: "/", label: "home" },
  { href: "/dashboard", label: "registry" },
  { href: "/audit", label: "audit" },
  { href: "/time-travel", label: "time-travel" },
  { href: "/whoami", label: "whoami" },
];

export type NavRole = "admin" | "editor" | "viewer";

export function AppNav({
  active,
  role,
  userEmail,
}: {
  active?: string;
  role?: NavRole;
  userEmail?: string;
}) {
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
      <div className="ml-auto flex items-center gap-2">
        {role ? <RolePill role={role} email={userEmail} /> : null}
        {!role ? (
          <Link
            href="/login"
            className="rounded-md px-3 py-1 text-fg-muted transition-colors hover:text-foreground"
          >
            login
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

const ROLE_CLASS: Record<NavRole, string> = {
  admin: "border-accent-violet/40 bg-accent-violet-soft text-accent-violet",
  editor: "border-success/40 bg-success/10 text-success",
  viewer: "border-fg-faint/30 bg-surface text-fg-muted",
};

function RolePill({ role, email }: { role: NavRole; email?: string }) {
  return (
    <div className="flex items-center gap-2">
      {email ? (
        <span className="hidden font-mono text-[11px] text-fg-muted md:inline">{email}</span>
      ) : null}
      <span
        className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] ${ROLE_CLASS[role]}`}
      >
        {role}
      </span>
    </div>
  );
}
