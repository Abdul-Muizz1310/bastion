import { NextResponse } from "next/server";
import { probe } from "@/platform/registry/health";
import { SERVICES, type ServiceId } from "@/platform/registry/products";

// Never cached: a stale "live" was served here on 2026-10-16.
export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 8_000;

export async function GET(): Promise<NextResponse> {
  const ids = Object.keys(SERVICES) as ServiceId[];
  const services = await Promise.all(ids.map((id) => probe(id, PROBE_TIMEOUT_MS)));
  return NextResponse.json(
    { services, timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
