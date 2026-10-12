// Kształt żądania kasy (`createCheckoutOrder`) - JEDNA ścieżka wyceny na
// jedno zamówienie.
//
// PO CO (audyt TIX-01). Kasa rozpoznawała bilet po `event_id`, ale metadane
// biletu (`event_id`, `quantity`, `registration_id`) doklejała do zamówienia
// NIEZALEŻNIE od gałęzi wyceny. Ładunek „artykuł za 5 zł + event_id +
// registration_id" (albo `plan_id` dowolnego planu, albo samo `event_id` bez
// biletu) dawał zamówienie wycenione jako treść, a webhook rozliczał nim
// wskazane zgłoszenie VIP - cudze też. Ten moduł odrzuca każdą mieszankę,
// ZANIM handler cokolwiek przeczyta z bazy:
//
//   * bilet (`event_id`) wyklucza plan i treść, a zgłoszenie (`registration_id`)
//     wymaga wskazania biletu z cennika (`ticket_type_id`) - tylko ta gałąź
//     sprawdza własność zgłoszenia (`event_registration_payment_context`);
//   * subskrypcja nie niesie biletu ani treści;
//   * treść wyklucza plan;
//   * bilet nie przyjmuje waluty prezentacji (TIX-12): cena regularna i cena
//     po fazie sprzedaży szłyby w różnych walutach, a nakładka pokazywałaby
//     fikcyjną cenę przekreśloną.
//
// Baza pilnuje tego samego przy zapisie zamówienia (`payment_orders_secure_insert`,
// 20261012090300) i przy rozliczeniu (`payments_apply_event_ticket_outcome`,
// 20261012090100) - ten plik daje kupującemu powód odmowy, zanim powstanie
// zamówienie.

/** Pola ładunku, które decydują o ścieżce wyceny. */
export interface CheckoutPayloadShape {
  kind: "subscription" | "one_time";
  plan_id?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  event_id?: string | null;
  ticket_type_id?: string | null;
  registration_id?: string | null;
  display_currency?: string | null;
}

/** Kody odmowy - te same napisy wraca walidator (komunikat błędu Zod). */
export type CheckoutPayloadIssue =
  | "ticket_payload_conflict"
  | "ticket_requires_event"
  | "registration_requires_ticket"
  | "subscription_payload_conflict"
  | "entity_payload_conflict"
  | "display_currency_unsupported";

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

/** Ścieżka wyceny jednoznacznie wynikająca z ładunku. */
export type CheckoutPurchase = "subscription" | "plan" | "ticket" | "content";

/**
 * Pierwszy powód, dla którego ładunek miesza ścieżki wyceny, albo `null`.
 * Brakujące wskazania (np. subskrypcja bez planu) zostają dla handlera - mają
 * tam własne kody (`plan_id_required`, `entity_required`).
 */
export function checkoutPayloadIssue(data: CheckoutPayloadShape): CheckoutPayloadIssue | null {
  const event = present(data.event_id);
  const ticket = present(data.ticket_type_id);
  const registration = present(data.registration_id);
  const plan = present(data.plan_id);
  const entity = present(data.entity_id) || present(data.entity_type);

  if (data.kind === "subscription" && (event || ticket || registration || entity)) {
    return "subscription_payload_conflict";
  }
  if (event && (plan || entity)) return "ticket_payload_conflict";
  if (ticket && !event) return "ticket_requires_event";
  if (registration && !ticket) return "registration_requires_ticket";
  if (present(data.entity_id) && plan) return "entity_payload_conflict";
  if (event && present(data.display_currency)) return "display_currency_unsupported";
  return null;
}

/** Ścieżka wyceny poprawnego ładunku (po `checkoutPayloadIssue === null`). */
export function checkoutPurchase(data: CheckoutPayloadShape): CheckoutPurchase {
  if (data.kind === "subscription") return "subscription";
  if (present(data.event_id)) return "ticket";
  if (present(data.plan_id) && !present(data.entity_id)) return "plan";
  return "content";
}
