import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function Forbidden() {
  return (
    <PageFrame statusLeft="403 · forbidden" statusRight="bastion · control plane">
      <div className="mx-auto mt-16 max-w-xl">
        <TerminalWindow title="$ access denied" status="red">
          <div className="space-y-4 font-mono text-sm">
            <p className="text-error">403 · access denied</p>
            <p className="text-fg-muted">
              Your account does not have permission to view this resource. If you believe this is an
              error, contact an administrator.
            </p>
            <p className="text-fg-faint text-xs">
              {"// this denial has been recorded in the audit log"}
            </p>
            <div className="pt-2">
              <Link
                href="/dashboard"
                className="inline-block rounded-lg border border-accent-violet/40 bg-accent-violet-soft px-4 py-2 font-mono text-xs text-accent-violet transition-colors hover:bg-accent-violet/15"
              >
                ← back to dashboard
              </Link>
            </div>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
