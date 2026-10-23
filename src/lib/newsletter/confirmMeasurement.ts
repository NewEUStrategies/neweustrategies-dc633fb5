// KONTRAKT TRAS: POTWIERDZENIE DOUBLE OPT-IN Z KARTĄ ZGODY NA POMIAR I JĘZYK
// STRONY POMIARU (I9d-Y2b, rozstrzygnięcia R1.19 i R1.20).
//
// Jedno źródło kształtów, które piszą DWIE strony: trasa API
// (`src/routes/api.public.newsletter.confirm.ts`,
// `src/routes/api.public.newsletter.measurement.ts`) i strony publiczne
// (`src/routes/newsletter.confirm.tsx` z kartą decyzji,
// `src/routes/newsletter.measurement.tsx`).
//
// 1. GET /api/public/newsletter/confirm (fetch strony, JSON) - potwierdzenie
//    zapisu jak dotąd; po sukcesie (także `already`) odpowiedź niesie stan
//    karty zgody na pomiar z `newsletter_doi_measurement_state`:
//    `{ ok: true, [already: true], measurement, measurementLang }`.
//    FAIL-CLOSED: błąd RPC, `invalid`, `inactive`, `gone` albo nieznany kształt
//    -> `measurement: "none"` (brak karty). GET NIGDY nie udziela zgody.
// 2. POST /api/public/newsletter/confirm - decyzja z karty (wyłącznie
//    `content-type: application/json`, ciało `{ token, decision }`) ->
//    `newsletter_doi_measurement_decide` -> `{ ok: true, result }` albo
//    `{ ok: false, error }` z kodem HTTP z `DOI_MEASUREMENT_DECISION_ERRORS`.
// 3. GET /api/public/newsletter/measurement (fetch strony) - przy akcji
//    `confirm` odpowiedź niesie `lang` SUBSKRYBENTA (reguła `consentLangOf`
//    = język zapisu w `_email_measurement_grant`); strona renderuje treść
//    zgody w tym języku, nie w języku z adresu.
//
// Odpowiedzi nigdy nie zawierają adresu e-mail. Parsery tolerują nadmiarowe
// pola i każdy nieznany kształt sprowadzają do stanu bezpiecznego.
//
// MODUŁ CZYSTY: bez I/O, bez zod (wzorzec `src/lib/privacy/measurement.ts`) -
// czytają go trasa serwera, strona i lekko ładowana karta.
import type { MeasurementResponseBody } from "@/lib/privacy/measurement";
import type { ConsentLang } from "./consentSegments";

/** Endpoint potwierdzenia zapisu (GET) i decyzji z karty pomiaru (POST). */
export const NEWSLETTER_CONFIRM_API_PATH = "/api/public/newsletter/confirm";

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function langOf(value: unknown): ConsentLang | null {
  return value === "pl" || value === "en" ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : null;
}

/**
 * Format tokenu potwierdzenia: 16-128 znaków szesnastkowych (ta sama reguła
 * co `isValidConfirmToken` trasy - trasa może do niej delegować).
 */
export function isConfirmTokenFormat(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= 16 &&
    token.length <= 128 &&
    /^[a-f0-9]+$/i.test(token)
  );
}

// ---------------------------------------------------------------------------
// 1. GET - potwierdzenie zapisu i stan karty pomiaru
// ---------------------------------------------------------------------------

/**
 * Stan karty pomiaru po potwierdzeniu: `offer` - pokaż kartę decyzji;
 * `granted`/`declined` - decyzja już zapisana; `none` - brak deklaracji
 * w formularzu albo stan nieustalony (fail-closed).
 */
export const DOI_MEASUREMENT_STATES = ["offer", "granted", "declined", "none"] as const;
export type DoiMeasurementState = (typeof DOI_MEASUREMENT_STATES)[number];

/** Wyniki RPC `newsletter_doi_measurement_state` (rpc-shape: result, lang). */
export const DOI_MEASUREMENT_STATE_RESULTS = [
  "offer",
  "granted",
  "declined",
  "none",
  "inactive",
  "gone",
  "invalid",
] as const;

/** Pola pomiaru w odpowiedzi GET (gałąź sukcesu: `confirm` i `already`). */
export interface DoiMeasurementFields {
  measurement: DoiMeasurementState;
  /** Język treści zgody na karcie = język zapisu w rejestrze (subskrybent). */
  measurementLang: ConsentLang;
}

