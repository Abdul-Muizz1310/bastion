import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "bastion",
    timestamp: new Date().toISOString(),
  });
}
