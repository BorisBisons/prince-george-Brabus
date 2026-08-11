import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { formatCad } from "@/lib/utils";

/**
 * Satori needs absolute URLs and doesn't decode webp — our photos are webp
 * (site-relative in dev, Blob URLs in prod), so inline everything as a JPEG
 * data URL via sharp.
 */
async function resolvePhoto(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  try {
    let source: Buffer;
    if (url.startsWith("/")) {
      source = await readFile(join(process.cwd(), "public", url));
    } else {
      const res = await fetch(url);
      if (!res.ok) return undefined;
      source = Buffer.from(await res.arrayBuffer());
    }
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(source).resize(504, 630, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export const runtime = "nodejs";
export const alt = "BloomBid auction";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Auto-generated share card (spec §10): photo + live price + close time.
 * This is what makes an auction link look gorgeous in iMessage.
 */
export default async function OgImage({ params }: { params: { slug: string } }) {
  const auction = await prisma.auction.findUnique({
    where: { slug: params.slug },
    include: {
      currentBid: { select: { amountCents: true } },
      photos: { orderBy: { position: "asc" }, take: 1 },
    },
  });

  const title = auction?.title ?? "BloomBid";
  const price = formatCad(auction?.currentBid?.amountCents ?? auction?.startPriceCents ?? 0);
  const open = auction && ["LIVE", "CLOSING_EXTENDED"].includes(auction.status);
  const closes = auction?.currentEndAt
    ? new Date(auction.currentEndAt).toLocaleTimeString("en-CA", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Vancouver",
      })
    : null;
  const line = open && closes ? `Current bid ${price} — closes ${closes}` : `Went for ${price}`;
  const photoUrl = await resolvePhoto(auction?.photos[0]?.url);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#1E3A2F",
          color: "#FAF7F2",
        }}
      >
        {photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            width={504}
            height={630}
            style={{ objectFit: "cover", width: 504, height: 630 }}
          />
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "0 64px",
            gap: 24,
          }}
        >
          <div style={{ fontSize: 34, color: "#C9A96A", letterSpacing: 2 }}>BloomBid</div>
          <div style={{ fontSize: 64, lineHeight: 1.1, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 34, color: "#D8A7B1" }}>{line}</div>
          <div style={{ fontSize: 24, color: "#FAF7F2", opacity: 0.7 }}>
            Daily flower auctions · Prince George
          </div>
        </div>
      </div>
    ),
    size,
  );
}
