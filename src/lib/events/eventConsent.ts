// Zgody uczestnika wydarzeń po stronie interfejsu - kształty odpowiedzi
// funkcji serwerowych (`eventConsent.functions.ts`) i ich parsery (REG-02 /
// REG-14).
//
// CZYSTY MODUŁ (bez serwera, bez Reacta): czyta go strona potwierdzenia
// linku z maila, gniazdo zgód na stronie samoobsługi, sekcja zgód w profilu
// i warstwa serwerowa, która z surowego `jsonb` bazy robi te same kształty.
// Jeden parser = jedna prawda o tym, co znaczy odpowiedź bazy; nieznana
// wartość nigdy nie udaje znanej (stan spoza listy to `not_found`, cel spoza
// listy jest pomijany).
//
// TOKEN Z MAILA JEDZIE WE FRAGMENCIE (`#token=`), NIE W ZAPYTANIU. Link double
// opt-in to poświadczenie: fragmentu przeglądarka nie wysyła na serwer, więc
// nie trafia do logów dostępu, nagłówka `Referer` ani podglądu linków
// w poczcie (ten sam wzorzec co bilet z kodem QR, `manageToken.ts`).
import {
  EVENT_CONSENT_EVIDENCES,
  EVENT_CONSENT_PURPOSES,
  EVENT_CONSENT_STATUSES,
  type EventConsentEvidence,
  type EventConsentGrantPurpose,
  type EventConsentLang,
  type EventConsentPurpose,
  type EventConsentStatus,
} from "@/lib/events/consentTexts";
import { readManageToken } from "@/lib/events/manageToken";

/** Stan linku double opt-in - ta sama lista co `_event_consent_confirmation_state`. */
export const EVENT_CONSENT_LINK_STATES = ["open", "already", "expired", "not_found"] as const;
export type EventConsentLinkState = (typeof EVENT_CONSENT_LINK_STATES)[number];

/** Co uczestnik może wycofać jednym przyciskiem. */
export const EVENT_CONSENT_WITHDRAW_SCOPES = ["marketing", "partner_sharing", "all"] as const;
export type EventConsentWithdrawScope = (typeof EVENT_CONSENT_WITHDRAW_SCOPES)[number];

export interface EventConsentPreviewEvent {
  slug: string | null;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  timezone: string | null;
}

export interface EventConsentPreviewText {
  purpose: EventConsentGrantPurpose;
  body: string;
}

/** Podgląd linku z maila - bez danych osobowych (adres, imię, nazwisko). */
export interface EventConsentPreview {
  state: EventConsentLinkState;
  purposes: EventConsentGrantPurpose[];
  lang: EventConsentLang | null;
  expiresAt: string | null;
  event: EventConsentPreviewEvent | null;
  /** Dokładne teksty zgód z wersji linku - to je osoba potwierdza. */
  texts: EventConsentPreviewText[];
}

export type EventConsentPreviewResult =
  | { ok: true; preview: EventConsentPreview }
  /** `unavailable` = baza bez funkcji (okno wdrożenia), `error` = awaria. */
  | { ok: false; reason: "unavailable" | "error" };

export type EventConsentConfirmResult =
  | { ok: true; state: "confirmed" | "already"; purposes: EventConsentGrantPurpose[] }
  | {
      ok: false;
      state: "expired" | "not_found" | "rate_limited" | "unavailable" | "error";
    };

/**
 * Wynik wycofania. `ok: true` NIE mówi, czy osoba istnieje ani co miała -
 * baza odpowiada tak samo dla każdego poświadczenia (art. 7 ust. 3 RODO bez
 * wyroczni stanu cudzych zgód).
 */
export type EventConsentWithdrawResult =
  | { ok: true }
  | {
      ok: false;
      reason: "rate_limited" | "invalid_payload" | "no_credential" | "unavailable" | "error";
    };

export interface EventConsentLedgerEntry {
  purpose: EventConsentPurpose;
  status: EventConsentStatus;
  evidence: EventConsentEvidence;
  createdAt: string;
  textVersion: number | null;
  textLang: EventConsentLang | null;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
}

export interface EventConsentProjection {
  dataProcessingAt: string | null;
  marketingAt: string | null;
  partnerSharingAt: string | null;
  withdrawnAt: string | null;
}

export interface EventConsentOpenConfirmation {
  purposes: EventConsentGrantPurpose[];
  createdAt: string | null;
  expiresAt: string | null;
}

/** Zgody zalogowanego uczestnika w najemcy hosta (`event_my_consent_state`). */
export interface MyEventConsentState {
  linked: boolean;
  email: string | null;
  consents: EventConsentProjection | null;
  openConfirmation: EventConsentOpenConfirmation | null;
  ledger: EventConsentLedgerEntry[];
}

export type MyEventConsentStateResult =
  { ok: true; state: MyEventConsentState } | { ok: false; reason: "unavailable" | "error" };

/** Ścieżka strony potwierdzenia: `/event-consent/confirm#token=<token>` (mail B1b). */
export function eventConsentConfirmPath(token: string): string {
  return `/event-consent/confirm#token=${encodeURIComponent(token)}`;
}

/**
 * `location.hash` -> token albo `null`. Kształt jak klucz samoobsługi
 * (`_event_new_qr_token()`: 32 znaki base64url) - literówka z wklejenia nie
 * idzie do sieci, tylko od razu daje „link nieznany".
 */
