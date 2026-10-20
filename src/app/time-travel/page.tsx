import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { PageFrame } from "@/components/terminal/PageFrame";
import { TimeTravelSlider } from "@/features/time-travel/components/TimeTravelSlider";
import { toTimeTravelView } from "@/features/time-travel/to-view";
import { getTimeTravelState } from "@/lib/audit/replay";

export const metadata: Metadata = { title: "time travel" };

/**
 * `/time-travel` (spec 07, spec 21 §3.2): the platform as it stood at any moment, rebuilt from the
 * append-only log alone — no snapshot table. Public; rendered per request and seeded with the
 * state now; every later position is read by the slider through its Server Action.
 */
export default async function TimeTravelPage() {
  await connection();
  const asOf = new Date();
  const initial = toTimeTravelView(await getTimeTravelState({ asOf }), asOf);

  return (
    <PageFrame active="time-travel" statusRight="replayed from the audit log">
      <div className="space-y-10">
        <header className="max-w-3xl">
          <p aria-hidden="true" className="font-mono text-xs text-fg-muted">
            ~/muizz-lab/bastion <span className="text-accent-violet">$</span> replay --as-of
          </p>
          <h1 className="mt-5 font-display text-[2.4rem] leading-[1.05] font-bold tracking-[-0.02em] sm:text-5xl">
            time travel
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-fg-muted text-pretty">
            <span className="text-foreground">The platform as it stood at any moment.</span> Every
            dossier, every gateway capability and every v1 record is rebuilt from its latest event
            at or before the time you pick — straight from the{" "}
            <Link
              href="/audit"
              className="text-accent-violet underline decoration-dotted underline-offset-4 hover:text-foreground"
            >
              append-only log
            </Link>
            , with no snapshot table that could drift from it.
          </p>
        </header>

        <TimeTravelSlider initial={initial} />
      </div>
    </PageFrame>
  );
}
