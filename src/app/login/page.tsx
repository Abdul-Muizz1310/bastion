import Link from "next/link";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background bg-grid bg-scanlines px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent-violet"
            >
              <title>Bastion shield</title>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
            </svg>
          </div>
          <h1 className="font-mono text-3xl font-semibold tracking-tight">bastion</h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">control plane · identity · audit</p>
        </div>

        <div className="terminal-glow rounded-xl border border-border bg-surface p-6">
          <form className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block font-mono text-xs uppercase tracking-[0.15em] text-fg-muted"
              >
                email
              </label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                className="w-full rounded-lg border border-border bg-background/60 px-4 py-2.5 font-mono text-sm text-foreground placeholder-fg-faint transition-colors focus:border-accent-violet/60 focus:outline-none focus:shadow-[0_0_0_1px_rgb(167_139_250_/_0.3),0_0_30px_rgb(167_139_250_/_0.15)]"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-2.5 font-mono text-sm font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)]"
            >
              send magic link
            </button>
          </form>

          {DEMO_MODE && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
                  or sign in as
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(["admin", "editor", "viewer"] as const).map((role) => (
                  <Link
                    key={role}
                    href={`/dashboard?demo=${role}`}
                    className="rounded-lg border border-border bg-background/60 px-3 py-2 text-center font-mono text-xs transition-colors hover:border-accent-violet/40 hover:bg-surface-hover"
                  >
                    <span className="text-accent-violet">{role}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="text-center font-mono text-[11px] text-fg-faint">
          <span className="cursor-blink mr-1 inline-block h-3 w-1.5 bg-accent-violet/60" />
          demo mode active · no real credentials required
        </p>
      </div>
    </div>
  );
}
