import { NextResponse } from "next/server";
import { probe } from "@/platform/registry/health";
import { SERVICES, type ServiceId } from "@/platform/registry/products";
import {
  createStatusCache,
  STATUS_TTL_MS,
  type StatusBody,
  statusStoreFromEnv,
} from "@/platform/registry/status-cache";

// Rendered per request; what is shared is the probe round (Ruling AE), never a stale build output
// (a build-time "live" was served here on 2026-10-16).
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 8_000;

async function probeAll(): Promise<StatusBody> {
  const ids = Object.keys(SERVICES) as ServiceId[];
  const services = await Promise.all(ids.map((id) => probe(id, PROBE_TIMEOUT_MS)));
  return { services, timestamp: new Date().toISOString() };
}

const cache = createStatusCache({ probeAll, store: statusStoreFromEnv() });

export async function GET(): Promise<NextResponse> {
  const body = await cache.get();
  return NextResponse.json(body, {
    headers: { "cache-control": `public, s-maxage=${STATUS_TTL_MS / 1000}` },
  });
}
