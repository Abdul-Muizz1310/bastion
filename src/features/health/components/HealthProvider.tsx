"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { documentVisibility, fetchPlatformStatus } from "../client";
import type { StatusSnapshot } from "../model";
import { startStatusPoll } from "../poll";

/**
 * The one client island behind the live map (spec 21 §3.1): it polls GET /api/platform/status every
 * 30 s and hands the latest snapshot to the small health leaves inside server-rendered markup.
 */

export const POLL_INTERVAL_MS = 30_000;

type HealthPoll = { snapshot: StatusSnapshot; intervalMs: number };

const CHECKING: StatusSnapshot = { phase: "checking" };

const HealthContext = createContext<HealthPoll>({
  snapshot: CHECKING,
  intervalMs: POLL_INTERVAL_MS,
});

export function HealthProvider({
  children,
  initial = CHECKING,
  intervalMs = POLL_INTERVAL_MS,
}: {
  children: ReactNode;
  /** The snapshot to render before the first poll answers (tests seed it). */
  initial?: StatusSnapshot;
  intervalMs?: number;
}) {
  const [snapshot, setSnapshot] = useState<StatusSnapshot>(initial);

  useEffect(
    () =>
      startStatusPoll({
        fetchStatus: (signal) => fetchPlatformStatus(signal),
        onSnapshot: setSnapshot,
        intervalMs,
        visibility: documentVisibility(),
      }),
    [intervalMs],
  );

  return <HealthContext value={{ snapshot, intervalMs }}>{children}</HealthContext>;
}

export function useHealthPoll(): HealthPoll {
  return useContext(HealthContext);
}
