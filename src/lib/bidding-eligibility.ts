import { prisma } from "@/lib/db";

export interface Eligibility {
  ok: boolean;
  emailVerified: boolean;
  hasUsableCard: boolean;
  suspended: boolean;
}

/**
 * The three gates from spec §5: account + verified email + valid saved card —
 * plus not payment-suspended (§6: two failures until card re-verified).
 * Used by the account checklist now and the bid endpoint in step 3.
 */
export async function getEligibility(userId: string): Promise<Eligibility> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      biddingSuspendedAt: true,
      paymentMethods: {
        where: { status: { in: ["VALID", "EXPIRING_SOON"] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return { ok: false, emailVerified: false, hasUsableCard: false, suspended: false };

  const emailVerified = user.emailVerified !== null;
  const hasUsableCard = user.paymentMethods.length > 0;
  const suspended = user.biddingSuspendedAt !== null;
  return { ok: emailVerified && hasUsableCard && !suspended, emailVerified, hasUsableCard, suspended };
}
