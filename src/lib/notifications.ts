import { Channel, NotificationEvent, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Notification queue (spec §7). This step QUEUES with per-channel dedupe;
 * the senders (Resend / Web Push / Twilio-flagged) land in build-order
 * step 5 and drain QUEUED rows. Queuing now means every product event is
 * instrumented from day one and nothing double-sends later.
 */

interface EventPolicy {
  email: boolean;
  push: boolean;
  sms: boolean;
  /** Critical events ignore quiet hours (WON, payment, delivery failures). */
  quietHoursExempt: boolean;
}

/** Default channel matrix per event — users override per-row via NotificationPref. */
export const EVENT_POLICY: Record<NotificationEvent, EventPolicy> = {
  DROP_LIVE: { email: true, push: true, sms: false, quietHoursExempt: false },
  OUTBID: { email: true, push: true, sms: true, quietHoursExempt: false },
  MAX_BID_REACHED: { email: true, push: true, sms: false, quietHoursExempt: false },
  CLOSING_SOON: { email: false, push: true, sms: false, quietHoursExempt: false },
  WON: { email: true, push: true, sms: true, quietHoursExempt: true },
  LOST: { email: true, push: false, sms: false, quietHoursExempt: false },
  PAYMENT_FAILED: { email: true, push: true, sms: true, quietHoursExempt: true },
  SECOND_CHANCE_OFFER: { email: true, push: true, sms: true, quietHoursExempt: true },
  DELIVERY_DETAILS_REMINDER: { email: true, push: true, sms: false, quietHoursExempt: false },
  DELIVERY_SCHEDULED: { email: true, push: true, sms: false, quietHoursExempt: false },
  OUT_FOR_DELIVERY: { email: true, push: true, sms: false, quietHoursExempt: false },
  DELIVERED: { email: true, push: true, sms: false, quietHoursExempt: false },
  DELIVERY_FAILED: { email: true, push: true, sms: true, quietHoursExempt: true },
  LAST_CHANCE: { email: true, push: true, sms: false, quietHoursExempt: false },
};

const smsGloballyEnabled = () => process.env.SMS_ENABLED === "true";

export interface QueueInput {
  userId: string;
  event: NotificationEvent;
  /** Stable idempotency key for this logical notification (channel suffix added). */
  dedupeKey: string;
  payload?: Prisma.InputJsonValue;
}

/** Queue a notification on every channel the user + policy allow. Idempotent. */
export async function queueNotification(input: QueueInput): Promise<void> {
  const policy = EVENT_POLICY[input.event];
  const [pref, user] = await Promise.all([
    prisma.notificationPref.findUnique({
      where: { userId_event: { userId: input.userId, event: input.event } },
    }),
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { phone: true, deletedAt: true },
    }),
  ]);
  if (!user || user.deletedAt) return;

  const channels: Channel[] = [];
  if (pref?.email ?? policy.email) channels.push("EMAIL");
  if (pref?.push ?? policy.push) channels.push("PUSH");
  if ((pref?.sms ?? policy.sms) && smsGloballyEnabled() && user.phone) channels.push("SMS");

  for (const channel of channels) {
    try {
      await prisma.notificationLog.create({
        data: {
          userId: input.userId,
          event: input.event,
          channel,
          status: "QUEUED",
          dedupeKey: `${input.dedupeKey}:${channel}`,
          payload: input.payload,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue; // already queued
      throw e;
    }
  }
}
