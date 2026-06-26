import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { RunDemoButton } from "@/features/dossier/components/RunDemoButton";
import { COOKIE_NAME, getSession } from "@/lib/auth/session";

export default async function RunPage() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore.get(COOKIE_NAME)?.value);
  if (!session) {
    redirect("/login?returnTo=%2Frun");
  }

  const canRun = session.user.role === "admin" || session.user.role === "editor";

  return (
    <PageFrame
      active="demo"
      role={session.user.role}
      userEmail={session.user.email}
      statusLeft={`role · ${session.user.role}`}
      statusRight="integrated demo"
    >
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// integrated_demo"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            End-to-End <span className="text-accent-violet">Demo</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Run a cross-service workflow through all 5 services via the bastion gateway.
          </p>
        </div>

        <TerminalWindow title="demo_runner" status="green">
          <RunDemoButton canRun={canRun} roleLabel={session.user.role} />
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
