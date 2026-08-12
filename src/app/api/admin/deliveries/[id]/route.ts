import { NextResponse } from "next/server";
import { z } from "zod";
import { adminIdOrNull } from "@/lib/admin";
import {
  completeDelivery,
  completePickup,
  failDelivery,
  DeliveryError,
} from "@/lib/delivery";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delivered"),
    photoUrl: z.string().min(1),
    gpsLat: z.number().optional(),
    gpsLng: z.number().optional(),
  }),
  z.object({
    action: z.literal("failed"),
    reason: z.enum(["RECIPIENT_UNREACHABLE", "WRONG_ADDRESS", "RECIPIENT_REFUSED", "OUR_FAULT", "OTHER"]),
    note: z.string().min(1),
    photoUrl: z.string().optional(),
  }),
  z.object({ action: z.literal("pickup_done"), photoUrl: z.string().optional() }),
  z.object({ action: z.literal("skip") }),
]);

/**
 * Driver ops endpoint for the run sheet. Plain POST (not a server action) so
 * the offline queue can replay requests verbatim when the connection returns.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const adminId = await adminIdOrNull();
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const body = parsed.data;

  try {
    switch (body.action) {
      case "delivered":
        await completeDelivery(params.id, adminId, {
          photoUrl: body.photoUrl,
          gpsLat: body.gpsLat,
          gpsLng: body.gpsLng,
        });
        break;
      case "failed":
        await failDelivery(params.id, adminId, {
          reason: body.reason,
          note: body.note,
          photoUrl: body.photoUrl,
        });
        break;
      case "pickup_done":
        await completePickup(params.id, adminId, body.photoUrl);
        break;
      case "skip": {
        // Push to the end of today's route (soft action, no status change).
        const max = await prisma.delivery.aggregate({
          where: { scheduledDate: (await prisma.delivery.findUniqueOrThrow({ where: { id: params.id } })).scheduledDate },
          _max: { routePosition: true },
        });
        await prisma.delivery.update({
          where: { id: params.id },
          data: { routePosition: (max._max.routePosition ?? 0) + 1 },
        });
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DeliveryError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
