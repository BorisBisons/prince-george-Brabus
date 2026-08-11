import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { duplicateLastDrop, publishAuction, PublishError } from "@/lib/admin-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Drops" };
export const dynamic = "force-dynamic";

/** The ≤5-minute morning flow: duplicate → swap photos → tweak → publish. */
export default async function DropsPage({ searchParams }: { searchParams: { error?: string } }) {
  await requireAdmin();
  const drafts = await prisma.auction.findMany({
    where: { status: "DRAFT" },
    orderBy: { createdAt: "desc" },
    include: { photos: { orderBy: { position: "asc" }, take: 1 }, _count: { select: { photos: true } } },
  });
  const scheduled = await prisma.auction.findMany({
    where: { status: "SCHEDULED" },
    orderBy: { scheduledStartAt: "asc" },
    select: { id: true, title: true, scheduledStartAt: true, startPriceCents: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-forest">Tomorrow&apos;s drop</h1>
        <form
          action={async () => {
            "use server";
            const admin = await requireAdmin();
            await duplicateLastDrop(admin.id);
            revalidatePath("/admin/drops");
          }}
        >
          <Button variant="cta">Duplicate last drop</Button>
        </form>
      </div>

      {searchParams.error && (
        <p role="alert" className="rounded bg-rose-wash px-4 py-3 text-sm">
          {searchParams.error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Drafts</CardTitle>
        </CardHeader>
        <CardContent>
          {drafts.length === 0 ? (
            <p className="py-3 text-sm text-charcoal/60">
              No drafts. Tap &ldquo;Duplicate last drop&rdquo; and you&apos;re 80% done.
            </p>
          ) : (
            <ul className="divide-y divide-forest/10">
              {drafts.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    {d.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.photos[0].url} alt="" className="h-14 w-11 rounded object-cover" />
                    ) : (
                      <div className="grid h-14 w-11 place-items-center rounded bg-rose-wash text-xs">📷?</div>
                    )}
                    <div>
                      <p className="font-medium text-forest">{d.title}</p>
                      <p className="nums text-sm text-charcoal/60">
                        {formatCad(d.startPriceCents)} start · {d._count.photos} photo{d._count.photos === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/drops/${d.id}/edit`}>
                      <Button size="sm" variant="outline">
                        Edit
                      </Button>
                    </Link>
                    <form
                      action={async () => {
                        "use server";
                        const admin = await requireAdmin();
                        const { redirect } = await import("next/navigation");
                        try {
                          await publishAuction(d.id, admin.id);
                        } catch (e) {
                          if (e instanceof PublishError) {
                            redirect(`/admin/drops?error=${encodeURIComponent(e.message)}`);
                          }
                          throw e;
                        }
                        revalidatePath("/admin/drops");
                      }}
                    >
                      <Button size="sm">Publish</Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scheduled</CardTitle>
        </CardHeader>
        <CardContent>
          {scheduled.length === 0 ? (
            <p className="py-3 text-sm text-charcoal/60">Nothing queued for 9 AM yet.</p>
          ) : (
            <ul className="divide-y divide-forest/10">
              {scheduled.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3">
                  <p className="font-medium text-forest">{s.title}</p>
                  <p className="nums text-sm text-charcoal/60">
                    {formatCad(s.startPriceCents)} ·{" "}
                    {s.scheduledStartAt?.toLocaleString("en-CA", {
                      weekday: "short",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: "America/Vancouver",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
