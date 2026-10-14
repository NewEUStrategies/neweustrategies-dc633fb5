// Kanały powiadomień, przypomnienia i zgoda na SMS JEDNEGO zgłoszenia
// (REG-09 / REG-10, decyzja D12).
//
// PISARZ: `event_registration_set_channels`. Identyfikator zgłoszenia
// zalogowanego właściciela albo klucz `manage_token` z maila (jedyna droga
// gościa bez konta). Wysyłamy WYŁĄCZNIE zmieniony klucz - baza czyta obecność
// klucza, a brak znaczy „zostaw jak było" (inaczej przełącznik z jednego
// urządzenia nadpisywałby decyzję z drugiego).
//
// SMS TYLKO ZA JAWNĄ ZGODĄ. `notify_sms` jest domyślnie wyłączony, a każde
// włączenie SMS-a (kanał albo przypomnienia, false -> true) musi nieść
// `sms_consent: true` - baza stempluje wtedy zgodę i wymaga numeru
// (`sms_consent_required` / `phone_required`). Zmiana numeru zdejmuje zgodę.
// `notify_*` to główne przełączniki kanału, `remind_*` - podprzełączniki
// przypomnień.
//
// WYCOFANIE ZAWSZE (przegląd R67). Klucz zgłoszenia zamkniętego albo po końcu
// wydarzenia przyjmuje WYŁĄCZNIE wyłączenie (każdy wysłany przełącznik
// `false`, bez zgody) - włączenie dostaje dotychczasową odmowę
// (`already_closed` / `manage_expired`). Okno zgody odsyła podpowiedź numeru,
// którą pokazało (`phoneHint`); numer zmieniony w międzyczasie daje
// `phone_changed`.
//
// ODCZYT: `event_registration_preferences` - ta sama tożsamość, odmowy
// WARTOŚCIĄ (`not_found` / `expired`, jak podgląd rezygnacji). Numer telefonu
// nie wychodzi nigdy: tylko trzy ostatnie cyfry do zdania o zgodzie.
//
// Najemca i tożsamość rozstrzyga baza (`public_tenant_id()`, `auth.uid()`) -
// klient nie wysyła ani jednego, ani drugiego.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

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

