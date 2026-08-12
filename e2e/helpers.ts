import { PrismaClient } from "@prisma/client";
import type { BrowserContext, APIRequestContext } from "@playwright/test";

export const prisma = new PrismaClient();

/** Sign a user in by planting a database session + cookie. */
export async function signIn(context: BrowserContext, userId: string): Promise<string> {
  const token = `e2e-${userId}-${Math.random().toString(36).slice(2)}`;
  await prisma.session.create({
    data: {
      sessionToken: token,
      userId,
      expires: new Date(Date.now() + 86400e3),
    },
  });
  await context.addCookies([
    { name: "authjs.session-token", value: token, domain: "localhost", path: "/" },
  ]);
  return token;
}

export async function createLiveAuction(slug: string, minutesLeft: number, startPriceCents = 5000) {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  return prisma.auction.create({
    data: {
      slug,
      title: slug,
      description: "e2e arrangement",
      status: "LIVE",
      startPriceCents,
      createdById: owner.id,
      scheduledStartAt: new Date(Date.now() - 3600e3),
      scheduledEndAt: new Date(Date.now() + minutesLeft * 60e3),
      currentEndAt: new Date(Date.now() + minutesLeft * 60e3),
      photos: {
        create: [{ url: "/seed/arrangement-1.webp", width: 1200, height: 1500, position: 0 }],
      },
    },
  });
}

export async function setFakeGatewayMode(mode: "succeed" | "fail") {
  await prisma.setting.upsert({
    where: { key: "fake_gateway_mode" },
    create: { key: "fake_gateway_mode", value: { mode } },
    update: { value: { mode } },
  });
}

/** Force an auction past its close and run the cron sweep. */
export async function forceCloseAndSweep(request: APIRequestContext, auctionId: string) {
  await prisma.auction.update({
    where: { id: auctionId },
    data: { currentEndAt: new Date(Date.now() - 1000) },
  });
  const res = await request.get("/api/cron/close", {
    headers: { Authorization: "Bearer e2e-cron-secret" },
  });
  if (!res.ok()) throw new Error(`cron sweep failed: ${res.status()}`);
}

export async function runSweep(request: APIRequestContext) {
  const res = await request.get("/api/cron/close", {
    headers: { Authorization: "Bearer e2e-cron-secret" },
  });
  if (!res.ok()) throw new Error(`cron sweep failed: ${res.status()}`);
}
