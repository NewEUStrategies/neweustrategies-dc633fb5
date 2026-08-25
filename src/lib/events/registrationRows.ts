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
