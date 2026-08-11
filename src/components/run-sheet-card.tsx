"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * One stop on the run sheet — built for gloves-and-daylight phone use.
 * Delivered forces a photo (camera capture); writes queue to localStorage
 * when offline and replay on reconnect.
 */

export interface StopData {
  deliveryId: string;
  routePosition: number | null;
  recipientName: string;
  businessName: string;
  addressLine1: string;
  postalCode: string;
  window: string;
  giftNote: string | null;
  buyerPhone: string;
  attemptCount: number;
  isPickup: boolean;
  outForDelivery: boolean;
}

const QUEUE_KEY = "bloombid-runsheet-queue";

interface QueuedWrite {
  deliveryId: string;
  body: Record<string, unknown>;
}

function readQueue(): QueuedWrite[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeQueue(q: QueuedWrite[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

async function postAction(deliveryId: string, body: Record<string, unknown>): Promise<"ok" | "queued" | string> {
  try {
    const res = await fetch(`/api/admin/deliveries/${deliveryId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return "ok";
    const data = await res.json().catch(() => ({}));
    return data.error ?? `HTTP ${res.status}`;
  } catch {
    // Offline: queue and reconcile later.
    writeQueue([...readQueue(), { deliveryId, body }]);
    return "queued";
  }
}

/** Flush queued writes; runs on mount and on the browser 'online' event. */
export function useOfflineFlush(onFlushed: () => void) {
  React.useEffect(() => {
    async function flush() {
      const queue = readQueue();
      if (queue.length === 0) return;
      const remaining: QueuedWrite[] = [];
      for (const item of queue) {
        const result = await postAction(item.deliveryId, item.body);
        if (result === "queued") remaining.push(item);
      }
      writeQueue(remaining);
      if (remaining.length < queue.length) onFlushed();
    }
    void flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [onFlushed]);
}

const WINDOW_LABEL: Record<string, string> = { W10_12: "10–12", W12_15: "12–3", W15_17: "3–5" };

const FAIL_REASONS = [
  ["RECIPIENT_UNREACHABLE", "Recipient unreachable"],
  ["WRONG_ADDRESS", "Wrong address"],
  ["RECIPIENT_REFUSED", "Recipient refused"],
  ["OUR_FAULT", "Our fault"],
  ["OTHER", "Other"],
] as const;

async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/webp", 0.82));
}

async function uploadPhoto(file: File): Promise<string> {
  const compressed = await compressPhoto(file);
  const form = new FormData();
  form.append("file", new File([compressed], "delivery.webp", { type: "image/webp" }));
  const res = await fetch("/api/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error("upload failed");
  return (await res.json()).url as string;
}

function getGps(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60000 },
    );
  });
}

export function RunSheetCard({ stop }: { stop: StopData }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [failing, setFailing] = React.useState(false);
  const [failReason, setFailReason] = React.useState<string>("RECIPIENT_UNREACHABLE");
  const [failNote, setFailNote] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);
  const photoInput = React.useRef<HTMLInputElement>(null);
  const failPhotoInput = React.useRef<HTMLInputElement>(null);

  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(
    `${stop.addressLine1}, Prince George BC ${stop.postalCode}`,
  )}`;

  async function handleResult(result: string) {
    if (result === "ok") router.refresh();
    else if (result === "queued") setStatus("Saved offline — will sync when you're back on signal.");
    else setStatus(result);
    setBusy(false);
  }

  async function onDeliveredPhoto(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const [photoUrl, gps] = await Promise.all([uploadPhoto(file), getGps()]);
      const action = stop.isPickup ? { action: "pickup_done", photoUrl } : { action: "delivered", photoUrl, gpsLat: gps.lat, gpsLng: gps.lng };
      await handleResult(await postAction(stop.deliveryId, action));
    } catch {
      setStatus("Photo upload failed — try again (photo is required).");
      setBusy(false);
    }
  }

  async function onFail() {
    if (!failNote.trim()) return setStatus("A short note is required.");
    setBusy(true);
    setStatus(null);
    let photoUrl: string | undefined;
    const file = failPhotoInput.current?.files?.[0];
    if (file) {
      try {
        photoUrl = await uploadPhoto(file);
      } catch {
        /* failure photo is best-effort */
      }
    }
    await handleResult(
      await postAction(stop.deliveryId, { action: "failed", reason: failReason, note: failNote.trim(), photoUrl }),
    );
    setFailing(false);
  }

  async function onSkip() {
    setBusy(true);
    await handleResult(await postAction(stop.deliveryId, { action: "skip" }));
  }

  return (
    <div className="rounded-card bg-white p-5 shadow-lift">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-xl text-forest">
            {stop.routePosition !== null && <span className="mr-2 text-gold-deep">#{stop.routePosition}</span>}
            {stop.recipientName}
          </p>
          <p className="text-[15px] text-charcoal/80">{stop.businessName}</p>
          <p className="text-[15px] text-charcoal/60">
            {stop.addressLine1} · {stop.postalCode}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant="forest">{WINDOW_LABEL[stop.window] ?? stop.window}</Badge>
          {stop.isPickup && <Badge variant="rose">Pickup</Badge>}
          {stop.attemptCount > 0 && !stop.isPickup && <Badge variant="neutral">attempt {stop.attemptCount + 1}</Badge>}
        </div>
      </div>

      {stop.giftNote && (
        <p className="mt-3 rounded bg-cream px-3 py-2 font-display text-sm italic text-charcoal/80">
          &ldquo;{stop.giftNote}&rdquo;
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <a href={mapsUrl} target="_blank" rel="noreferrer" className="contents">
          <Button variant="outline" className="w-full">
            🧭 Navigate
          </Button>
        </a>
        <a href={`tel:${stop.buyerPhone}`} className="contents">
          <Button variant="outline" className="w-full">
            📞 Call buyer
          </Button>
        </a>
      </div>

      {!failing ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Button
            variant="cta"
            size="lg"
            disabled={busy}
            onClick={() => photoInput.current?.click()}
            className="col-span-2"
          >
            {busy ? "Working…" : stop.isPickup ? "Picked up 📸" : "Delivered 📸"}
          </Button>
          <div className="grid gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => setFailing(true)}>
              Failed
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip}>
              Skip
            </Button>
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onDeliveredPhoto(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="mt-3 space-y-2 rounded bg-rose-wash p-3">
          <select
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
            className="h-11 w-full rounded border border-forest/20 bg-white px-3 text-[15px]"
            aria-label="Failure reason"
          >
            {FAIL_REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <textarea
            value={failNote}
            onChange={(e) => setFailNote(e.target.value)}
            placeholder="Quick note (required) — what happened?"
            rows={2}
            className="w-full rounded border border-forest/20 bg-white px-3 py-2 text-[15px]"
          />
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => failPhotoInput.current?.click()}>
              📸 Photo
            </Button>
            <input ref={failPhotoInput} type="file" accept="image/*" capture="environment" className="hidden" />
            <Button variant="primary" size="sm" disabled={busy} onClick={onFail}>
              Confirm failed
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFailing(false)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {status && (
        <p role="status" className="mt-2 text-sm text-charcoal/70">
          {status}
        </p>
      )}
    </div>
  );
}
