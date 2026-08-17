// Podgląd metody płatności zapisanej u operatora.
//
// Świadomie zwracamy TYLKO dane nieszkodliwe wizualnie (marka, cztery ostatnie
// cyfry, data ważności, typ portfela). Pełnego obiektu metody płatności nie
// przepuszczamy przez granicę RPC - użytkownik nie potrzebuje go do
// rozpoznania karty, a każdy dodatkowy atrybut to niepotrzebna powierzchnia.
import type Stripe from "stripe";

import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";

export interface PaymentMethodPreview {
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  wallet: string | null;
  type: string;
}

function toPreview(method: Stripe.PaymentMethod): PaymentMethodPreview {
  const card = method.card ?? null;
  return {
    brand: card?.brand ?? null,
    last4: card?.last4 ?? null,
    expMonth: card?.exp_month ?? null,
    expYear: card?.exp_year ?? null,
    wallet: card?.wallet?.type ?? null,
    type: method.type,
  };
}

/**
 * Domyślna metoda płatności klienta. Kolejność: metoda ustawiona jako domyślna
 * dla faktur, potem domyślna dla subskrypcji, na końcu pierwsza zapisana karta.
 * Brak metody to normalny stan (np. dostęp z nadania) - zwracamy `null`.
 */
export async function fetchPaymentMethodPreview(input: {
  customerId: string;
  subscriptionId: string | null;
  environment: StripeEnv;
}): Promise<PaymentMethodPreview | null> {
  const stripe = createStripeClient(input.environment);

  const customer = await stripe.customers.retrieve(input.customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  if (!("deleted" in customer) || customer.deleted !== true) {
    const fromCustomer = (customer as Stripe.Customer).invoice_settings?.default_payment_method as
      Stripe.PaymentMethod | string | null;
    if (fromCustomer && typeof fromCustomer !== "string") return toPreview(fromCustomer);
  }

  if (input.subscriptionId) {
    const subscription = await stripe.subscriptions.retrieve(input.subscriptionId, {
      expand: ["default_payment_method"],
    });
    const fromSubscription = subscription.default_payment_method as
      Stripe.PaymentMethod | string | null;
    if (fromSubscription && typeof fromSubscription !== "string")
      return toPreview(fromSubscription);
  }

  const list = await stripe.paymentMethods.list({ customer: input.customerId, limit: 1 });
  const first = list.data[0];
  return first ? toPreview(first) : null;
}