export function readConsentFragmentToken(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return readManageToken(params.get("token"));
}

type Bag = { [key: string]: unknown };

function bagOf(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function langOf(value: unknown): EventConsentLang | null {
  return value === "pl" || value === "en" ? value : null;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

function grantPurposes(value: unknown): EventConsentGrantPurpose[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is EventConsentGrantPurpose => item === "marketing" || item === "partner_sharing",
  );
}

function eventOf(value: unknown): EventConsentPreviewEvent | null {
  const bag = bagOf(value);
  if (bag === null) return null;
  return {
    slug: textOf(bag.slug),
    titlePl: textOf(bag.title_pl),
    titleEn: textOf(bag.title_en),
    startsAt: textOf(bag.starts_at),
    timezone: textOf(bag.timezone),
  };
}

/** `event_consent_confirmation_preview` -> podgląd. Nieznany stan = `not_found`. */
export function parseEventConsentPreview(data: unknown): EventConsentPreview {
  const bag = bagOf(data) ?? {};
  const texts: EventConsentPreviewText[] = [];
  if (Array.isArray(bag.texts)) {
    for (const item of bag.texts) {
      const row = bagOf(item);
      const purpose = row === null ? null : oneOf(["marketing", "partner_sharing"], row.purpose);
      const body = row === null ? null : textOf(row.body);
      if (purpose !== null && body !== null) texts.push({ purpose, body });
    }
  }
  return {
    state: oneOf(EVENT_CONSENT_LINK_STATES, bag.state) ?? "not_found",
    purposes: grantPurposes(bag.purposes),
    lang: langOf(bag.lang),
    expiresAt: textOf(bag.expires_at),
    event: eventOf(bag.event),
    texts,
  };
}

const CONFIRM_REFUSALS = ["expired", "not_found", "rate_limited"] as const;

/** `event_consent_confirm_for_request` -> wynik. Nieznana odpowiedź = `error`. */
export function parseEventConsentConfirm(data: unknown): EventConsentConfirmResult {
  const bag = bagOf(data);
  const state = bag === null ? null : bag.state;
  if (bag !== null && (state === "confirmed" || state === "already")) {
    return { ok: true, state, purposes: grantPurposes(bag.purposes) };
  }
  const refusal = oneOf(CONFIRM_REFUSALS, state);
  return { ok: false, state: refusal ?? "error" };
}

/** `event_consent_withdraw_for_request` -> wynik (stałe `{ok:true}` albo odmowa). */
export function parseEventConsentWithdraw(data: unknown): EventConsentWithdrawResult {
  const bag = bagOf(data);
  if (bag !== null && bag.ok === true) return { ok: true };
  const error = bag === null ? null : bag.error;
  if (error === "rate_limited" || error === "invalid_payload") return { ok: false, reason: error };
  return { ok: false, reason: "error" };
}

function ledgerOf(value: unknown): EventConsentLedgerEntry[] {
  if (!Array.isArray(value)) return [];
  const out: EventConsentLedgerEntry[] = [];
  for (const item of value) {
    const row = bagOf(item);
    if (row === null) continue;
    const purpose = oneOf(EVENT_CONSENT_PURPOSES, row.purpose);
    const status = oneOf(EVENT_CONSENT_STATUSES, row.status);
    const evidence = oneOf(EVENT_CONSENT_EVIDENCES, row.evidence);
    const createdAt = textOf(row.created_at);
    if (purpose === null || status === null || evidence === null || createdAt === null) continue;
    out.push({
      purpose,
      status,
      evidence,
      createdAt,
      textVersion: typeof row.text_version === "number" ? row.text_version : null,
      textLang: langOf(row.text_lang),
      eventTitlePl: textOf(row.event_title_pl),
      eventTitleEn: textOf(row.event_title_en),
    });
  }
  return out;
}

export function parseConsentProjection(value: unknown): EventConsentProjection | null {
  const bag = bagOf(value);
  if (bag === null) return null;
  return {
    dataProcessingAt: textOf(bag.data_processing_at),
    marketingAt: textOf(bag.marketing_at),
    partnerSharingAt: textOf(bag.partner_sharing_at),
    withdrawnAt: textOf(bag.withdrawn_at),
  };
}

export function parseOpenConfirmation(value: unknown): EventConsentOpenConfirmation | null {
  const bag = bagOf(value);
  if (bag === null) return null;
  return {
    purposes: grantPurposes(bag.purposes),
    createdAt: textOf(bag.created_at),
    expiresAt: textOf(bag.expires_at),
  };
}

/** `event_my_consent_state` -> stan zgód uczestnika. */
export function parseMyEventConsentState(data: unknown): MyEventConsentState {
  const bag = bagOf(data) ?? {};
  return {
    linked: bag.linked === true,
    email: textOf(bag.email),
    consents: parseConsentProjection(bag.consents),
    openConfirmation: parseOpenConfirmation(bag.open_confirmation),
    ledger: ledgerOf(bag.ledger),
  };
}

/** Czy uczestnik ma jeszcze cokolwiek do wycofania (marketing albo partnerzy). */
export function hasActiveGrant(consents: EventConsentProjection | null): boolean {
  return consents !== null && (consents.marketingAt !== null || consents.partnerSharingAt !== null);
}
