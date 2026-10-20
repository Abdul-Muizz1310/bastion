import Link from "next/link";

/** The primary nav (spec 21 §3.1). No sign-in: no login, no whoami, no role pill. */

export const NAV_LINKS = [
  { href: "/", label: "map" },
  { href: "/tools", label: "tools" },
  { href: "/dossier", label: "dossier" },
  { href: "/audit", label: "audit" },
  { href: "/time-travel", label: "time-travel" },
  { href: "/platform", label: "platform" },
] as const;

export type NavKey = (typeof NAV_LINKS)[number]["label"];

const SOURCE_URL = "https://github.com/Abdul-Muizz1310/bastion";

export function AppNav({ active }: { active?: NavKey }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background">
      <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-x-4 px-4 md:px-6">
        <Link
          href="/"
          data-brand="true"
          aria-label="bastion, platform map"
          className="flex items-center gap-2 py-3 text-foreground transition-colors hover:text-accent-violet"
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-accent-violet"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            <path d="M9 12h6M12 9v6" />
          </svg>
          <span translate="no" className="font-display text-sm font-bold tracking-tight">
            bastion
          </span>
        </Link>

        <nav
          aria-label="primary"
          className="order-last col-span-full -mx-4 overflow-x-auto border-t border-border px-2 md:order-none md:col-span-1 md:mx-0 md:border-t-0 md:px-0"
        >
          <ul className="flex items-center justify-between font-mono text-xs md:justify-start md:gap-1 md:text-[13px]">
            {NAV_LINKS.map((link) => {
              const current = link.label === active;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current ? "page" : undefined}
                    className={`relative block whitespace-nowrap px-1.5 py-3 transition-colors md:px-2.5 ${
                      current
                        ? "text-accent-violet after:absolute after:inset-x-1.5 after:bottom-0 after:h-px after:bg-accent-violet md:after:inset-x-2.5"
                        : "text-fg-muted hover:text-foreground"
                    }`}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <a
          href={SOURCE_URL}
          className="justify-self-end py-3 font-mono text-[13px] text-fg-muted transition-colors hover:text-foreground"
        >
          source
          <span aria-hidden="true" className="ml-1">
            ↗
          </span>
        </a>
      </div>
    </header>
  );
}
