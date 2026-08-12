import { redirect } from "next/navigation";
import { NotificationEvent } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EVENT_POLICY } from "@/lib/notifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PushOptIn } from "@/components/push-opt-in";
import { savePrefs } from "./actions";

export const metadata = { title: "Notification settings" };
export const dynamic = "force-dynamic";

/** Human labels, in display order (spec §7 matrix). */
const EVENT_LABELS: Array<[NotificationEvent, string]> = [
  ["DROP_LIVE", "Daily drop is live (9 AM)"],
  ["OUTBID", "You've been outbid"],
  ["MAX_BID_REACHED", "Your max bid was passed"],
  ["CLOSING_SOON", "30 minutes to close"],
  ["WON", "You won 🎉"],
  ["LOST", "Auction ended without you"],
  ["PAYMENT_FAILED", "Payment needs attention"],
  ["SECOND_CHANCE_OFFER", "Second-chance offer"],
  ["DELIVERY_DETAILS_REMINDER", "Delivery details reminder"],
  ["DELIVERY_SCHEDULED", "Delivery scheduled"],
  ["OUT_FOR_DELIVERY", "Out for delivery"],
  ["DELIVERED", "Delivered (with photo)"],
  ["DELIVERY_FAILED", "Delivery problem"],
  ["LAST_CHANCE", "Last-chance buy now"],
];

/** Critical events keep email + push on — you can't miss your own win. */
const LOCKED: Set<NotificationEvent> = new Set(["WON", "PAYMENT_FAILED", "SECOND_CHANCE_OFFER", "DELIVERY_FAILED"]);

export default async function NotificationSettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const prefs = await prisma.notificationPref.findMany({ where: { userId: session.user.id } });
  const prefMap = new Map(prefs.map((p) => [p.event, p]));
  const smsEnabled = process.env.SMS_ENABLED === "true";

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-display text-4xl text-forest">Notifications</h1>

      <Card>
        <CardHeader>
          <CardTitle>Push on this device</CardTitle>
        </CardHeader>
        <CardContent>
          <PushOptIn />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What we send, and where</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-charcoal/60">
            Quiet hours run 9 PM–8 AM — push{smsEnabled ? " and SMS" : ""} wait for morning, except
            wins and payment emergencies. Every email has one-click unsubscribe.
          </p>
          <form action={savePrefs}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-forest/10 text-left text-forest">
                    <th className="py-2 pr-2 font-medium">Event</th>
                    <th className="px-2 py-2 text-center font-medium">Email</th>
                    <th className="px-2 py-2 text-center font-medium">Push</th>
                    {smsEnabled && <th className="px-2 py-2 text-center font-medium">SMS</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-forest/5">
                  {EVENT_LABELS.map(([event, label]) => {
                    const pref = prefMap.get(event);
                    const policy = EVENT_POLICY[event];
                    const locked = LOCKED.has(event);
                    return (
                      <tr key={event}>
                        <td className="py-2.5 pr-2">
                          {label}
                          {locked && <span className="ml-1.5 text-xs text-charcoal/40">(always on)</span>}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <input
                            type="checkbox"
                            name={`${event}:email`}
                            defaultChecked={pref?.email ?? policy.email}
                            disabled={locked}
                            className="h-4 w-4 accent-[#1E3A2F]"
                            aria-label={`${label} — email`}
                          />
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <input
                            type="checkbox"
                            name={`${event}:push`}
                            defaultChecked={pref?.push ?? policy.push}
                            disabled={locked}
                            className="h-4 w-4 accent-[#1E3A2F]"
                            aria-label={`${label} — push`}
                          />
                        </td>
                        {smsEnabled && (
                          <td className="px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              name={`${event}:sms`}
                              defaultChecked={pref?.sms ?? policy.sms}
                              disabled={locked}
                              className="h-4 w-4 accent-[#1E3A2F]"
                              aria-label={`${label} — SMS`}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Button type="submit" className="mt-5">
              Save preferences
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
