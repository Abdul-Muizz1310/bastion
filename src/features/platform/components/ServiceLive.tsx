"use client";

import type { ReactNode } from "react";
import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { useHealthPoll } from "@/features/health/components/HealthProvider";
import type { ServiceId } from "@/platform/registry/products";
import { serviceFacts } from "../facts";
import { Commit } from "./Commit";

/**
 * One service's live cells on `/platform` (spec 21 §3.2): its state, version and commit from the
 * shared 30 s status poll. A failed poll makes it unknown and reports nothing, never a guess.
 */
export function ServiceLive({ service, repoUrl }: { service: ServiceId; repoUrl: string }) {
  const { snapshot } = useHealthPoll();
  const facts = serviceFacts(service, snapshot, repoUrl);
  return (
    <>
      <LiveCell label="health">
        <ServiceBadge state={facts.state} detail={facts.detail} />
      </LiveCell>
      <LiveCell label="version">
        {facts.version === null ? (
          <span className="text-fg-muted">not reported</span>
        ) : (
          <span translate="no" className="text-foreground">
            {facts.version}
          </span>
        )}
      </LiveCell>
      <LiveCell label="commit">
        <Commit commit={facts.commit} />
      </LiveCell>
    </>
  );
}

function LiveCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 lg:block">
      <dt className="w-16 shrink-0 text-[11px] uppercase tracking-[0.16em] text-fg-muted lg:sr-only">
        {label}
      </dt>
      <dd className="min-w-0 truncate tabular-nums">{children}</dd>
    </div>
  );
}