/** Kody błędów GET (stałe - komunikat Postgresa nie wychodzi do klienta). */
export type NewsletterConfirmGetError =
  | "invalid_token" // 400
  | "not_found" // 404
  | "expired" // 410
  | "confirm_failed" // 500 - zdjęcie wypisu z listy wykluczeń
  | "update_failed"; // 500 - zapis statusu

/** Ciało odpowiedzi GET (JSON). */
export type NewsletterConfirmGetResponse =
  | ({ ok: true; already?: true } & DoiMeasurementFields)
  | { ok: false; error: NewsletterConfirmGetError };

/**
 * SERWER: wynik `newsletter_doi_measurement_state` -> pola odpowiedzi GET.
 * Błąd RPC (trasa podaje wtedy `null`), `invalid`/`inactive`/`gone` i nieznany
 * kształt dają `none`. Język: z RPC, a gdy go brak - `fallbackLang`
 * (`consentLangOf(sub.language)` tego samego wiersza; ta sama reguła co SQL).
 */
export function doiMeasurementFieldsOf(
  data: unknown,
  fallbackLang: ConsentLang,
): DoiMeasurementFields {
  const row = recordOf(data);
  const result = oneOf(row?.result, DOI_MEASUREMENT_STATE_RESULTS);
  const measurement: DoiMeasurementState =
    result === "offer" || result === "granted" || result === "declined" ? result : "none";
  return { measurement, measurementLang: langOf(row?.lang) ?? fallbackLang };
}

/** Stan strony `/newsletter/confirm` (bez zmian względem dotychczasowej). */
export type NewsletterConfirmPageState = "ok" | "already" | "expired" | "error";

/** Odpowiedź GET widziana przez stronę. */
export interface NewsletterConfirmView {
  state: NewsletterConfirmPageState;
  /**
   * Karta decyzji o pomiarze: WYŁĄCZNIE przy `ok`/`already`, `measurement:
   * "offer"` i poprawnym `measurementLang`; w każdym innym przypadku `null`.
   */
  measurementCard: { lang: ConsentLang } | null;
  /** Stan `error`: kod z odpowiedzi albo `HTTP <status>`; inaczej `null`. */
  detail: string | null;
}

/** STRONA: status i ciało GET -> stan strony i karta pomiaru (fail-closed). */
export function newsletterConfirmViewOf(status: number, body: unknown): NewsletterConfirmView {
  const row = recordOf(body) ?? {};
  if (row.ok === true) {
    const lang = langOf(row.measurementLang);
    return {
      state: row.already === true ? "already" : "ok",
      measurementCard: row.measurement === "offer" && lang ? { lang } : null,
      detail: null,
    };
  }
  if (row.error === "expired") return { state: "expired", measurementCard: null, detail: null };
  return {
    state: "error",
    measurementCard: null,
    detail: typeof row.error === "string" && row.error ? row.error : `HTTP ${status}`,
  };
}

// ---------------------------------------------------------------------------
// 2. POST - decyzja z karty pomiaru na stronie potwierdzenia
// ---------------------------------------------------------------------------

export const DOI_MEASUREMENT_DECISIONS = ["grant", "decline"] as const;
export type DoiMeasurementDecision = (typeof DOI_MEASUREMENT_DECISIONS)[number];

/** Ciało POST (JSON). Token = token DOI z linku maila (ten sam co w GET). */
export interface DoiMeasurementDecisionRequest {
  token: string;
  decision: DoiMeasurementDecision;
}

export type DoiMeasurementDecisionParse =
  | { ok: true; request: DoiMeasurementDecisionRequest }
  | { ok: false; error: "invalid_token" | "invalid_decision" };

/** SERWER: sparsowane ciało JSON -> żądanie decyzji (najpierw token, potem decyzja). */
export function parseDoiMeasurementDecisionRequest(body: unknown): DoiMeasurementDecisionParse {
  const row = recordOf(body);
  const token = row?.token;
  if (!isConfirmTokenFormat(token)) return { ok: false, error: "invalid_token" };
  const decision = oneOf(row?.decision, DOI_MEASUREMENT_DECISIONS);
  if (decision === null) return { ok: false, error: "invalid_decision" };
  return { ok: true, request: { token, decision } };
}

/** Wynik zapisanej (albo już zapisanej) decyzji. */
export const DOI_MEASUREMENT_DECISION_RESULTS = ["granted", "declined", "already"] as const;
export type DoiMeasurementDecisionResult = (typeof DOI_MEASUREMENT_DECISION_RESULTS)[number];

