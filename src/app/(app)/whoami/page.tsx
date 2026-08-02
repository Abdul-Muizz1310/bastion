import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { COOKIE_NAME, getSession, getSessionExpiry } from "@/lib/auth/session";

/**
 * The controls this build implements, each named with the layer it actually
 * lives in. This is a static inventory, deliberately not dressed up as a live
 * audit — nothing here is probed at request time.
 */
const SECURITY_POSTURE = [
  "httpOnly cookie",
  "HMAC-sealed SID",
  "no PII in cookie",
  "CSRF double-submit on mutating API routes",
  "rate-limited auth (fail-closed)",
  "RBAC on page guards + Server Actions",
  "CSP + security headers (next.config.ts)",
  "X-Frame-Options: DENY",
  "append-only events (DB triggers)",
  "Ed25519 JWT gateway",
  "request ID tracing",
] as const;

function formatExpiry(expiresAt: Date | null): string {
  if (!expiresAt) return "unknown";
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "expired";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `in ${hours}h ${minutes}m`;
}

export default async function WhoamiPage() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    redirect("/login?returnTo=%2Fwhoami");
  }

  const expiresAt = await getSessionExpiry(session.sid);
  const expiryLabel = formatExpiry(expiresAt);
  const sidShort = `${session.sid.slice(0, 8)}…`;

  return (
    <PageFrame
      active="whoami"
      role={session.user.role}
      userEmail={session.user.email}
      statusLeft={`role · ${session.user.role}`}
      statusRight={`sid · ${session.sid.slice(0, 8)}`}
    >
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// whoami"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Who Am <span className="text-accent-violet">I</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Session info, role, and cookie decoder.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TerminalWindow title="session">
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-fg-muted">user</span>
                <span className="text-accent-violet">{session.user.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">role</span>
                <span className="rounded-md border border-accent-violet/30 bg-accent-violet-soft px-2 py-0.5 text-xs text-accent-violet">
                  {session.user.role}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">session id</span>
                <span className="text-fg-faint">{sidShort}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">expires</span>
                <span className="text-fg-faint">{expiryLabel}</span>
              </div>
            </div>
          </TerminalWindow>

          <TerminalWindow title="cookie_decoder">
            <div className="space-y-3">
              <div>
                <p className="text-xs text-fg-muted">bastion_session cookie:</p>
                <div className="mt-1 overflow-x-auto rounded-md border border-border bg-background/60 p-2">
                  <code className="text-[11px] text-fg-faint break-all">
                    {`{ sid: "${sidShort}" }`}
                  </code>
                </div>
              </div>
              <div className="rounded-md border border-success/20 bg-success/5 px-3 py-2">
                <p className="text-xs text-success">✓ cookie contains only opaque session ID</p>
                <p className="mt-0.5 text-[11px] text-fg-faint">
                  no PII, no role, no email — all server-side
                </p>
              </div>
              <div className="text-[11px] text-fg-faint">
                signed with HMAC-SHA256 · httpOnly · sameSite: lax
              </div>
            </div>
          </TerminalWindow>
        </div>

        <TerminalWindow title="security_posture">
          <div className="space-y-3">
            <div className="grid gap-2 md:grid-cols-2">
              {SECURITY_POSTURE.map((item) => (
                <div key={item} className="flex items-start gap-2 text-xs">
                  <span className="text-fg-faint">·</span>
                  <span className="text-fg-muted">{item}</span>
                </div>
              ))}
            </div>
            <p className="border-t border-border pt-3 text-[11px] text-fg-faint">
              Static inventory of the controls this build implements — not a live probe. Each one is
              asserted by the test suite; see docs/ARCHITECTURE.md “Security invariants”.
            </p>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
