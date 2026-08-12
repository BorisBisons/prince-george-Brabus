"use server";

import { revalidatePath } from "next/cache";
import { NotificationEvent } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EVENT_POLICY } from "@/lib/notifications";

/** Critical events can't be muted (mirrors the page's locked rows). */
const LOCKED: Set<NotificationEvent> = new Set(["WON", "PAYMENT_FAILED", "SECOND_CHANCE_OFFER", "DELIVERY_FAILED"]);

export async function savePrefs(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) return;
  const userId = session.user.id;

  for (const event of Object.keys(EVENT_POLICY) as NotificationEvent[]) {
    if (LOCKED.has(event)) continue;
    const email = formData.get(`${event}:email`) === "on";
    const push = formData.get(`${event}:push`) === "on";
    const sms = formData.get(`${event}:sms`) === "on" && process.env.SMS_ENABLED === "true";
    await prisma.notificationPref.upsert({
      where: { userId_event: { userId, event } },
      create: { userId, event, email, push, sms },
      update: { email, push, sms },
    });
  }
  revalidatePath("/settings/notifications");
}
