// Logika wiersza zgloszenia: dozwolone decyzje, etykiety, stronicowanie.
//
// CZYSTE FUNKCJE, NIE METODY KOMPONENTU. Zestaw dozwolonych decyzji wynika z
// CHECK-ow i warunkow `admin_event_registration_decide` - jest to regula
// dziedziny, nie detal widoku. W komponencie nie da sie jej przetestowac bez
// renderu, a wlasnie ta regula decyduje, czy organizator zobaczy przycisk,
// ktory baza odrzuci komunikatem `invalid_transition`.
//
// POWOD JEST WYMAGANY TYLKO TAM, GDZIE BAZA GO WYMAGA (`reason_required`):
// odrzucenie i anulowanie. Wymuszanie go przy zatwierdzeniu wydluzalaby prace
// przy setkach zgloszen, a wymuszanie go „na wszelki wypadek" nauczyloby
// organizatora wpisywac kropke.
import type {
  EventRegistrationRow,
  RegistrationAction,
  RegistrationGroupLink,
  RegistrationStatus,
} from "@/lib/events/registrationsApi";

/** Przejscia dopuszczone przez RPC decyzji, stan -> lista czynnosci. */
const TRANSITIONS: Record<RegistrationStatus, readonly RegistrationAction[]> = {
  draft: ["approve", "reject", "waitlist", "cancel"],
  pending: ["approve", "reject", "waitlist", "cancel"],
  approved: ["attended", "no_show", "waitlist", "cancel"],
  waitlist: ["approve", "reject", "cancel"],
  rejected: ["approve", "waitlist"],
  cancelled: ["approve", "waitlist"],
  attended: ["no_show"],
  no_show: ["attended"],
};

/** Czynnosci wymagajace uzasadnienia - odwzorowanie bledu `reason_required`. */
const REASON_REQUIRED: readonly RegistrationAction[] = ["reject", "cancel"];

export function isRegistrationStatus(value: string): value is RegistrationStatus {
  return Object.prototype.hasOwnProperty.call(TRANSITIONS, value);
}

export function allowedRegistrationActions(status: string): readonly RegistrationAction[] {
  return isRegistrationStatus(status) ? TRANSITIONS[status] : [];
}

export function actionRequiresReason(action: RegistrationAction): boolean {
  return REASON_REQUIRED.includes(action);
}

/** Wariant plakietki statusu - jedno miejsce, zeby lista i szuflada zgadzaly sie. */
export type StatusTone = "neutral" | "warning" | "success" | "danger" | "info";

const TONES: Record<RegistrationStatus, StatusTone> = {
  draft: "neutral",
  pending: "warning",
  approved: "success",
  rejected: "danger",
  waitlist: "info",
  cancelled: "neutral",
  attended: "success",
  no_show: "danger",
};

export function registrationStatusTone(status: string): StatusTone {
  return isRegistrationStatus(status) ? TONES[status] : "neutral";
}

export function registrationPersonName(row: EventRegistrationRow): string {
  const name = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  return name === "" ? (row.email ?? "") : name;
}

/**
 * Nazwa biletu w jezyku interfejsu; `null` znaczy „zgloszenie bez biletu".
 * Puste tlumaczenie spada na drugi jezyk - brak nazwy w jednym jezyku nie
 * powinien zamieniac biletu w pusty wiersz.
 */
export function registrationTicketLabel(
  row: EventRegistrationRow,
  lang: "pl" | "en",
): string | null {
  if ((row.ticket_type_id ?? null) === null) return null;
  const pl = row.ticket_name_pl ?? "";
  const en = row.ticket_name_en ?? "";
  const primary = lang === "en" ? en || pl : pl || en;
  return primary === "" ? (row.ticket_key ?? null) : primary;
}

export function registrationGroupLabel(
  row: EventRegistrationRow,
  lang: "pl" | "en",
): string | null {
  if ((row.group_id ?? null) === null) return null;
  const pl = row.group_name_pl ?? "";
  const en = row.group_name_en ?? "";
  const primary = lang === "en" ? en || pl : pl || en;
  return primary === "" ? (row.group_key ?? null) : primary;
}

/** Awansowany z rezerwy, komu nie wyslano jeszcze wiadomosci. */
export function isAwaitingWaitlistNotice(row: EventRegistrationRow): boolean {
  return (row.promoted_at ?? null) !== null && (row.waitlist_notified_at ?? null) === null;
}

