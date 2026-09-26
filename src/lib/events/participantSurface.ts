// Czyste reguły plakietki stanu zgłoszenia w panelu „Moje" (D0-5).
//
// OSOBNY MODUŁ, NIE EKSPORTY Z KOMPONENTU. Stała albo funkcja eksportowana
// z pliku komponentu psuje fast refresh (`react-refresh/only-export-components`),
// a mapa kluczy ma być widoczna dla bramki `eventsI18nKeys` (skanuje
// `src/lib/events`). Klucze są PEŁNYMI literałami - żadnego sklejania.
//
// ZERO IMPORTÓW - CELOWO. Moduł jedzie w PUBLICZNYM chunku panelu „Moje";
// import `participantSettings` (parser i wartości domyślne panelu organizatora)
// wciągnąłby do niego kod, którego uczestnik nigdy nie wykona.
//
// Bez klas CSS (R-CSS): warianty plakietki zostają w komponencie.

export type RegistrationStatusTone = "active" | "pending" | "waitlist" | "closed";

/** Status zgłoszenia -> ton. Statusy z CHECK `event_registrations.status`. */
export const REGISTRATION_STATUS_TONE: Readonly<Record<string, RegistrationStatusTone>> = {
  approved: "active",
  attended: "active",
  pending: "pending",
  draft: "pending",
  waitlist: "waitlist",
  cancelled: "closed",
  rejected: "closed",
  no_show: "closed",
};

export const REGISTRATION_STATUS_TONE_LABEL_KEYS: Record<
  RegistrationStatusTone,
  | "eventParticipant.status.active"
  | "eventParticipant.status.pending"
  | "eventParticipant.status.waitlist"
  | "eventParticipant.status.closed"
> = {
  active: "eventParticipant.status.active",
  pending: "eventParticipant.status.pending",
  waitlist: "eventParticipant.status.waitlist",
  closed: "eventParticipant.status.closed",
};

/**
 * Ton statusu albo `null` dla statusu spoza mapy - także dla nazw z prototypu
 * obiektu (`constructor`), dlatego `Object.hasOwn`, a nie odczyt wprost.
 */
export function registrationStatusTone(status: string): RegistrationStatusTone | null {
  return Object.hasOwn(REGISTRATION_STATUS_TONE, status) ? REGISTRATION_STATUS_TONE[status] : null;
}