/** Kody błędów POST -> status HTTP. */
export const DOI_MEASUREMENT_DECISION_ERRORS = {
  unsupported_media_type: 415, // ciało inne niż application/json
  invalid_token: 400, // zły format tokenu albo RPC `invalid`/`gone`
  invalid_decision: 400, // `decision` spoza listy
  inactive: 409, // subskrybent nieaktywny (wypis, `pending`)
  none: 422, // brak deklaracji w formularzu albo decyzja po terminie
  rate_limited: 429, // limiter per IP
  update_failed: 500, // błąd RPC albo nieznany kształt wyniku
} as const;
export type DoiMeasurementDecisionError = keyof typeof DOI_MEASUREMENT_DECISION_ERRORS;

/** Ciało odpowiedzi POST (JSON). */
export type DoiMeasurementDecisionResponse =
  | { ok: true; result: DoiMeasurementDecisionResult }
  | { ok: false; error: DoiMeasurementDecisionError };

/** Odpowiedź POST do wysłania: status i ciało. */
export interface DoiMeasurementDecisionReply {
  status: number;
  body: DoiMeasurementDecisionResponse;
}

/** SERWER: kod błędu -> odpowiedź (status z `DOI_MEASUREMENT_DECISION_ERRORS`). */
export function doiMeasurementDecisionError(
  error: DoiMeasurementDecisionError,
): DoiMeasurementDecisionReply {
  return { status: DOI_MEASUREMENT_DECISION_ERRORS[error], body: { ok: false, error } };
}

/** Wyniki RPC `newsletter_doi_measurement_decide` (rpc-shape: result, lang). */
export const DOI_MEASUREMENT_DECIDE_RESULTS = [
  "granted",
  "declined",
  "already",
  "invalid",
  "inactive",
  "none",
  "gone",
] as const;

/**
 * SERWER: wynik `newsletter_doi_measurement_decide` -> odpowiedź POST.
 * Nieznany kształt -> `null` (trasa loguje i odpowiada `update_failed`).
 */
export function doiMeasurementDecisionReplyOf(data: unknown): DoiMeasurementDecisionReply | null {
  const result = oneOf(recordOf(data)?.result, DOI_MEASUREMENT_DECIDE_RESULTS);
  switch (result) {
    case "granted":
    case "declined":
    case "already":
      return { status: 200, body: { ok: true, result } };
    case "inactive":
      return doiMeasurementDecisionError("inactive");
    case "none":
      return doiMeasurementDecisionError("none");
    case "invalid":
    case "gone":
      return doiMeasurementDecisionError("invalid_token");
    default:
      return null;
  }
}

/** Stan karty po kliknięciu (wynik w `aria-live`). */
export type DoiMeasurementDecisionView =
  DoiMeasurementDecisionResult | "invalid" | "inactive" | "none" | "rateLimited" | "error";

/** KARTA: status i ciało POST -> stan karty; nieznany kod = błąd z ponowieniem. */
export function doiMeasurementDecisionViewOf(
  status: number,
  body: unknown,
): DoiMeasurementDecisionView {
  const row = recordOf(body) ?? {};
  if (row.ok === true) {
    return oneOf(row.result, DOI_MEASUREMENT_DECISION_RESULTS) ?? "error";
  }
  switch (row.error) {
    case "invalid_token":
    case "invalid_decision":
      return "invalid";
    case "inactive":
      return "inactive";
    case "none":
      return "none";
    case "rate_limited":
      return "rateLimited";
    default:
      return status === 429 ? "rateLimited" : "error";
  }
}

// ---------------------------------------------------------------------------
// 3. GET strony pomiaru - język subskrybenta (R1.19)
// ---------------------------------------------------------------------------

/**
 * Ciało GET `/api/public/newsletter/measurement` z językiem subskrybenta.
 * Akcja `confirm`: `lang` OBOWIĄZKOWY (`consentLangOf(language)` wiersza
 * subskrybenta z tokenu). Akcja `withdraw`: `lang` opcjonalny.
 */
export type MeasurementPageCheckBody = MeasurementResponseBody & { lang?: ConsentLang };

/**
 * STRONA: język treści zgody z odpowiedzi GET; brak albo wartość spoza
 * `pl`/`en` -> `null`. Przy akcji `confirm` `null` oznacza błąd z ponowieniem
 * sprawdzenia - bez przycisku zgody (osoba musi widzieć treść w języku,
 * w którym baza ją zapisze - art. 7 ust. 1 RODO).
 */
export function measurementPageLangOf(body: unknown): ConsentLang | null {
  return langOf(recordOf(body)?.lang);
}
