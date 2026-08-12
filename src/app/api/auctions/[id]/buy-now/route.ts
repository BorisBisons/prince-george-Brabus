import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getEligibility } from "@/lib/bidding-eligibility";
import { buyNow, PaymentError } from "@/lib/payments";

export const dynamic = "force-dynamic";

/** LAST_CHANCE buy-now: first eligible buyer claims it, charged on the spot. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Sign in first", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  const eligibility = await getEligibility(session.user.id);
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: "Finish your bidding checklist first (verified email + a valid card).", code: "NOT_ELIGIBLE" },
      { status: 400 },
    );
  }

  try {
    const { orderId } = await buyNow(params.id, session.user.id);
    return NextResponse.json({ ok: true, orderId });
  } catch (e) {
    if (e instanceof PaymentError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }
}
