// Transakcje - odpowiednik dawnego `paddleTransaction.server.ts`.
//
// UWAGA (stan migracji Paddle -> Stripe, część 2/4): sekcja "retrieve" poniżej
// jest już czysto Stripe'owa (PaymentIntent / Checkout Session) i jej używa
// `invoice.server.ts`. Sekcja "create" (tworzenie transakcji ad-hoc/subskrypcyjnej
// przez katalog Paddle) pozostaje NIEZMIENIONA, bo wciąż korzysta z niej
// `checkout.functions.ts` - ten moduł zostanie zamieniony na
// `createPlanCheckoutSession` / `createAdhocCheckoutSession`
// (`adhocCheckout.server.ts`) w kolejnej części migracji (checkout flow),
// poza zakresem tej zmiany.
import type Stripe from "stripe";
import { createStripeClient, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";
import { gatewayFetch } from "@/lib/paddle.server";

export { resolveEnvironment };
export type { StripeEnv };

// ---------------------------------------------------------------------------
// Odczyt transakcji (Stripe) - PaymentIntent / Checkout Session / Invoice.
// ---------------------------------------------------------------------------

/** Właściciel transakcji, wyprowadzony z obiektu Stripe. */
export interface TransactionOwners {
  customerId: string | null;
  subscriptionId: string | null;
  /** `metadata.userId` ustawiane przy tworzeniu sesji/subskrypcji. */
  userId: string | null;
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Odczytuje właściciela transakcji po jej referencji u Stripe. Referencją
 * może być identyfikator faktury (`in_...`), sesji Checkout (`cs_...`) albo
 * PaymentIntentu (`pi_...`) - dokładnie te trzy kształty zapisujemy jako
 * `provider_intent_id` / numer transakcji udostępniany klientowi.
 */
export async function retrieveTransactionOwners(
  env: StripeEnv,
  transactionId: string,
): Promise<TransactionOwners | null> {
  const stripe = createStripeClient(env);
  try {
    if (transactionId.startsWith("in_")) {
      const invoice = await stripe.invoices.retrieve(transactionId);
      return {
        customerId: idOf(invoice.customer),
        subscriptionId: idOf((invoice as unknown as { subscription?: Stripe.Subscription | string | null }).subscription),
        userId: typeof invoice.metadata?.userId === "string" ? invoice.metadata.userId : null,
      };
    }
    if (transactionId.startsWith("cs_")) {
      const session = await stripe.checkout.sessions.retrieve(transactionId);
      return {
        customerId: idOf(session.customer),
        subscriptionId: idOf(session.subscription),
        userId: typeof session.metadata?.userId === "string" ? session.metadata.userId : null,
      };
    }
    if (transactionId.startsWith("pi_")) {
      const paymentIntent = await stripe.paymentIntents.retrieve(transactionId);
      return {
        customerId: idOf(paymentIntent.customer),
        subscriptionId: null,
        userId: typeof paymentIntent.metadata?.userId === "string" ? paymentIntent.metadata.userId : null,
      };
    }
    return null;
  } catch (e) {
    console.error("[payments] transaction lookup failed", transactionId, e);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tworzenie transakcji (Paddle) - dawny kod, wciąż używany przez
// `checkout.functions.ts`. Bez zmian względem `paddleTransaction.server.ts`.
// ---------------------------------------------------------------------------

/** Produkty jednorazowe utworzone w katalogu dostawcy. */
export const ONE_TIME_PRODUCTS = {
  contentUnlock: "content_unlock",
  eventTicket: "event_ticket",
} as const;

export type OneTimeProductKey = keyof typeof ONE_TIME_PRODUCTS;

/** Rodzaj transakcji przenoszony w `custom_data` i odczytywany przez webhook. */
export type OneTimeKind = "order" | "event_ticket";

export interface AdhocTransactionInput {
  environment: StripeEnv;
  product: OneTimeProductKey;
  /** Nazwa pozycji widoczna dla kupującego. */
  name: string;
  description?: string;
  amountCents: number;
  currency: string;
  quantity?: number;
  customerEmail?: string | null;
  /** Trafia 1:1 do `custom_data` transakcji - webhook to jedyny konsument. */
  customData: Record<string, string>;
}

export type AdhocTransactionResult =
  | { ok: true; transactionId: string }
  | { ok: false; error: string };

const productIdCache = new Map<string, string>();

/** Wewnętrzny identyfikator produktu dostawcy dla czytelnego `external_id`. */
async function resolveProductId(env: StripeEnv, externalId: string): Promise<string | null> {
  const cacheKey = `${env}:${externalId}`;
  const cached = productIdCache.get(cacheKey);
  if (cached) return cached;

  const res = await gatewayFetch(
    env,
    `/products?external_id=${encodeURIComponent(externalId)}&status=active`,
  );
  if (!res.ok) {
    console.error("[payments] product lookup failed", externalId, res.status);
    return null;
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const id = json.data?.[0]?.id;
  if (!id) return null;
  productIdCache.set(cacheKey, id);
  return id;
}

/**
 * Tworzy transakcję z ceną ad-hoc i zwraca jej identyfikator do nakładki.
 *
 * Nigdy nie rzuca - wywołujący dostaje `{ ok: false }` i decyduje, czy
 * unieważnić zamówienie.
 */
export async function createAdhocTransaction(
  input: AdhocTransactionInput,
): Promise<AdhocTransactionResult> {
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "invalid_amount" };
  }

  const externalId = ONE_TIME_PRODUCTS[input.product];
  const productId = await resolveProductId(input.environment, externalId);
  if (!productId) return { ok: false, error: "product_missing" };

  const quantity = Math.min(Math.max(Math.trunc(input.quantity ?? 1), 1), 100);
  const body = {
    items: [
      {
        quantity,
        price: {
          name: input.name.slice(0, 200),
          ...(input.description ? { description: input.description.slice(0, 200) } : {}),
          product_id: productId,
          unit_price: {
            amount: String(Math.round(input.amountCents)),
            currency_code: input.currency.toUpperCase(),
          },
          quantity: { minimum: 1, maximum: Math.max(quantity, 1) },
        },
      },
    ],
    custom_data: input.customData,
    ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
    collection_mode: "automatic",
  };

  try {
    const res = await gatewayFetch(input.environment, "/transactions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[payments] transaction create failed", res.status, text.slice(0, 300));
      return { ok: false, error: "transaction_failed" };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const transactionId = json.data?.id;
    if (!transactionId) return { ok: false, error: "transaction_failed" };
    return { ok: true, transactionId };
  } catch (e) {
    console.error("[payments] transaction create threw", e);
    return { ok: false, error: "transaction_failed" };
  }
}

const priceIdCache = new Map<string, string>();

/** Czytelny identyfikator ceny z katalogu -> wewnętrzny identyfikator dostawcy. */
async function resolvePriceId(env: StripeEnv, externalId: string): Promise<string | null> {
  const cacheKey = `${env}:${externalId}`;
  const cached = priceIdCache.get(cacheKey);
  if (cached) return cached;

  const res = await gatewayFetch(
    env,
    `/prices?external_id=${encodeURIComponent(externalId)}&status=active`,
  );
  if (!res.ok) {
    console.error("[payments] price lookup failed", externalId, res.status);
    return null;
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const id = json.data?.[0]?.id;
  if (!id) return null;
  priceIdCache.set(cacheKey, id);
  return id;
}

export interface SubscriptionTransactionInput {
  environment: StripeEnv;
  /** Czytelny identyfikator ceny z `BILLING_CATALOG` (np. `pro_monthly`). */
  priceExternalId: string;
  quantity?: number;
  customerEmail?: string | null;
  /** Rabat operatora wyprowadzony z kuponu B2B (nigdy z danych klienta). */
  discountId?: string | null;
  customData: Record<string, unknown>;
}

/**
 * Tworzy transakcję z CENY KATALOGOWEJ - to jedyny sposób, w jaki u operatora
 * powstaje subskrypcja (cykl rozliczeniowy, okres próbny, odnowienia i
 * zdarzenia `subscription.*`). Cena ad-hoc dałaby jednorazowe obciążenie.
 *
 * Nigdy nie rzuca - wywołujący dostaje `{ ok: false }`.
 */
export async function createSubscriptionTransaction(
  input: SubscriptionTransactionInput,
): Promise<AdhocTransactionResult> {
  const priceId = await resolvePriceId(input.environment, input.priceExternalId);
  if (!priceId) return { ok: false, error: "price_missing" };

  const quantity = Math.min(Math.max(Math.trunc(input.quantity ?? 1), 1), 100);
  const body = {
    items: [{ price_id: priceId, quantity }],
    custom_data: input.customData,
    ...(input.customerEmail ? { customer: { email: input.customerEmail } } : {}),
    ...(input.discountId ? { discount_id: input.discountId } : {}),
    collection_mode: "automatic",
  };

  try {
    const res = await gatewayFetch(input.environment, "/transactions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[payments] subscription transaction failed", res.status, text.slice(0, 300));
      return { ok: false, error: "transaction_failed" };
    }
    const json = (await res.json()) as { data?: { id?: string } };
    const transactionId = json.data?.id;
    if (!transactionId) return { ok: false, error: "transaction_failed" };
    return { ok: true, transactionId };
  } catch (e) {
    console.error("[payments] subscription transaction threw", e);
    return { ok: false, error: "transaction_failed" };
  }
}
