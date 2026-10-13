// Odmowa usunięcia wydarzenia -> klucz i18n panelu.
//
// USUWANIE IDZIE PROSTO PRZEZ PostgREST (`deleteEvent`), więc odmowa bazy
// przychodzi jako surowy komunikat triggera. Jedyną odmową z własnym zdaniem
// jest `event_has_payments` (20261012181000, przegląd R45): wydarzenie
// z opłaconym zgłoszeniem albo historią zwrotów nie znika, bo kaskada
// zabrałaby zgłoszenia razem ze śladem pieniędzy - organizator ma je odwołać
// (odwołanie zamyka opłacone zgłoszenia ze zwrotem).
//
// Każda inna odmowa zostaje surowym komunikatem, jak dotąd - mapa nie zgaduje.

const EVENT_HAS_PAYMENTS = "event_has_payments";

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

/** Klucz zdania dla znanej odmowy usunięcia albo `null` (pokaż komunikat bazy). */
export function eventDeleteFailureKey(error: unknown): string | null {
  const message = messageOf(error);
  const separator = message.indexOf(":");
  const head = (separator === -1 ? message : message.slice(0, separator)).trim();
  return head === EVENT_HAS_PAYMENTS ? "adminCommunityEvents.toasts.deleteHasPayments" : null;
}
