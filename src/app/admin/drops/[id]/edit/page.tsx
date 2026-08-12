import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { publishAuction, PublishError } from "@/lib/admin-ops";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhotoManager } from "@/components/photo-manager";

export const metadata = { title: "Edit draft" };
export const dynamic = "force-dynamic";

export default async function EditDraftPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  await requireAdmin();
  const auction = await prisma.auction.findUnique({
    where: { id: params.id },
    include: { photos: { orderBy: { position: "asc" } } },
  });
  if (!auction || auction.status !== "DRAFT") notFound();

  async function save(formData: FormData) {
    "use server";
    await requireAdmin();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const priceDollars = Number.parseFloat(String(formData.get("startPrice") ?? "0"));
    const slug = String(formData.get("slug") ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (!title || !slug || !Number.isFinite(priceDollars) || priceDollars <= 0) return;
    await prisma.auction.update({
      where: { id: params.id },
      data: { title, description, slug, startPriceCents: Math.round(priceDollars * 100) },
    });
    revalidatePath(`/admin/drops/${params.id}/edit`);
  }

  async function publish() {
    "use server";
    const admin = await requireAdmin();
    try {
      await publishAuction(params.id, admin.id);
    } catch (e) {
      if (e instanceof PublishError) {
        redirect(`/admin/drops/${params.id}/edit?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
    redirect("/admin/drops");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="font-display text-3xl text-forest">Edit draft</h1>
      {searchParams.error && (
        <p role="alert" className="rounded bg-rose-wash px-4 py-3 text-sm">
          {searchParams.error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <PhotoManager
            auctionId={auction.id}
            photos={auction.photos.map((p) => ({ id: p.id, url: p.url, position: p.position }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={save} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input id="title" name="title" defaultValue={auction.title} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="slug">Slug</Label>
              <Input id="slug" name="slug" defaultValue={auction.slug} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <textarea
                id="description"
                name="description"
                rows={3}
                defaultValue={auction.description}
                className="flex w-full rounded border border-forest/20 bg-white px-4 py-2.5 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="startPrice">Start price (CAD)</Label>
              <Input
                id="startPrice"
                name="startPrice"
                inputMode="decimal"
                defaultValue={(auction.startPriceCents / 100).toFixed(0)}
                required
              />
            </div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>

      <form action={publish}>
        <Button variant="cta" size="lg" className="w-full">
          Publish for the next 9 AM drop
        </Button>
      </form>
    </div>
  );
}
