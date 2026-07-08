import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const realtimeWsUrl = process.env.REALTIME_WS_URL || "";

  return NextResponse.json({ realtimeWsUrl });
}
