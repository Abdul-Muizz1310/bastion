import { NextResponse } from "next/server";
import { getAggregatedStatus } from "@/lib/registry";

export const revalidate = 60; // ISR: revalidate every 60 seconds

export async function GET() {
  const statuses = await getAggregatedStatus();
  return NextResponse.json({ services: statuses, timestamp: new Date().toISOString() });
}
