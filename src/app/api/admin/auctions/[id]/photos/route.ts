import { NextResponse } from "next/server";
import { z } from "zod";
import { adminIdOrNull } from "@/lib/admin";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const adminId = await adminIdOrNull();
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const schema = z.object({ url: z.string().min(1), width: z.number().int().min(1200), height: z.number().int() });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad photo payload" }, { status: 400 });

  const max = await prisma.auctionPhoto.aggregate({
    where: { auctionId: params.id },
    _max: { position: true },
  });
  const photo = await prisma.auctionPhoto.create({
    data: {
      auctionId: params.id,
      url: parsed.data.url,
      width: parsed.data.width,
      height: parsed.data.height,
      position: (max._max.position ?? -1) + 1,
    },
  });
  return NextResponse.json({ ok: true, photoId: photo.id });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const adminId = await adminIdOrNull();
  if (!adminId) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const { photoId } = await req.json().catch(() => ({}));
  if (typeof photoId === "string") {
    await prisma.auctionPhoto.deleteMany({ where: { id: photoId, auctionId: params.id } });
  }
  return NextResponse.json({ ok: true });
}
