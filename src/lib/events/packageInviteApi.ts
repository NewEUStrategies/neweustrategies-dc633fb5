// Przyjecie zaproszenia na miejsce z pakietu: `event_package_invite_preview`
// i `event_package_invite_accept` (REG-15, migracja 20261012120200).
//
// TOKEN JEST POSWIADCZENIEM, NIE IDENTYFIKATOREM. Baza trzyma wylacznie jego
// SHA-256 i przyjmuje go od kazdego, kto go zna - traktujemy go jak haslo:
// nie wklada sie go do cache zapytan, nie loguje i nie doklejamy do adresow
// innych niz strona przyjecia zaproszenia.
//
// KSZTALT SPRAWDZAMY U SIEBIE. Baza wystawia DWA ksztalty tokenu: zaproszenie
// organizatora idzie przez `_event_new_qr_token()` (24 bajty w base64url, 32
// znaki), a zaproszenie kupujacego przez `event_package_seat_invite()` (dwa
// UUID bez myslnikow, 64 znaki szesnastkowe). Oba mieszcza sie w alfabecie
// `[A-Za-z0-9_-]`, wiec sprawdzamy alfabet i zakres dlugosci - adres z
// literowka odpada od razu, bez zuzywania proby limitu w bazie.
//
// PUDLO TOKENU PRZYCHODZI WARTOSCIA. Od REG-15 baza odpowiada na nieznany
// token `{ok:false, error:"invalid_token"}` - wyjatek wycofalby licznik prob.
// Rzucamy go w ksztalcie dawnego wyjatku bazy (`kod: ogon`), wiec mapa odmow
// zapisu tlumaczy oba okna wdrozenia tym samym slownikiem.
//
// JEDNORAZOWOSC. Udane wywolanie przypisuje miejsce, wiec `manage_token`
// i `qr_token` wracaja RAZ - komponent musi je pokazac, a nie schowac.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { EVENT_CONSENT_TEXT_VERSION } from "@/lib/events/consentTexts";
import type { RegistrationAnswer, RegistrationLang } from "@/lib/events/registrationPayload";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

/** 32 znaki (base64url organizatora) albo 64 znaki (token kupujacego). */
export const PACKAGE_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export function isPackageInviteToken(value: string): boolean {
  return PACKAGE_INVITE_TOKEN_PATTERN.test(value.trim());
}

/** Wejscie z adresu -> token albo `null`, gdy ksztalt sie nie zgadza. */
export function readPackageInviteToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isPackageInviteToken(trimmed) ? trimmed : null;
}

/** Stan zaproszenia z podgladu - te same nazwy co w bazie. */
export const PACKAGE_INVITE_STATES = [
  "open",
  "used",
  "expired",
  "order_cancelled",
  "order_refunded",
  "event_cancelled",
  "event_ended",
  "unavailable",
] as const;
export type PackageInviteState = (typeof PACKAGE_INVITE_STATES)[number];

export interface PackageInvitePreview {
  state: PackageInviteState;
  eventId: string | null;
  /** Slug do formularza wydarzenia (`event_registration_form`) - pola i regulaminy. */
  eventSlug: string | null;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
  eventStartsAt: string | null;
  inviteName: string | null;
  /** Zamaskowany adres zaproszenia (`j***@domena`) - pelnego baza nie oddaje. */
  inviteEmailHint: string | null;
  /** Zalogowane konto ma POTWIERDZONY adres zaproszenia - zgloszenie trafi do niego. */
  accountMatches: boolean;
  expiresAt: string | null;
}

export interface PackageInviteAcceptInput {
  token: string;
  firstName: string;
  lastName: string;
  jobTitle?: string | null;
  companyText?: string | null;
  /** Odpowiedzi na pola formularza wydarzenia (`event_registration_fields`). */
  answers?: RegistrationAnswer[];
  /** Zaakceptowane regulaminy (`event_terms`) - baza zapisuje ich wersje. */
  acceptedTermIds?: string[];
  consentDataProcessing: boolean;
  /**
   * Marketing organizatora. Baza zapisuje go WYLACZNIE dla zaproszonego
   * z potwierdzonym adresem konta (ta sciezka nie ma maila double opt-in) -
   * formularz pokazuje pole tylko wtedy.
   */
  consentMarketing?: boolean;
  /** Jezyk formularza: wersja tekstow zgod w ksiedze. Brak = `pl`. */
  lang?: RegistrationLang;
}

