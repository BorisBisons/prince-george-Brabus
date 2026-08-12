import webpush from "web-push";
import { prisma } from "@/lib/db";

/** Web Push (VAPID). Dead subscriptions (404/410) are pruned on send. */

let configured: boolean | undefined;

export function pushConfigured(): boolean {
  if (configured !== undefined) return configured;
  const { NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  configured = Boolean(NEXT_PUBLIC_VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
  if (configured) {
    webpush.setVapidDetails(VAPID_SUBJECT!, NEXT_PUBLIC_VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
  }
  return configured;
}

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<void> {
  if (!pushConfigured()) throw new Error("push transport not configured");
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) throw new Error("no push subscriptions");

  let delivered = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
      delivered++;
      await prisma.pushSubscription.update({
        where: { id: sub.id },
        data: { lastUsedAt: new Date(), failCount: 0 },
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
      } else {
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { failCount: { increment: 1 } },
        });
      }
    }
  }
  if (delivered === 0) throw new Error("all push subscriptions failed");
}
