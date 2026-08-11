import Link from "next/link";
import { unsubscribeByToken } from "@/lib/notification-sender";

export const metadata = { title: "Unsubscribed" };
export const dynamic = "force-dynamic";

/** CASL one-click unsubscribe landing (also targeted by List-Unsubscribe). */
export default async function UnsubscribePage({ params }: { params: { token: string } }) {
  const ok = await unsubscribeByToken(params.token);

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      {ok ? (
        <>
          <p className="font-display text-4xl text-forest">You&apos;re unsubscribed.</p>
          <p className="mt-4 text-charcoal/70">
            No more marketing emails from us — only the essentials (wins, payments, delivery
            hiccups) will still reach you, because those are yours to know. Change your mind
            anytime in{" "}
            <Link href="/settings/notifications" className="underline">
              notification settings
            </Link>
            .
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-4xl text-forest">Hmm, that link&apos;s a dud.</p>
          <p className="mt-4 text-charcoal/70">
            We couldn&apos;t match that unsubscribe link. Manage everything in{" "}
            <Link href="/settings/notifications" className="underline">
              notification settings
            </Link>{" "}
            instead.
          </p>
        </>
      )}
    </div>
  );
}
