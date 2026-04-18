import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function WhoamiPage() {
  return (
    <PageFrame active="whoami">
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
                <span className="text-accent-violet">demo-admin@bastion.local</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">role</span>
                <span className="rounded-md border border-accent-violet/30 bg-accent-violet-soft px-2 py-0.5 text-xs text-accent-violet">
                  admin
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">session id</span>
                <span className="text-fg-faint">a1b2c3d4-…</span>
              </div>
              <div className="flex justify-between">
                <span className="text-fg-muted">expires</span>
                <span className="text-fg-faint">in 23h 42m</span>
              </div>
            </div>
          </TerminalWindow>

          <TerminalWindow title="cookie_decoder">
            <div className="space-y-3">
              <div>
                <p className="text-xs text-fg-muted">bastion_session cookie:</p>
                <div className="mt-1 overflow-x-auto rounded-md border border-border bg-background/60 p-2">
                  <code className="text-[11px] text-fg-faint break-all">
                    {'{ sid: "a1b2c3d4-..." }'}
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

        <TerminalWindow title="security_checklist">
          <div className="grid gap-2 md:grid-cols-2">
            {[
              "httpOnly cookie",
              "HMAC-sealed SID",
              "no PII in cookie",
              "CSRF double-submit",
              "rate-limited auth",
              "RBAC enforced",
              "CSP header",
              "X-Frame-Options: DENY",
              "append-only audit",
              "Ed25519 JWT gateway",
              "request ID tracing",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2 text-xs">
                <span className="text-success">✓</span>
                <span className="text-fg-muted">{item}</span>
              </div>
            ))}
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
