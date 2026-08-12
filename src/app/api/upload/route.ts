import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Photo upload (delivery proof + arrangement photos). Vercel Blob when
 * configured; data-URL passthrough as a keyless dev fallback (clients send
 * canvas-compressed webp ≤1200px, so payloads stay small).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Max 8 MB" }, { status: 400 });

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`photos/${Date.now()}-${file.name || "photo.webp"}`, file, {
      access: "public",
      contentType: file.type || "image/webp",
    });
    return NextResponse.json({ url: blob.url });
  }

  // Dev fallback: inline data URL (fine for local runs, not for production).
  const buf = Buffer.from(await file.arrayBuffer());
  return NextResponse.json({
    url: `data:${file.type || "image/webp"};base64,${buf.toString("base64")}`,
  });
}
