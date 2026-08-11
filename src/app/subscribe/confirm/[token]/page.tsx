import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata = { title: "Alerts confirmed" };
export const dynamic = "force-dynamic";

/** Double opt-in confirmation for the drop-alert teaser list (CASL). */
export default async function ConfirmSubscribePage({ params }: { params: { token: string } }) {
  const sub = await prisma.emailSubscriber.findUnique({ where: { verifyToken: params.token } });
  if (sub && !sub.verifiedAt) {
    await prisma.emailSubscriber.update({
      where: { id: sub.id },
      data: { verifiedAt: new Date() },
    });
  }

  return (
    <div className="mx-auto max-w-md py-24 text-center">
      {sub ? (
        <>
          <p className="font-display text-4xl text-forest">You&apos;re on the list. 🌷</p>
          <p className="mt-4 text-charcoal/70">
            Tomorrow at 9 AM sharp, you&apos;ll hear from us. Until then —{" "}
            <Link href="/" className="underline">
              today&apos;s drop might still have something
            </Link>
            .
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-4xl text-forest">That link&apos;s expired or spent.</p>
          <p className="mt-4 text-charcoal/70">
            Pop your email into the box on the{" "}
            <Link href="/" className="underline">
              home page
            </Link>{" "}
            and we&apos;ll send a fresh one.
          </p>
        </>
      )}
    </div>
  );
}
