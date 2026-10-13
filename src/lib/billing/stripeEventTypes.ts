// Typy zdarzeń Stripe, które integracja obsługuje - JEDNO źródło prawdy.
//
// Czytają je: uzgadnianie (`reconcile.server` - które zdarzenia z historii
// operatora porównywać z dziennikiem) i diagnostyka (`diagnostics.server` -
// czy punkt odbioru webhooków ma je włączone). Normalizator
// (`stripeEvents.server`) mapuje każdy z nich; test pilnuje, żeby lista
// i normalizator się nie rozjechały.
//
// Moduł czysty (bez zależności serwerowych).
export const STRIPE_WEBHOOK_EVENT_TYPES = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.resumed",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  // Porzucona kasa: zwolnienie rezerwacji kuponu i zamknięcie zamówienia.
  "checkout.session.expired",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  // Rozstrzygnięcie sporu: wygrany przywraca dostęp, przegrany go zamyka.
  "charge.dispute.closed",
  // Zwrot, który przepadł (np. wygasła karta): pieniądze wracają na saldo,
  // więc zwrot przestaje być pełny - przeliczenie i alert dla zespołu.
  "refund.failed",
  "credit_note.created",
  "customer.updated",
] as const;

export type StripeWebhookEventType = (typeof STRIPE_WEBHOOK_EVENT_TYPES)[number];
