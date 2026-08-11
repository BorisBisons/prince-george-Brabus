import { NextResponse } from "next/server";
import { runAuctionSweep } from "@/lib/auction/close";
import { runPaymentSweep } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron target (every minute — see vercel.json). Runs the auction
 * sweep (open/close/expire/watchdog) then the payment sweep (charge retries,
 * offer expiry). Idempotent: re-runs and overlapping invocations settle into
 * no-ops via guarded transitions and claim-before-charge.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auctions = await runAuctionSweep();
  const payments = await runPaymentSweep();
  return NextResponse.json({ ...auctions, payments });
}
