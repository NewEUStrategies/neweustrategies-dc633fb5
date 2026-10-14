// Kontrakt przewodu publicznego zapisu na wydarzenie - ładunek `p_payload`
// i kształt odpowiedzi `event_register_for_client` (B1a, REG_DESIGN §2).
//
// CZYSTY MODUŁ, BO JEST PO OBU STRONACH. Ładunek składa funkcja serwerowa
// (`eventRegistration.server.ts`) z wejścia, które przeszło schemat, a ten sam
// kształt odpowiedzi czyta przeglądarka (`publicRegistrationApi.ts`) i serwer
// przy mapowaniu starej funkcji (`event_register`) w oknie wdrożenia. Jedna
// definicja to jedna lista kluczy - druga kopia rozjechałaby się przy pierwszej
// zmianie po którejkolwiek stronie.
//
// BIAŁA LISTA, NIE KOPIA WEJŚCIA. `_event_register` czyta ładunek po nazwie
// i nie protestuje przeciw kluczowi, którego nie zna, więc o tym, co dociera
// do bazy, decyduje WYŁĄCZNIE ta funkcja. Nigdy nie jadą tu: skrót adresu ani
// przeglądarka (`ip_hash`, `user_agent` - liczy je serwer z żądania i podaje
// bazie osobnymi argumentami), najemca, konto ani osoba (sesja i host, nie
// ciało żądania), status, płatność, kwota.
//
// `undefined` NIE JEDZIE DO RPC. Pomijamy nieustawione klucze, bo w plpgsql
// `p_payload->>'x'` na jawnym `null` znaczy „wyczyść", a brak klucza znaczy
// „nie dotykaj".
import type { Json } from "@/integrations/supabase/types";
import type { AdTouchWire } from "@/lib/analytics/adAttribution";
import { EVENT_CONSENT_TEXT_VERSION } from "@/lib/events/consentTexts";

export interface RegistrationAnswer {
  key: string;
  /** Napis, liczba, prawda/fałsz albo lista wartości dla `multiselect`. */
  value: string | number | boolean | string[];
}

/** Język formularza: wersja tekstu zgód w księdze i język maili do uczestnika. */
export type RegistrationLang = "pl" | "en";

export interface RegisterInput {
  eventSlug: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle?: string | null;
  companyText?: string | null;
  socialProfileUrl?: string | null;
  ticketTypeId?: string | null;
  /** Kod dostępu wejściówki za kodem; pusty albo brak - klucz nie jedzie. */
  accessCode?: string | null;
  /**
   * Kod ODSŁANIAJĄCY ukryty bilet bez kodu dostępu (`reveals_hidden`).
   * Bez niego baza odpowiada na taki bilet `not_found` (REG-05, decyzja D6).
   */
  revealCode?: string | null;
  answers?: RegistrationAnswer[];
  acceptedTermIds?: string[];
  consentDataProcessing: boolean;
  consentMarketing?: boolean;
  consentPartnerSharing?: boolean;
  /** Brak = `pl`, jak w bazie. */
  lang?: RegistrationLang;
}

/**
 * Atrybucja kampanii zgłoszenia (`attributionPayload()` z przeglądarki, po
 * bramce zgody). NIE jest częścią `p_payload`: serwer przypina ją po zapisie
 * kluczem samoobsługi (`event_registration_attribution_attach`), którego
 * przeglądarka niezweryfikowanego wołającego już nie dostaje.
 */
export type RegistrationAttribution = {
  first: AdTouchWire | null;
  last: AdTouchWire | null;
  ad_consent: boolean;
};

/** Wejście funkcji serwerowej zapisu - ładunek formularza plus dodatki serwera. */
export interface EventRegistrationRequest extends RegisterInput {
  lang: RegistrationLang;
  attribution?: RegistrationAttribution | null;
}

/**
 * KOMPLET kluczy, które może zawierać `p_payload` (REG_DESIGN §2, B1a).
 * Test porównuje z tą listą każdy ładunek - klucz spoza niej to pole, którego
 * formularz nie oferuje, a które baza mogłaby kiedyś zacząć czytać.
 */
export const REGISTRATION_PAYLOAD_KEYS = [
  "event_slug",
  "ticket_type_id",
  "access_code",
  "reveal_code",
  "first_name",
  "last_name",
  "email",
  "phone",
  "job_title",
  "company_text",
  "social_profile_url",
  "answers",
  "accepted_term_ids",
  "consent_data_processing",
  "consent_marketing",
  "consent_partner_sharing",
  "lang",
  "consent_text_version",
] as const;

export type RegistrationPayloadKey = (typeof REGISTRATION_PAYLOAD_KEYS)[number];

