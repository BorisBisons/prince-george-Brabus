import { prisma } from "@/lib/db";

/**
 * Kill switch (spec §9): pause all auctions with a public banner, bids
 * preserved. Pause is a global overlay — no per-auction status churn. On
 * resume, every open auction's clock shifts forward by the pause duration,
 * so nobody loses time they'd otherwise have had to bid.
 */

const KEY = "kill_switch";

export interface KillSwitchState {
  active: boolean;
  banner: string | null;
  pausedAt: string | null;
}

export async function getKillSwitch(): Promise<KillSwitchState> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const value = (row?.value ?? {}) as Partial<KillSwitchState>;
  return { active: value.active ?? false, banner: value.banner ?? null, pausedAt: value.pausedAt ?? null };
}

export async function pauseAll(adminId: string, banner: string): Promise<void> {
  const current = await getKillSwitch();
  if (current.active) return;
  await prisma.setting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { active: true, banner, pausedAt: new Date().toISOString() } },
    update: { value: { active: true, banner, pausedAt: new Date().toISOString() } },
  });
  await prisma.auctionEvent.createMany({
    data: (
      await prisma.auction.findMany({
        where: { status: { in: ["LIVE", "CLOSING_EXTENDED", "SCHEDULED", "LAST_CHANCE"] } },
        select: { id: true },
      })
    ).map(({ id }) => ({
      auctionId: id,
      type: "SITE_PAUSED",
      actorType: "ADMIN" as const,
      actorId: adminId,
      payload: { banner },
    })),
  });
}

export async function resumeAll(adminId: string): Promise<void> {
  const current = await getKillSwitch();
  if (!current.active) return;
  const pausedAt = current.pausedAt ? new Date(current.pausedAt) : new Date();
  const shiftMs = Math.max(0, Date.now() - pausedAt.getTime());

  const open = await prisma.auction.findMany({
    where: { status: { in: ["LIVE", "CLOSING_EXTENDED"] } },
    select: { id: true, currentEndAt: true },
  });
  for (const auction of open) {
    if (!auction.currentEndAt) continue;
    await prisma.auction.update({
      where: { id: auction.id },
      data: { currentEndAt: new Date(auction.currentEndAt.getTime() + shiftMs) },
    });
    await prisma.auctionEvent.create({
      data: {
        auctionId: auction.id,
        type: "SITE_RESUMED_CLOCK_SHIFTED",
        actorType: "ADMIN",
        actorId: adminId,
        payload: { shiftMs },
      },
    });
  }
  // Last-chance windows shift too — a snow day shouldn't eat the buy-now window.
  const lastChance = await prisma.auction.findMany({
    where: { status: "LAST_CHANCE" },
    select: { id: true, lastChanceExpiresAt: true },
  });
  for (const auction of lastChance) {
    if (!auction.lastChanceExpiresAt) continue;
    await prisma.auction.update({
      where: { id: auction.id },
      data: { lastChanceExpiresAt: new Date(auction.lastChanceExpiresAt.getTime() + shiftMs) },
    });
  }

  await prisma.setting.update({
    where: { key: KEY },
    data: { value: { active: false, banner: null, pausedAt: null } },
  });
}