export interface PackageInviteAcceptResult {
  registrationId: string;
  eventId: string | null;
  eventSlug: string | null;
  status: string;
  /**
   * Miejsce z pakietu, którego zamówienie nie jest jeszcze opłacone (TIX-07):
   * zgłoszenie czeka (`pending`), kodu wejścia jeszcze nie ma - bilet przyjdzie
   * mailem po zaksięgowaniu płatności.
   */
  awaitingPayment: boolean;
  /** Kod wejscia - pokazywany raz, zaraz po przyjeciu zaproszenia. */
  qrToken: string | null;
  /** Jedyny klucz samoobslugi zgloszenia dla delegata bez konta. */
  manageToken: string | null;
  /**
   * Czy zgloszenie trafilo do konta wolajacego. `false` = zaproszenie na inny
   * adres albo konto bez potwierdzonego adresu; `null` = starsza baza.
   */
  accountLinked: boolean | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Odmowa wartoscia (`{ok:false, error}`) -> wyjatek w ksztalcie dawnego
 * wyjatku bazy. Glowa komunikatu jest nosnikiem powodu dla mapy odmow.
 */
function refusalOf(source: Bag | null): Error | null {
  if (source === null || source.ok !== false) return null;
  const code = text(source, "error") ?? "unknown";
  return new Error(`${code}: invitation refused`);
}

function answersPayload(answers: RegistrationAnswer[] | undefined): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const answer of answers ?? []) {
    const key = answer.key.trim();
    if (key === "") continue;
    out[key] = answer.value;
  }
  return out;
}

function stateOf(source: Bag): PackageInviteState {
  const raw = text(source, "state");
  return (PACKAGE_INVITE_STATES as readonly string[]).includes(raw ?? "")
    ? (raw as PackageInviteState)
    : "unavailable";
}

/**
 * Podglad zaproszenia przed formularzem. `null` = baza sprzed migracji
 * (PGRST202/42883) - strona pokazuje wtedy sam formularz, jak dotad.
 */
export async function fetchPackageInvitePreview(
  token: string,
): Promise<PackageInvitePreview | null> {
  const { data, error } = await supabase.rpc("event_package_invite_preview", {
    p_payload: { token },
  });
  if (error) {
    if (isMigrationPending(error)) return null;
    throw error;
  }
  const source = bag(data);
  const refusal = refusalOf(source);
  if (refusal !== null) throw refusal;
  if (source === null) throw new Error("unknown: invitation preview is not readable");
  return {
    state: stateOf(source),
    eventId: text(source, "event_id"),
    eventSlug: text(source, "event_slug"),
    eventTitlePl: text(source, "event_title_pl"),
    eventTitleEn: text(source, "event_title_en"),
    eventStartsAt: text(source, "event_starts_at"),
    inviteName: text(source, "invite_name"),
    inviteEmailHint: text(source, "invite_email_hint"),
    accountMatches: source.account_matches === true,
    expiresAt: text(source, "expires_at"),
  };
}

export async function acceptPackageInvite(
  input: PackageInviteAcceptInput,
): Promise<PackageInviteAcceptResult> {
  const payload: Record<string, Json> = {
    token: input.token,
    first_name: input.firstName,
    last_name: input.lastName,
    consent_data_processing: input.consentDataProcessing,
    answers: answersPayload(input.answers),
    accepted_term_ids: input.acceptedTermIds ?? [],
    // „Nie zaznaczyl" i „nie pytano" to rozne rzeczy dla ksiegi zgod -
    // nieoznaczony marketing jedzie jako jawne `false`.
    consent_marketing: input.consentMarketing === true,
    lang: input.lang === "en" ? "en" : "pl",
    // Wersja tekstow, ktore formularz pokazal (ksiega zgod, A2).
    consent_text_version: EVENT_CONSENT_TEXT_VERSION,
  };
  // `undefined` nie jedzie do RPC: brak klucza znaczy „nie dotykaj", a jawny
  // `null` znaczylby „wyczysc" juz zapisane dane osoby.
  if (input.jobTitle !== undefined && input.jobTitle !== null && input.jobTitle !== "") {
    payload.job_title = input.jobTitle;
  }
  if (input.companyText !== undefined && input.companyText !== null && input.companyText !== "") {
    payload.company_text = input.companyText;
  }

  const { data, error } = await supabase.rpc("event_package_invite_accept", {
    p_payload: payload,
  });
  if (error) throw error;

  const source = bag(data);
  const refusal = refusalOf(source);
  if (refusal !== null) throw refusal;
  const registrationId = source === null ? null : text(source, "registration_id");
  if (source === null || registrationId === null) {
    // Miejsce moglo zostac przypisane, ale bez identyfikatora nie umiemy go
    // pokazac ani odwolac - mowimy o tym wprost, zamiast rysowac pusty sukces.
    throw new Error("unknown: invitation response is not readable");
  }

  // Brak `status` = baza sprzed 20261012130000, która przyjmowała od razu.
  const status = text(source, "status") ?? "approved";
  return {
    registrationId,
    eventId: text(source, "event_id"),
    eventSlug: text(source, "event_slug"),
    status,
    awaitingPayment: source.awaiting_payment === true || status === "pending",
    qrToken: text(source, "qr_token"),
    manageToken: text(source, "manage_token"),
    accountLinked: typeof source.account_linked === "boolean" ? source.account_linked : null,
  };
}