function answersPayload(answers: RegistrationAnswer[] | undefined): Json {
  const out: Record<string, Json> = {};
  for (const answer of answers ?? []) {
    const key = answer.key.trim();
    if (key === "") continue;
    out[key] = answer.value;
  }
  return out;
}

/** Kod po przycięciu albo `null`, gdy nie ma czego wysłać. */
function codeOf(value: string | null | undefined): string | null {
  const code = value?.trim() ?? "";
  return code === "" ? null : code;
}

/** Ładunek `p_payload` - wyłącznie klucze z białej listy, nieustawione pominięte. */
export type RegistrationPayload = Partial<Record<RegistrationPayloadKey, Json>>;

/** `p_payload` dla `event_register_for_client` - wyłącznie klucze z białej listy. */
export function registrationPayload(input: RegisterInput): RegistrationPayload {
  const payload: RegistrationPayload = {
    event_slug: input.eventSlug,
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    answers: answersPayload(input.answers),
    accepted_term_ids: input.acceptedTermIds ?? [],
    consent_data_processing: input.consentDataProcessing,
    // „Nie zaznaczył" i „nie pytano" to dwa różne wpisy w księdze zgód -
    // nieoznaczona zgoda jedzie jako jawne `false`, nie jako brak klucza.
    consent_marketing: input.consentMarketing === true,
    consent_partner_sharing: input.consentPartnerSharing === true,
    lang: input.lang === "en" ? "en" : "pl",
    // Wersja tekstów, które formularz właśnie pokazał - księga zgód zapisuje
    // ją przy każdym wpisie, a baza odrzuca wersję, której nie zna.
    consent_text_version: EVENT_CONSENT_TEXT_VERSION,
  };
  if (input.phone !== undefined) payload.phone = input.phone;
  if (input.jobTitle !== undefined) payload.job_title = input.jobTitle;
  if (input.companyText !== undefined) payload.company_text = input.companyText;
  if (input.socialProfileUrl !== undefined) payload.social_profile_url = input.socialProfileUrl;
  if (input.ticketTypeId !== undefined) payload.ticket_type_id = input.ticketTypeId;
  const accessCode = codeOf(input.accessCode);
  if (accessCode !== null) payload.access_code = accessCode;
  const revealCode = codeOf(input.revealCode);
  if (revealCode !== null) payload.reveal_code = revealCode;
  return payload;
}

/**
 * Odmowy `event_register_for_client` (REG_DESIGN §2, B1a) w kolejności
 * z kontraktu. Każda MUSI mieć zdanie `eventRegistration.errors.<camel>` w obu
 * językach - pilnuje tego test, bo nieznany kod degraduje do ogólnego „Nie
 * udało się zapisać", które nie mówi uczestnikowi, co poprawić.
 */
export const EVENT_REGISTER_REFUSALS = [
  "rate_limited",
  "invalid_payload",
  "invalid_name",
  "invalid_email",
  "invalid_phone",
  "invalid_job_title",
  "invalid_company",
  "invalid_social_url",
  "invalid_answers",
  "payload_too_large",
  "consent_required",
  "invalid_event",
  "not_found",
  "event_cancelled",
  "event_ended",
  "registration_disabled",
  "registration_external",
  "registration_not_open",
  "membership_required",
  "ticket_required",
  "ticket_not_on_sale",
  "ticket_sales_ended",
  "ticket_tier_required",
  "invalid_access_code",
  "payment_account_required",
  "account_email_required",
  "missing_required_fields",
  "missing_required_consents",
  "terms_required",
  "sold_out",
  "already_registered",
  "unknown",
] as const;

export type EventRegisterRefusal = (typeof EVENT_REGISTER_REFUSALS)[number];

/** Odmowa - jedyny szczegół to ogon trzech kodów z listami (`detail`). */
export interface RegistrationRefusalClient {
  ok: false;
  error: string;
  detail?: string;
}

/**
 * Odpowiedź NEUTRALNA (decyzja D3): ta sama stała dla „utworzono" i „już
 * zapisany", gdy wołający nie jest zweryfikowanym właścicielem adresu. Wynik
 * (i klucz samoobsługi) dostaje skrzynka, nie przeglądarka.
 */
export interface RegistrationCheckEmailClient {
  ok: true;
  outcome: "check_email";
}

/** Zapis zweryfikowanego właściciela adresu - klucze opisuje `RegistrationResult`. */
export type RegistrationRegisteredClient = { ok: true; outcome: "registered" } & {
  [key: string]: Json | undefined;
};

export type EventRegisterClient =
  RegistrationRefusalClient | RegistrationCheckEmailClient | RegistrationRegisteredClient;

/** Odmowa bez rozpoznanej przyczyny - ten sam kształt, co `unknown` z bazy. */
export const UNKNOWN_REGISTRATION_REFUSAL: RegistrationRefusalClient = {
  ok: false,
  error: "unknown",
};