function bool(source: Bag, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

export interface ChannelPrefsInput {
  registrationId?: string;
  /** Klucz z maila - jedyna droga dla uczestnika bez konta. */
  manageToken?: string;
  notifyEmail?: boolean;
  notifySms?: boolean;
  remindEmail?: boolean;
  remindPush?: boolean;
  remindSms?: boolean;
  remindSessions?: boolean;
  /**
   * Jawna zgoda na SMS-y o tym zgłoszeniu - wymagana przy KAŻDYM włączeniu
   * SMS-a (`notifySms` albo `remindSms` z false na true). Wysyła ją wyłącznie
   * potwierdzenie w oknie zgody (`SmsConsentConfirm`).
   */
  smsConsent?: boolean;
  /**
   * Podpowiedź numeru, którą POKAZAŁO okno zgody (trzy ostatnie cyfry albo
   * `null`, gdy okno cyfr nie pokazało) - przegląd R67. Baza porównuje ją
   * z bieżącym numerem i przy niezgodności odmawia (`phone_changed`): zgoda
   * dotyczy numeru, który uczestnik widział. Bez pola (`undefined`) - bez
   * porównania (okno bez wczytanych preferencji).
   */
  phoneHint?: string | null;
}

export interface ChannelPrefs {
  registrationId: string;
  notifyEmail: boolean;
  notifySms: boolean;
  remindEmail: boolean;
  remindPush: boolean;
  remindSms: boolean;
  remindSessions: boolean;
  /** Chwila ostatniej zgody na SMS (ISO) albo `null`. */
  smsConsentAt: string | null;
}

/** Klucz ładunku RPC dla każdego pola wejścia - wysyłamy tylko obecne. */
const CHANNEL_KEYS: ReadonlyArray<readonly [keyof ChannelPrefsInput, string]> = [
  ["registrationId", "registration_id"],
  ["manageToken", "manage_token"],
  ["notifyEmail", "notify_email"],
  ["notifySms", "notify_sms"],
  ["remindEmail", "remind_email"],
  ["remindPush", "remind_push"],
  ["remindSms", "remind_sms"],
  ["remindSessions", "remind_sessions"],
  ["smsConsent", "sms_consent"],
  // `null` też jedzie: „okno nie pokazało cyfr" to inna podpowiedź niż brak pola.
  ["phoneHint", "phone_hint"],
];

/** Zmienia kanały i przypomnienia pojedynczego zgłoszenia. */
export async function setRegistrationChannels(input: ChannelPrefsInput): Promise<ChannelPrefs> {
  const payload: Record<string, Json> = {};
  for (const [field, key] of CHANNEL_KEYS) {
    const value = input[field];
    if (value !== undefined) payload[key] = value;
  }

  const { data, error } = await supabase.rpc("event_registration_set_channels", {
    p_payload: payload as Json,
  });
  if (error) throw error;
  const row = bag(data);
  const id = row === null ? null : text(row, "registration_id");
  if (row === null || id === null) throw new Error("invalid_response");
  return {
    registrationId: id,
    notifyEmail: bool(row, "notify_email", true),
    notifySms: bool(row, "notify_sms", false),
    // Starsza baza oddaje tylko notify_* - podprzełączniki mają wtedy swoje
    // DEFAULT-y kolumn (remind_sms false, reszta true).
    remindEmail: bool(row, "remind_email", true),
    remindPush: bool(row, "remind_push", true),
    remindSms: bool(row, "remind_sms", false),
    remindSessions: bool(row, "remind_sessions", true),
    smsConsentAt: text(row, "sms_consent_at"),
  };
}

/** Kody odmów pisarza preferencji, które ekran tłumaczy własnym zdaniem. */
export const CHANNEL_ERROR_CODES = [
  "sms_consent_required",
  "phone_required",
  "phone_changed",
  "manage_expired",
  "already_closed",
  "not_found",
  "auth_required",
  "invalid_payload",
  "invalid_tenant",
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

/** Prefiks zdań odmów pisarza w słowniku `i18n-participant-tickets`. */
const ERROR_PREFIX = "participantTickets.channels.errors.";

function camel(code: string): string {
  return code.replace(/_([a-z0-9])/g, (_all, chr: string) => chr.toUpperCase());
}

/** Głowa komunikatu `RAISE EXCEPTION` -> znany kod albo `unknown`. */
export function channelErrorCode(error: unknown): ChannelErrorCode | "unknown" {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : typeof error === "string"
          ? error
          : "";
  const head = message.split(":", 1)[0]?.trim() ?? "";
  return (CHANNEL_ERROR_CODES as readonly string[]).includes(head)
    ? (head as ChannelErrorCode)
    : "unknown";
}

/**
 * Odmowa pisarza -> klucz i18n zdania dla uczestnika. Nieznany kod NIE udaje
 * znanego: wraca `unknown` (bramka `eventErrorMapsI18n.gate.test.ts`).
 */
export function channelErrorKey(error: unknown): string {
  return `${ERROR_PREFIX}${camel(channelErrorCode(error))}`;
}

/** Preferencje jednego zgłoszenia dla karty przypomnień (`event_registration_preferences`). */
export interface RegistrationPreferencesData {
  registrationId: string;
  eventSlug: string | null;
  status: string;
  notifyEmail: boolean;
  notifySms: boolean;
  remindEmail: boolean;
  remindPush: boolean;
  remindSms: boolean;
  remindSessions: boolean;
  smsConsentAt: string | null;
  smsConsentVia: "account" | "token" | null;
  /** Zgłoszenie osoby z kontem - tylko wtedy dzwonek ma dokąd trafić. */
  hasAccount: boolean;
  hasPhone: boolean;
  /** Trzy ostatnie cyfry numeru (do zdania o zgodzie) - nigdy cały numer. */
  phoneHint: string | null;
  remindersEnabled: boolean;
  reminderSmsEnabled: boolean;
  sessionRemindersEnabled: boolean;
}

export type RegistrationPreferences =
  | ({ kind: "ok" } & RegistrationPreferencesData)
  /** Klucz nieznany, cudzy albo zgłoszenie obcego najemcy - bez wyroczni. */
  | { kind: "not_found" }
  /** Klucz wygasł z końcem wydarzenia (REG-17). */
  | { kind: "expired" }
  /** Baza sprzed migracji (PGRST202/42883) - karta mówi, że preferencje są chwilowo niedostępne. */
  | { kind: "unavailable" };

/** Odpowiedź RPC -> preferencje. Pole `phone` (gdyby kiedyś przyszło) jest ignorowane. */
export function parseRegistrationPreferences(raw: unknown): RegistrationPreferences {
  const row = bag(raw);
  if (row === null) return { kind: "not_found" };
  if (row["ok"] !== true) {
    return row["reason"] === "expired" ? { kind: "expired" } : { kind: "not_found" };
  }
  const id = text(row, "registration_id");
  if (id === null) return { kind: "not_found" };
  const via = text(row, "sms_consent_via");
  const hint = text(row, "phone_hint");
  return {
    kind: "ok",
    registrationId: id,
    eventSlug: text(row, "event_slug"),
    status: text(row, "status") ?? "pending",
    notifyEmail: bool(row, "notify_email", true),
    notifySms: bool(row, "notify_sms", false),
    remindEmail: bool(row, "remind_email", true),
    remindPush: bool(row, "remind_push", true),
    remindSms: bool(row, "remind_sms", false),
    remindSessions: bool(row, "remind_sessions", true),
    smsConsentAt: text(row, "sms_consent_at"),
    smsConsentVia: via === "account" || via === "token" ? via : null,
    hasAccount: bool(row, "has_account", false),
    hasPhone: bool(row, "has_phone", false),
    // Podpowiedź to wyłącznie cyfry, najwyżej trzy - cokolwiek innego odrzucamy.
    phoneHint: hint !== null && /^\d{1,3}$/.test(hint) ? hint : null,
    // Flaga organizatora nieobecna = funkcja WYŁĄCZONA (bezpieczna strona).
    remindersEnabled: bool(row, "reminders_enabled", false),
    reminderSmsEnabled: bool(row, "reminder_sms_enabled", false),
    sessionRemindersEnabled: bool(row, "session_reminders_enabled", false),
  };
}

/** Preferencje zgłoszenia: klucz z maila ma pierwszeństwo przed identyfikatorem. */
export async function fetchRegistrationPreferences(input: {
  registrationId?: string;
  manageToken?: string;
}): Promise<RegistrationPreferences> {
  const payload: Record<string, Json> = {};
  if (input.manageToken !== undefined) payload["manage_token"] = input.manageToken;
  else if (input.registrationId !== undefined) payload["registration_id"] = input.registrationId;

  const { data, error } = await supabase.rpc("event_registration_preferences", {
    p_payload: payload as Json,
  });
  if (error) {
    if (isMigrationPending(error)) return { kind: "unavailable" };
    throw error;
  }
  return parseRegistrationPreferences(data);
}
