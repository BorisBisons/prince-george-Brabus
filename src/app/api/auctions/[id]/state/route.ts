import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildAuctionState } from "@/lib/auction/bidding";

export const dynamic = "force-dynamic";

/** Public auction state — realtime reconciliation + polling fallback. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  try {
    const state = await buildAuctionState(prisma, params.id, session?.user?.id);
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
