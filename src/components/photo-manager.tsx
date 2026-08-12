"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Admin photo manager: multi-photo picker, client-side center-crop to 4:5 at
 * ≥1200px, webp compression — the §3 photography rules enforced at the door.
 */
export function PhotoManager({
  auctionId,
  photos,
}: {
  auctionId: string;
  photos: { id: string; url: string; position: number }[];
}) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function processFile(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
    const bitmap = await createImageBitmap(file);
    // Center-crop to 4:5
    const targetRatio = 4 / 5;
    let cropW = bitmap.width;
    let cropH = Math.round(cropW / targetRatio);
    if (cropH > bitmap.height) {
      cropH = bitmap.height;
      cropW = Math.round(cropH * targetRatio);
    }
    const sx = Math.round((bitmap.width - cropW) / 2);
    const sy = Math.round((bitmap.height - cropH) / 2);
    if (cropW < 1200) {
      setError(`"${file.name}" is under 1200px wide after the 4:5 crop — needs a bigger photo.`);
      return null;
    }
    const outW = Math.min(cropW, 1600);
    const outH = Math.round(outW / targetRatio);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    canvas.getContext("2d")!.drawImage(bitmap, sx, sy, cropW, cropH, 0, 0, outW, outH);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
    return blob ? { blob, width: outW, height: outH } : null;
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    for (const file of Array.from(files)) {
      const processed = await processFile(file);
      if (!processed) continue;
      const form = new FormData();
      form.append("file", new File([processed.blob], "arrangement.webp", { type: "image/webp" }));
      const up = await fetch("/api/upload", { method: "POST", body: form });
      if (!up.ok) {
        setError("Upload failed — try again.");
        continue;
      }
      const { url } = await up.json();
      await fetch(`/api/admin/auctions/${auctionId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, width: processed.width, height: processed.height }),
      });
    }
    setBusy(false);
    router.refresh();
  }

  async function remove(photoId: string) {
    await fetch(`/api/admin/auctions/${auctionId}/photos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {photos.map((p) => (
          <div key={p.id} className="group relative overflow-hidden rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="aspect-[4/5] w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="absolute right-1.5 top-1.5 rounded-full bg-charcoal/70 px-2 py-0.5 text-xs text-cream opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="grid aspect-[4/5] place-items-center rounded border-2 border-dashed border-forest/25 text-sm text-forest/60 hover:border-forest/50"
        >
          {busy ? "Processing…" : "+ Add photos"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />
      <p className="text-xs text-charcoal/50">
        Photos are auto-cropped to 4:5, need ≥1200px width, and compress to webp.
      </p>
      {error && (
        <p role="alert" className="text-sm text-charcoal/80">
          {error}
        </p>
      )}
    </div>
  );
}
