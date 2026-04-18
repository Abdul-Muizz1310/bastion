import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function DossierNotFound() {
  return (
    <PageFrame statusLeft="404 · dossier not found" statusRight="bastion · control plane">
      <div className="mx-auto mt-16 max-w-xl">
        <TerminalWindow title="$ dossier not found" status="red">
          <div className="space-y-4 font-mono text-sm">
            <p className="text-error">404 · dossier not found</p>
            <p className="text-fg-muted">
              This dossier does not exist, or it may have been deleted. Double-check the URL —
              dossier ids are UUIDs.
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
