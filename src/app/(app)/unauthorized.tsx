import Link from "next/link";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";

export default function Unauthorized() {
  return (
    <PageFrame statusLeft="401 · session required" statusRight="bastion · control plane">
      <div className="mx-auto mt-16 max-w-xl">
        <TerminalWindow title="$ session required" status="yellow">
          <div className="space-y-4 font-mono text-sm">
            <p className="text-warning">401 · session required</p>
            <p className="text-fg-muted">
              You need to sign in to view this resource. Your session may have expired.
            </p>
            <div className="pt-2">
              <Link
                href="/login"
                className="inline-block rounded-lg bg-gradient-to-r from-accent-violet to-accent-rose px-4 py-2 font-mono text-xs font-semibold text-background transition-all hover:shadow-[0_0_30px_rgb(167_139_250_/_0.25)]"
              >
                sign in
              </Link>
            </div>
          </div>
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
