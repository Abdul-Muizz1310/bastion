"use client";

import { ServiceBadge } from "@/components/platform/ServiceBadge";
import { useHealthPoll } from "@/features/health/components/HealthProvider";
import { nodeHealth } from "@/features/health/model";
import type { ServiceId } from "@/platform/registry/products";

/** A product's health on the workbench index, from the shared 30 s status poll (spec 21 §3.1). */
export function ProductHealth({ services }: { services: readonly ServiceId[] }) {
  const { snapshot } = useHealthPoll();
  const { state, detail } = nodeHealth(services, snapshot);
  return <ServiceBadge state={state} detail={detail} />;
}
