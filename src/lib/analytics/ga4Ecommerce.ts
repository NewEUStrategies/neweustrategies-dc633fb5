// E-commerce GA4 - jedno tłumaczenie naszych obiektów sprzedażowych na
// `items` GA4. Dzięki temu raporty „Monetyzacja" (view_item, add_to_cart,
// begin_checkout, purchase) liczą te same kwoty co nasze faktury.
//
// KWOTY. GA4 przyjmuje wartość w jednostce waluty, a my trzymamy grosze -
// dzielenie przez 100 jest TUTAJ i nigdzie więcej, żeby nie rozjechały się
// raporty przychodu.

import { ga4Event, type Ga4Item } from "./ga4Client";
import type { CartItem } from "@/lib/cart/cartStore";

export function centsToUnits(cents: number): number {
  return Math.round(cents) / 100;
}

export function cartItemToGa4Item(item: CartItem, lang: "pl" | "en" = "pl"): Ga4Item {
  const name = (lang === "en" ? item.titleEn : item.titlePl) || item.titlePl || item.slug;
  const variant = (lang === "en" ? item.ticketNameEn : item.ticketNamePl) || undefined;
  return {
    item_id: item.id,
    item_name: name,
    item_category: "event_ticket",
    item_variant: variant,
    price: centsToUnits(item.priceCents),
    quantity: 1,
    currency: item.currency,
  };
}

function sumUnits(items: Ga4Item[]): number {
  return (
    Math.round(items.reduce((acc, i) => acc + (i.price ?? 0) * (i.quantity ?? 1), 0) * 100) / 100
  );
}

function currencyOf(items: Ga4Item[], fallback = "PLN"): string {
  return items[0]?.currency ?? fallback;
}

export function ga4ViewItem(item: Ga4Item): void {
  ga4Event("view_item", { currency: item.currency, value: item.price ?? 0, items: [item] });
}

export function ga4AddToCart(item: Ga4Item): void {
  ga4Event("add_to_cart", { currency: item.currency, value: item.price ?? 0, items: [item] });
}

export function ga4RemoveFromCart(item: Ga4Item): void {
  ga4Event("remove_from_cart", { currency: item.currency, value: item.price ?? 0, items: [item] });
}

export function ga4BeginCheckout(items: Ga4Item[]): void {
  if (items.length === 0) return;
  ga4Event("begin_checkout", {
    currency: currencyOf(items),
    value: sumUnits(items),
    items,
  });
}

/**
 * Zakup po stronie przeglądarki. Ścieżka pewna (odporna na blokery) idzie z
 * serwera przez Measurement Protocol - tutaj wysyłamy tylko wtedy, gdy serwer
 * nie zna identyfikatora klienta GA4, a `transaction_id` gwarantuje, że GA4
 * zdeduplikuje ewentualne dwa trafienia tego samego zamówienia.
 */
export function ga4Purchase(input: {
  transactionId: string;
  valueCents: number;
  currency: string;
  items?: Ga4Item[];
}): void {
  ga4Event("purchase", {
    transaction_id: input.transactionId,
    value: centsToUnits(input.valueCents),
    currency: input.currency,
    items: input.items ?? [],
  });
}
