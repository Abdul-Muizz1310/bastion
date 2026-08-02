import { PageFrame } from "@/components/terminal/PageFrame";
import { TerminalWindow } from "@/components/terminal/TerminalWindow";
import { TimeTravelSlider } from "@/features/time-travel/components/TimeTravelSlider";
import { toTimeTravelView } from "@/features/time-travel/view";
import { getTimeTravelState } from "@/lib/audit/replay";
import { requireRole } from "@/lib/auth/rbac";

export default async function TimeTravelPage() {
  await requireRole(["admin"], "time-travel.view");

  // Seed the first paint with the current state; every subsequent position the
  // user drags to is fetched by the client slider through the Server Action.
  const asOf = new Date();
  const initial = toTimeTravelView(await getTimeTravelState({ asOf }), asOf);

  return (
    <PageFrame active="time-travel">
      <div className="space-y-8">
        <div>
          <p className="font-mono text-xs text-fg-faint">{"// time_travel"}</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight md:text-4xl">
            Time <span className="text-accent-violet">Travel</span>
          </h1>
          <p className="mt-2 font-mono text-sm text-fg-muted">
            Rewind the audit log to any point in time. Admin only.
          </p>
        </div>

        <TerminalWindow title="time_slider">
          <TimeTravelSlider initial={initial} />
        </TerminalWindow>
      </div>
    </PageFrame>
  );
}
