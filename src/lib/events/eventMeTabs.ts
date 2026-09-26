// Zakładki panelu „moje wydarzenie" (`/events/$slug/me?tab=`).
//
// ZERO IMPORTÓW - CELOWO. Ten moduł czyta `validateSearch` trasy, a to
// wykonuje się w paczce startowej (R-ROUTE). Każdy import stąd wciągnąłby
// swój graf do chunka wejściowego, na którym budżet ma kilka kilobajtów
// zapasu. Lista, typ i parser to wszystko, czego trasa potrzebuje.

export const EVENT_ME_TABS = [
  "profile",
  "schedule",
  "contacts",
  "networking",
  "registration",
  "follow-up",
] as const;

export type EventMeTab = (typeof EVENT_ME_TABS)[number];

/** Wartość z paska adresu -> znana zakładka albo `undefined` (brak = domyślna). */
export function parseEventMeTab(value: unknown): EventMeTab | undefined {
  return typeof value === "string" && (EVENT_ME_TABS as readonly string[]).includes(value)
    ? (value as EventMeTab)
    : undefined;
}
