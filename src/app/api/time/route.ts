import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Server time is truth — clients sync their countdowns to this (spec §11). */
export function GET() {
  return NextResponse.json({ now: new Date().toISOString() });
}
