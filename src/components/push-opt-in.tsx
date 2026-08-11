"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

type PushState = "unsupported" | "unconfigured" | "default" | "granted" | "denied" | "subscribed";

export function PushOptIn() {
  const [state, setState] = React.useState<PushState>("default");
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  React.useEffect(() => {
    if (!key) return setState("unconfigured");
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "subscribed" : Notification.permission === "granted" ? "granted" : "default");
    });
  }, [key]);

  async function enable() {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return setState("denied");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key!),
    });
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()),
    });
    if (res.ok) setState("subscribed");
  }

  async function disable() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState("default");
  }

  switch (state) {
    case "unconfigured":
      return <p className="text-sm text-charcoal/50">Push notifications aren&apos;t configured in this environment yet.</p>;
    case "unsupported":
      return <p className="text-sm text-charcoal/50">This browser doesn&apos;t support push notifications.</p>;
    case "denied":
      return <p className="text-sm text-charcoal/60">Notifications are blocked in your browser settings — flip them back on there and revisit.</p>;
    case "subscribed":
      return (
        <div className="flex items-center gap-3">
          <p className="text-sm text-forest">Push is on for this device. 🌸</p>
          <Button size="sm" variant="ghost" onClick={disable}>
            Turn off
          </Button>
        </div>
      );
    default:
      return (
        <Button size="sm" variant="cta" onClick={enable}>
          Enable push on this device
        </Button>
      );
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
