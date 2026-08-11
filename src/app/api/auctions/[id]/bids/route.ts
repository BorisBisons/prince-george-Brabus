import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BidError, buildAuctionState, placeBid } from "@/lib/auction/bidding";
import { broadcastAuction } from "@/lib/realtime";
import { queueNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    amountCents: z.number().int().positive().max(5_000_00).optional(),
    maxBidCents: z.number().int().positive().max(5_000_00).optional(),
  })
  .refine((b) => b.amountCents !== undefined || b.maxBidCents !== undefined, {
    message: "Enter a bid or a max bid",
  });

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in to bid", code: "UNAUTHENTICATED" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid amount", code: "INVALID" }, { status: 400 });
  }

  try {
    const outcome = await placeBid({
      auctionId: params.id,
      userId: session.user.id,
      amountCents: parsed.data.amountCents,
      maxBidCents: parsed.data.maxBidCents,
    });

    // Post-commit side effects — a shaped public snapshot, then notifications.
    const state = await buildAuctionState(prisma, params.id);
    await broadcastAuction(params.id, "bid", state);

    if (outcome.outbidUserId) {
      await queueNotification({
        userId: outcome.outbidUserId,
        event: "OUTBID",
        dedupeKey: `OUTBID:${params.id}:${outcome.outbidUserId}:${outcome.priceCents}`,
        payload: { auctionId: params.id, priceCents: outcome.priceCents, slug: state.slug },
      });
    }
    for (const userId of outcome.ceilingReachedUserIds) {
      await queueNotification({
        userId,
        event: "MAX_BID_REACHED",
        dedupeKey: `MAX_BID_REACHED:${params.id}:${userId}:${outcome.priceCents}`,
        payload: { auctionId: params.id, priceCents: outcome.priceCents, slug: state.slug },
      });
    }

    return NextResponse.json({
      outcome: {
        youAreLeading: outcome.youAreLeading,
        priceCents: outcome.priceCents,
        extended: outcome.extended,
        endAt: outcome.endAt.toISOString(),
      },
      state: await buildAuctionState(prisma, params.id, session.user.id),
    });
  } catch (e) {
    if (e instanceof BidError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
}
