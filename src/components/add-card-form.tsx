"use client";

import * as React from "react";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

/** Evergreen Romance skin for Stripe's PaymentElement. */
const appearance = {
  variables: {
    colorPrimary: "#1E3A2F",
    colorText: "#2B2B2B",
    colorBackground: "#FFFFFF",
    colorDanger: "#C08D99",
    borderRadius: "16px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
} as const;

export function AddCardForm() {
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const stripePromise = React.useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [],
  );

  React.useEffect(() => {
    fetch("/api/stripe/setup-intent", { method: "POST" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "Something went sideways");
        return r.json();
      })
      .then((d) => setClientSecret(d.clientSecret))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (!publishableKey) {
    return <p className="text-sm text-charcoal/60">Payments aren&apos;t configured in this environment.</p>;
  }
  if (error) {
    return <p className="text-sm text-charcoal/70">We couldn&apos;t start the card form: {error}</p>;
  }
  if (!clientSecret || !stripePromise) {
    return <p className="animate-gentle-pulse text-sm text-charcoal/50">Warming up the card form…</p>;
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
      <InnerForm />
    </Elements>
  );
}

function InnerForm() {
  const stripeJs = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripeJs || !elements) return;
    setSubmitting(true);
    setMessage(null);

    const { error } = await stripeJs.confirmSetup({
      elements,
      confirmParams: { return_url: `${window.location.origin}/account/payment/complete` },
    });
    // Only reached on immediate failure — success redirects to return_url.
    if (error) setMessage(error.message ?? "That didn't go through. Mind trying again?");
    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <PaymentElement />
      {message && (
        <p role="alert" className="text-sm text-charcoal/80">
          {message}
        </p>
      )}
      <Button type="submit" variant="cta" className="w-full" disabled={submitting || !stripeJs}>
        {submitting ? "Saving…" : "Save card"}
      </Button>
    </form>
  );
}
