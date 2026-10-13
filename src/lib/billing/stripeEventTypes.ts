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
  // Zwrot, który nie doszedł (INV-19c, przegląd 2.11): pieniądze wracają na
  // saldo, więc zamówienie wraca do stanu z obciążenia, a zlecenie zwrotu
  // zgłoszenia idzie do przeglądu. `refund.updated` - celowo nie: większość
  // jego dostaw to sukces, który niesie `charge.refunded`.
  "refund.failed",
  "charge.dispute.created",
  // Rozstrzygnięcie sporu: wygrany przywraca dostęp, przegrany go zamyka.
  "charge.dispute.closed",
  "credit_note.created",
  "customer.updated",
] as const;

export type StripeWebhookEventType = (typeof STRIPE_WEBHOOK_EVENT_TYPES)[number];
