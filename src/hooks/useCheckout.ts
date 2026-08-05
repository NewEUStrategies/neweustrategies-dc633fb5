// Hook do sesji Stripe Embedded Checkout - katalogowym planem albo kwotą
// ad-hoc (odblokowanie treści, bilet, darowizna). Zamiast nakładki Paddle.js
// zwraca `clientSecret`, który komponent osadza przez `EmbeddedCheckoutProvider`.
import { useCallback, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  createAdhocCheckoutSession,
  createPlanCheckoutSession,
} from "@/lib/billing/stripeCheckout.functions";
import { getStripeEnvironment } from "@/lib/stripe";

export interface CheckoutSession {
  clientSecret: string;
  orderId: string;
}

export type CheckoutResult =
  | { ok: true; session: CheckoutSession }
  | { ok: false; error: string };

export interface PlanCheckoutOptions {
  /** Identyfikator planu w bazie (access_plans.id). */
  planId: string;
  /** Czytelny identyfikator ceny z katalogu (np. `pro_monthly`). */
  priceId: string;
  quantity?: number;
  couponCode?: string;
  returnUrl: string;
}

export interface AdhocCheckoutOptions {
  purpose: "content_unlock" | "event_ticket" | "donation";
  entityType?: "post" | "page";
  entityId?: string;
  eventId?: string;
  amountCents?: number;
  currency?: "PLN" | "EUR";
  returnUrl: string;
}

/** Otwiera sesję Embedded Checkout - katalogowym planem albo kwotą ad-hoc. */
export function useCheckout() {
  const [loading, setLoading] = useState(false);
  const planCheckout = useServerFn(createPlanCheckoutSession);
  const adhocCheckout = useServerFn(createAdhocCheckoutSession);

  const openPlanCheckout = useCallback(
    async (options: PlanCheckoutOptions): Promise<CheckoutResult> => {
      setLoading(true);
      try {
        const environment = getStripeEnvironment();
        const res = await planCheckout({ data: { ...options, environment } });
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, session: { clientSecret: res.clientSecret, orderId: res.orderId } };
      } finally {
        setLoading(false);
      }
    },
    [planCheckout],
  );

  const openAdhocCheckout = useCallback(
    async (options: AdhocCheckoutOptions): Promise<CheckoutResult> => {
      setLoading(true);
      try {
        const environment = getStripeEnvironment();
        const res = await adhocCheckout({ data: { ...options, environment } });
        if (!res.ok) return { ok: false, error: res.error };
        return { ok: true, session: { clientSecret: res.clientSecret, orderId: res.orderId } };
      } finally {
        setLoading(false);
      }
    },
    [adhocCheckout],
  );

  return { openPlanCheckout, openAdhocCheckout, loading };
}
