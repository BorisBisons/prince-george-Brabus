import { NextResponse } from "next/server";
import { runAuctionSweep } from "@/lib/auction/close";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron target (every minute — see vercel.json). Idempotent: re-runs
 * and overlapping invocations settle into no-ops via guarded transitions.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await runAuctionSweep();
  return NextResponse.json(result);
}
