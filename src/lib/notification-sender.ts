import { NotificationEvent, NotificationLog, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { EVENT_POLICY, queueNotification } from "@/lib/notifications";
import { buildContent } from "@/lib/notification-templates";
import { emailConfigured, sendEmail } from "@/lib/email";
import { pushConfigured, sendPushToUser } from "@/lib/push";
import { sendSms, smsConfigured } from "@/lib/sms";
import { isQuietHoursInVancouver, vancouverParts } from "@/lib/time";

/**
 * Drains the QUEUED outbox (spec §7). Quiet hours (9 PM–8 AM local, per-user
 * adjustable) hold PUSH and SMS for non-critical events — rows simply stay
 * QUEUED and flow out after 8 AM. Email is silent on arrival, so it always
 * sends. An unconfigured channel marks rows FAILED (visible, not stuck).
 */

export interface Transports {
  email: (opts: {
    to: string;
    subject: string;
    heading: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
    unsubscribeUrl?: string;
  }) => Promise<void>;
  emailReady: () => boolean;
  push: (userId: string, payload: { title: string; body: string; url: string }) => Promise<void>;
  pushReady: () => boolean;
  sms: (to: string, body: string) => Promise<void>;
  smsReady: () => boolean;
}

const defaultTransports: Transports = {
  email: sendEmail,
  emailReady: emailConfigured,
  push: sendPushToUser,
  pushReady: pushConfigured,
  sms: sendSms,
  smsReady: smsConfigured,
};

let transports = defaultTransports;
/** Test seam. */
export function setTransports(t: Transports | null) {
  transports = t ?? defaultTransports;
}

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export interface DrainResult {
  sent: number;
  failed: number;
  heldQuietHours: number;
}

export async function drainNotifications(now = new Date(), batchSize = 100): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, failed: 0, heldQuietHours: 0 };
  const rows = await prisma.notificationLog.findMany({
    where: { status: "QUEUED" },
    orderBy: { createdAt: "asc" },
    take: batchSize,
    include: {
      user: {
        select: {
          email: true,
          phone: true,
          deletedAt: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          unsubscribeToken: true,
        },
      },
    },
  });

  for (const row of rows) {
    // Quiet hours hold: PUSH/SMS on non-exempt events wait for morning.
    const exempt = EVENT_POLICY[row.event].quietHoursExempt;
    if (
      !exempt &&
      row.channel !== "EMAIL" &&
      isQuietHoursInVancouver(now, row.user?.quietHoursStart ?? 21, row.user?.quietHoursEnd ?? 8)
    ) {
      result.heldQuietHours++;
      continue;
    }

    // Claim the row so overlapping drains can't double-send.
    const claimed = await prisma.notificationLog.updateMany({
      where: { id: row.id, status: "QUEUED" },
      data: { status: "SENT", sentAt: now }, // optimistic; reverted to FAILED on error
    });
    if (claimed.count === 0) continue;

    try {
      await deliver(row);
      result.sent++;
    } catch (e) {
      result.failed++;
      await prisma.notificationLog.update({
        where: { id: row.id },
        data: { status: "FAILED", sentAt: null, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return result;
}

type Row = NotificationLog & {
  user: {
    email: string;
    phone: string | null;
    deletedAt: Date | null;
    unsubscribeToken: string;
  } | null;
};

async function deliver(row: Row) {
  if (row.user?.deletedAt) throw new Error("user deleted");
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const content = buildContent(row.event, payload);
  const ctaUrl = `${appUrl()}${content.ctaPath}`;

  switch (row.channel) {
    case "EMAIL": {
      const to = row.user?.email ?? row.email;
      if (!to) throw new Error("no email recipient");
      if (!transports.emailReady()) throw new Error("email transport not configured");
      await transports.email({
        to,
        subject: content.subject,
        heading: content.heading,
        body: content.body,
        ctaLabel: content.ctaLabel,
        ctaUrl,
        unsubscribeUrl: row.user ? `${appUrl()}/unsubscribe/${row.user.unsubscribeToken}` : undefined,
      });
      return;
    }
    case "PUSH": {
      if (!row.userId) throw new Error("push requires a user");
      if (!transports.pushReady()) throw new Error("push transport not configured");
      await transports.push(row.userId, { title: content.pushTitle, body: content.pushBody, url: ctaUrl });
      return;
    }
    case "SMS": {
      if (!row.user?.phone) throw new Error("no phone on file");
      if (!transports.smsReady()) throw new Error("sms transport not configured");
      await transports.sms(row.user.phone, `${content.smsText} ${ctaUrl}`);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduled queuers — run from the minute cron, all idempotent via dedupe keys.
// ---------------------------------------------------------------------------

export interface ScheduleResult {
  dropLive: number;
  closingSoon: number;
  deliveryReminders: number;
}

export async function queueScheduledNotifications(now = new Date()): Promise<ScheduleResult> {
  const result: ScheduleResult = { dropLive: 0, closingSoon: 0, deliveryReminders: 0 };
  const { y, m, d, hour } = vancouverParts(now);
  const today = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // DROP_LIVE: once per local day, to everyone opted in, when a drop is live.
  // Cheap short-circuit: today's batch already queued → skip the user scan.
  const liveCount = await prisma.auction.count({ where: { status: { in: ["LIVE", "CLOSING_EXTENDED"] } } });
  const alreadyQueuedToday =
    liveCount > 0
      ? await prisma.notificationLog.findFirst({
          where: { event: "DROP_LIVE", dedupeKey: { startsWith: `DROP_LIVE:${today}:` } },
          select: { id: true },
        })
      : null;
  if (liveCount > 0 && !alreadyQueuedToday) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, emailVerified: { not: null } },
      select: { id: true },
    });
    for (const { id } of users) {
      await queueNotification({
        userId: id,
        event: "DROP_LIVE",
        dedupeKey: `DROP_LIVE:${today}:${id}`,
        payload: { date: today },
      });
    }
    // Teaser list (verified, not unsubscribed) — email-only rows.
    const subscribers = await prisma.emailSubscriber.findMany({
      where: { verifiedAt: { not: null }, unsubscribedAt: null },
      select: { email: true },
    });
    for (const { email } of subscribers) {
      try {
        await prisma.notificationLog.create({
          data: {
            email,
            event: "DROP_LIVE",
            channel: "EMAIL",
            status: "QUEUED",
            dedupeKey: `DROP_LIVE:${today}:sub:${email}`,
          },
        });
        result.dropLive++;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
    result.dropLive += users.length;
  }

  // CLOSING_SOON: 30 min out, push to everyone who has bid (dedupe = once per auction).
  const closingSoon = await prisma.auction.findMany({
    where: {
      status: { in: ["LIVE", "CLOSING_EXTENDED"] },
      currentEndAt: { gt: now, lte: new Date(now.getTime() + 30 * 60_000) },
    },
    select: { id: true, title: true, slug: true, participants: { select: { userId: true } } },
  });
  for (const auction of closingSoon) {
    for (const { userId } of auction.participants) {
      await queueNotification({
        userId,
        event: "CLOSING_SOON",
        dedupeKey: `CLOSING_SOON:${auction.id}:${userId}`,
        payload: { title: auction.title, slug: auction.slug },
      });
      result.closingSoon++;
    }
  }

  // DELIVERY_DETAILS_REMINDER: 2h after a paid win with no delivery form,
  // then again each morning at 7 AM local until the form is done.
  const needingDetails = await prisma.order.findMany({
    where: {
      status: "PAID",
      delivery: null,
      auction: { status: "PAID" },
      createdAt: { lte: new Date(now.getTime() - 2 * 3600_000) },
    },
    include: { auction: { select: { title: true } } },
  });
  for (const order of needingDetails) {
    await queueNotification({
      userId: order.userId,
      event: "DELIVERY_DETAILS_REMINDER",
      dedupeKey: `DDR:${order.id}:initial`,
      payload: { orderId: order.id, title: order.auction.title },
    });
    result.deliveryReminders++;
    if (hour === 7) {
      await queueNotification({
        userId: order.userId,
        event: "DELIVERY_DETAILS_REMINDER",
        dedupeKey: `DDR:${order.id}:${today}`,
        payload: { orderId: order.id, title: order.auction.title },
      });
    }
  }

  return result;
}

/** CASL one-click unsubscribe: turn off email for all non-critical events. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { unsubscribeToken: token }, select: { id: true } });
  if (user) {
    const nonCritical = (Object.keys(EVENT_POLICY) as NotificationEvent[]).filter(
      (e) => !EVENT_POLICY[e].quietHoursExempt, // critical/transactional events keep email
    );
    for (const event of nonCritical) {
      await prisma.notificationPref.upsert({
        where: { userId_event: { userId: user.id, event } },
        create: { userId: user.id, event, email: false, push: EVENT_POLICY[event].push, sms: EVENT_POLICY[event].sms },
        update: { email: false },
      });
    }
    return true;
  }
  const sub = await prisma.emailSubscriber.findUnique({ where: { unsubscribeToken: token } });
  if (sub) {
    await prisma.emailSubscriber.update({ where: { id: sub.id }, data: { unsubscribedAt: new Date() } });
    return true;
  }
  return false;
}