export function hasMissingRequiredTerms(row: EventRegistrationRow): boolean {
  return Number(row.required_terms_missing ?? 0) > 0;
}

export function areConsentsWithdrawn(row: EventRegistrationRow): boolean {
  return (row.consent_withdrawn_at ?? null) !== null;
}

// ---------------------------------------------------------------------------
// GRUPA I BILET Z KODEM QR
// ---------------------------------------------------------------------------

/** Statusy, w ktorych wiersz trzyma bilet - lustro `_event_issue_ticket_codes`. */
const TICKET_STATUSES: readonly string[] = ["approved", "attended"];
/** Rozliczenia, przy ktorych bilet sie nalezy - lustro tej samej funkcji. */
const TICKET_PAYMENTS: readonly string[] = ["paid", "not_required"];

/** Wiersz w stanie, w ktorym plakietka biletu (wyslany / niewyslany) cos znaczy. */
export function holdsTicket(status: string): boolean {
  return TICKET_STATUSES.includes(status);
}

/**
 * Czy organizator moze wyslac bilet ponownie. TEN SAM warunek, co odmowa
 * `ticket_not_issuable` w `admin_event_ticket_resend` - przycisk, ktory baza
 * odrzuci, jest gorszy niz brak przycisku. Bez wiersza powiazan (zapytanie
 * jeszcze nie wrocilo) rozliczenia nie znamy, wiec przycisku nie ma.
 */
export function canResendTicket(status: string, link: RegistrationGroupLink | null): boolean {
  return link !== null && holdsTicket(status) && TICKET_PAYMENTS.includes(link.payment_status);
}

/** Plakietka biletu wiersza; `null` = plakietki nie ma. */
export type TicketBadge = "sent" | "notSent" | "awaitingPayment" | "undeliverable";

/**
 * Ktora plakietka biletu stoi przy wierszu.
 *
 * „NIEWYSLANY" TYLKO TAM, GDZIE BILET SIE NALEZY - ten sam warunek, co przycisk
 * ponownej wysylki. Przyjety, ale nieoplacony wiersz (organizator zatwierdzil
 * bilet platny przed wplata) biletu jeszcze nie dostaje; „bilet niewyslany"
 * wygladalby przy nim jak awaria poczty, ktorej organizator nie ma jak
 * naprawic - wiec plakietka mowi, na co wiersz czeka. Zwrot nie ma plakietki:
 * biletu nie ma i nie bedzie.
 *
 * „NIE DOTARL" PRZED „WYSLANY". Adres z listy wykluczen zamyka wysylke jak
 * wyslana (`ticket_code_sent_at` stoi, zeby cron nie rotowal kodu co tick),
 * wiec bez tej kolejnosci organizator czytal „Bilet wyslany" przy bilecie,
 * ktory nigdy nie wyszedl - i nie wiedzial, ze trzeba go przekazac inaczej.
 */
export function ticketBadge(
  status: string,
  link: RegistrationGroupLink | null,
): TicketBadge | null {
  if (link === null || !holdsTicket(status)) return null;
  if (TICKET_PAYMENTS.includes(link.payment_status)) {
    if (link.ticket_code_undeliverable_at !== null) return "undeliverable";
    return link.ticket_code_sent_at === null ? "notSent" : "sent";
  }
  return link.payment_status === "unpaid" ? "awaitingPayment" : null;
}

/** Imie i nazwisko prowadzacego dla plakietki goscia; `null` = to nie gosc. */
export function groupLeadName(link: RegistrationGroupLink | null): string | null {
  if (link === null || link.group_lead_registration_id === null) return null;
  return `${link.lead_first_name ?? ""} ${link.lead_last_name ?? ""}`.trim();
}

// ---------------------------------------------------------------------------
// STRONICOWANIE
// ---------------------------------------------------------------------------

export function registrationPageCount(total: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(0, total) / limit));
}

export function registrationPageIndex(offset: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.floor(Math.max(0, offset) / limit) + 1;
}

/** Przesuniecie po zmianie strony, przyciete do zakresu istniejacych stron. */
export function registrationOffsetForPage(page: number, limit: number, total: number): number {
  if (limit <= 0) return 0;
  const last = registrationPageCount(total, limit);
  const clamped = Math.min(Math.max(1, Math.trunc(page)), last);
  return (clamped - 1) * limit;
}
