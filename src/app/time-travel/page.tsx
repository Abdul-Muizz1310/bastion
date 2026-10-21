import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { PageFrame } from "@/components/terminal/PageFrame";
import { ReadLimited } from "@/features/audit/components/ReadLimited";
import { allowRead } from "@/features/audit/read-limit";
import { TimeTravelSlider } from "@/features/time-travel/components/TimeTravelSlider";
import { toTimeTravelView } from "@/features/time-travel/to-view";
import { getTimeTravelState } from "@/lib/audit/replay";
import { SITE } from "@/lib/site/config";
import { pageMetadata } from "@/lib/site/metadata";

export const metadata: Metadata = pageMetadata(SITE, "/time-travel", {
  title: "time travel",
  description:
    "Rewind the platform to any moment. Every dossier and capability is rebuilt from its latest event in the append-only log, with no snapshot to drift.",
});

/**
 * `/time-travel` (spec 07, spec 21 §3.2): the platform as it stood at any moment, rebuilt from the
 * append-only log alone — no snapshot table. Public; rendered per request and seeded with the
 * state now; every later position is read by the slider through its Server Action.
 */
export default async function TimeTravelPage() {
  await connection();
  // Ruling AL: the first replay spends one of the visitor's 60 a minute, like every slider move.
  const allowance = await allowRead("replay");
  let body: ReactNode;
  if (allowance.ok) {
    const asOf = new Date();
    body = (
      <TimeTravelSlider initial={toTimeTravelView(await getTimeTravelState({ asOf }), asOf)} />
    );
  } else {
    body = <ReadLimited retryAfterS={allowance.retryAfterS} limit={allowance.limit} />;
  }

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

        {body}
      </div>
    </PageFrame>
  );
}
