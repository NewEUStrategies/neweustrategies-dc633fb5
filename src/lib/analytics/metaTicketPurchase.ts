// Purchase biletu na wydarzenie dla piksela Meta.
//
// Po płatności operator odsyła kupującego na stronę wydarzenia (albo panel
// zgłoszenia), która sama nie odróżnia powrotu z kasy od zwykłej wizyty.
// Dlatego kasa biletu zapisuje znacznik z NUMEREM ZAMÓWIENIA
// (`rememberMetaCheckout("ticket")`), a ten moduł - uruchamiany przez
// `ConsentScriptInjector` po starcie piksela na KAŻDEJ stronie - pyta bazę
// o status własnego zamówienia (RLS właściciela). Purchase wychodzi tylko
// przy `paid`, z kwotą i walutą z zamówienia (po kuponie), raz na zamówienie:
// `eventID = purchase_<order>` i lista zgłoszonych zamówień w localStorage.
// `failed`/`canceled`/`refunded` kasują znacznik; `pending` czeka (webhook
// operatora potrafi przyjść kilka sekund po powrocie).
import { clearMetaCheckout, peekMetaCheckout } from "./metaCheckoutMarker";
import { trackMetaEvent } from "./metaPixelEvents";
import { trackAdsPurchase } from "./adsPurchase";

export interface MetaTicketOrderRow {
  status: string;
  amount_cents: number;
  currency: string;
  quantity?: number | null;
}

export type FetchTicketOrder = (orderId: string) => Promise<MetaTicketOrderRow | null>;

export const META_TICKET_POLL_INTERVAL_MS = 3_000;
/** Świeży powrót (do 2 min od kasy) sprawdzamy do 10 razy; później raz na stronę. */
export const META_TICKET_FRESH_WINDOW_MS = 120_000;
const FRESH_ATTEMPTS = 10;
const REPORTED_KEY = "meta:reported-orders";
const MAX_REPORTED = 50;
const FINAL_FAILURES = new Set(["failed", "canceled", "refunded"]);

function readReported(): string[] {
  try {
    const raw = window.localStorage.getItem(REPORTED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function markReported(orderId: string): void {
  try {
    const next = [orderId, ...readReported().filter((id) => id !== orderId)].slice(0, MAX_REPORTED);
    window.localStorage.setItem(REPORTED_KEY, JSON.stringify(next));
  } catch {
    /* best-effort */
  }
}

export function wasMetaOrderReported(orderId: string): boolean {
  return typeof window !== "undefined" && readReported().includes(orderId);
}

/** Domyślne źródło: własne zamówienie z bazy (RLS: tylko właściciel). */
const defaultFetch: FetchTicketOrder = async (orderId) => {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase
    .from("payment_orders")
    .select("status, amount_cents, currency, metadata")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return null;
  const metadata = (data.metadata ?? {}) as Record<string, unknown>;
  const quantity = metadata["quantity"];
  return {
    status: data.status,
    amount_cents: data.amount_cents,
    currency: data.currency,
    quantity: typeof quantity === "number" ? quantity : null,
  };
};

/**
 * Sprawdza zamówienie biletu ze znacznika i wysyła Purchase po potwierdzeniu.
 * Zwraca funkcję przerywającą odpytywanie (cleanup efektu).
 */
export function watchMetaTicketPurchase(
  fetchOrder: FetchTicketOrder = defaultFetch,
  now: () => number = Date.now,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const marker = peekMetaCheckout("ticket", now());
  if (!marker?.orderId) return () => undefined;
  const orderId = marker.orderId;
  if (wasMetaOrderReported(orderId)) {
    clearMetaCheckout("ticket");
    return () => undefined;
  }
  const fresh = now() - marker.createdAt <= META_TICKET_FRESH_WINDOW_MS;
  let attemptsLeft = fresh ? FRESH_ATTEMPTS : 1;

  const check = async (): Promise<void> => {
    if (stopped) return;
    attemptsLeft -= 1;
    let order: MetaTicketOrderRow | null = null;
    try {
      order = await fetchOrder(orderId);
    } catch {
      order = null;
    }
    if (stopped) return;
    if (order?.status === "paid") {
      const quantity =
        typeof order.quantity === "number" && Number.isInteger(order.quantity) && order.quantity > 0
          ? order.quantity
          : 1;
      // Wysłane albo zakolejkowane - tak czy inaczej zamówienie jest zgłoszone.
      trackMetaEvent(
        "Purchase",
        {
          value: order.amount_cents / 100,
          currency: order.currency,
          content_ids: [marker.contentId],
          contents: [{ id: marker.contentId, quantity }],
          content_type: "product",
          content_category: marker.category,
          num_items: quantity,
        },
        `purchase_${orderId}`,
      );
      trackAdsPurchase({
        transactionId: `purchase_${orderId}`,
        value: order.amount_cents / 100,
        currency: order.currency,
      });
      markReported(orderId);
      clearMetaCheckout("ticket");
      return;
    }
    if (order && FINAL_FAILURES.has(order.status)) {
      clearMetaCheckout("ticket");
      return;
    }
    if (attemptsLeft > 0) {
      timer = setTimeout(() => void check(), META_TICKET_POLL_INTERVAL_MS);
    }
  };

  void check();
  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
  };
}
