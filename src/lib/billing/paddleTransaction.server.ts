// Transakcje jednorazowe o dowolnej kwocie (odblokowanie treści, bilety na
// wydarzenia). Darowizny NIE przechodzą przez dostawcę - zbiera je zewnętrzny
// serwis zbiórkowy (patrz donationsExternal.ts, wymóg AUP Paddle).
//
// Katalog dostawcy trzyma tylko ceny stałe, a tutaj kwota jest wyliczana
// serwerowo dla konkretnego zamówienia (kupon, waluta prezentacji, cena
// wydarzenia). Dlatego zamiast `priceId` tworzymy transakcję z ceną osadzoną
// w pozycji i otwieramy nakładkę przez `transactionId` - klient nigdy nie
// podaje kwoty.
//
// Moduł jest server-only (klucze bramki) - importuj wyłącznie z handlerów.
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

/** Produkty jednorazowe utworzone w katalogu dostawcy. */
export const ONE_TIME_PRODUCTS = {
  contentUnlock: "content_unlock",
  eventTicket: "event_ticket",
} as const;

export type OneTimeProductKey = keyof typeof ONE_TIME_PRODUCTS;

/** Rodzaj transakcji przenoszony w `custom_data` i odczytywany przez webhook. */
export type OneTimeKind = "order" | "event_ticket";

export interface AdhocTransactionInput {
  environment: PaddleEnv;
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
async function resolveProductId(env: PaddleEnv, externalId: string): Promise<string | null> {
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

/**
 * Środowisko bramki dla żądania - AUTORYTATYWNE po stronie serwera.
 *
 * W produkcji zwracamy ZAWSZE 'live', ignorując wartość od klienta: gdyby
 * klient mógł wymusić 'sandbox', powstałoby zamówienie ostemplowane 'sandbox',
 * które sandboxowy webhook (opłacony kartą testową) mógłby zrealizować i
 * odblokować realną treść (P0 z audytu monetyzacji). Poza produkcją honorujemy
 * żądanie klienta, żeby dev/staging mógł testować lejek w sandboxie.
 */
export function resolveEnvironment(requested?: PaddleEnv | null): PaddleEnv {
  if (process.env.NODE_ENV === "production") return "live";
  if (requested === "sandbox" || requested === "live") return requested;
  return "sandbox";
}
