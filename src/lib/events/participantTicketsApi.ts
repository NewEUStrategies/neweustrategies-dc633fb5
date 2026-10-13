// Panel uczestnika: odczyt własnych zgłoszeń i sterowanie kanałami powiadomień.
//
// DLACZEGO TO CZYTA RPC, A NIE TABELĘ. Zgłoszenie łączy trzy rzeczy z trzech
// tabel o różnych regułach dostępu: stan zapisu (`event_registrations`),
// pieniądze (`payment_orders`) i ślad zdarzeń operatora
// (`payment_webhook_events`). Złożenie tego po stronie przeglądarki wymagałoby
// otwarcia dwóch ostatnich na odczyt - a te tabele mają zostać zamknięte.
// `event_my_registrations` składa komplet po stronie bazy dla `auth.uid()`
// i nie przyjmuje ŻADNEGO identyfikatora od wołającego.
//
// KANAŁY ZMIENIA UCZESTNIK, NIE ORGANIZATOR. `event_registration_set_channels`
// przyjmuje albo identyfikator zgłoszenia zalogowanego właściciela, albo klucz
// `manage_token` z maila - ta druga droga jest jedyną dla gościa bez konta.
//
// SMS TYLKO ZA JAWNĄ ZGODĄ (REG-10, D12). `notify_sms` jest domyślnie
// wyłączony, a każde włączenie SMS-a (kanał albo przypomnienia) musi nieść
// `sms_consent: true` - baza stempluje wtedy zgodę i wymaga numeru
// (`sms_consent_required` / `phone_required`). Zmiana numeru zdejmuje zgodę.
// `notify_*` to główne przełączniki kanału, `remind_*` - podprzełączniki
// przypomnień (REG-09); oba zestawy pisze ta sama funkcja, wysyłając WYŁĄCZNIE
// zmieniony klucz.
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isMigrationPending } from "@/lib/supabase/migrationPending";

export interface TicketWebhookEntry {
  id: string;
  eventType: string;
  status: string;
  occurredAt: string | null;
  processedAt: string | null;
  retryCount: number;
}

export interface ParticipantRegistration {
  registrationId: string;
  /**
   * Wydarzenie i wejściówka - komplet, którego wymaga kasa.
   *
   * Bez nich karta pokazywała „nieopłacone" i nie dawała z tym NIC zrobić:
   * jedyną drogą do zapłaty był ekran potwierdzenia, który uczestnik dawno
   * zamknął. `null` przy starszym backendzie - przycisk się wtedy nie
   * pojawia, zamiast prowadzić do kasy bez identyfikatorów.
   */
  eventId: string | null;
  ticketTypeId: string | null;
  status: string;
  paymentStatus: string | null;
  createdAt: string | null;
  cancelledAt: string | null;
  paidAt: string | null;
  waitlistPosition: number | null;
  promotedAt: string | null;
  notifyEmail: boolean;
  notifySms: boolean;
  /**
   * Powód zamknięcia napisany DLA uczestnika (`participant_reason`, REG-06) -
   * tylko przy zgłoszeniu odrzuconym albo anulowanym. Celowo bez zapasu
   * w `cancel_reason`/`decision_note`: notatka wewnętrzna organizatora nigdy
   * nie trafia na tę kartę, także przy starszej bazie.
   */
  participantReason: string | null;
  decisionSource: string | null;
  eventSlug: string;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventTimezone: string | null;
  orderStatus: string | null;
  amountCents: number | null;
  refundedCents: number;
  currency: string | null;
  webhooks: TicketWebhookEntry[];
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

function bool(source: Bag, key: string, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

function int(source: Bag, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

function parseWebhooks(value: unknown): TicketWebhookEntry[] {
  if (!Array.isArray(value)) return [];
  const out: TicketWebhookEntry[] = [];
  for (const raw of value) {
    const row = bag(raw);
    const id = row === null ? null : text(row, "id");
    if (row === null || id === null) continue;
    out.push({
      id,
      eventType: text(row, "event_type") ?? "unknown",
      status: text(row, "status") ?? "unknown",
      occurredAt: text(row, "occurred_at"),
      processedAt: text(row, "processed_at"),
      retryCount: int(row, "retry_count") ?? 0,
    });
  }
  return out;
}

function parseRegistration(raw: unknown): ParticipantRegistration | null {
  const row = bag(raw);
  if (row === null) return null;
  const id = text(row, "registration_id");
  const slug = text(row, "event_slug");
  if (id === null || slug === null) return null;
  return {
    registrationId: id,
    eventId: text(row, "event_id"),
    ticketTypeId: text(row, "ticket_type_id"),
    status: text(row, "status") ?? "pending",
    paymentStatus: text(row, "payment_status"),
    createdAt: text(row, "created_at"),
    cancelledAt: text(row, "cancelled_at"),
    paidAt: text(row, "paid_at"),
    waitlistPosition: int(row, "waitlist_position"),
    promotedAt: text(row, "promoted_at"),
    notifyEmail: bool(row, "notify_email", true),
    // Brak pola to brak dowodu zgody - SMS nie jest domyślny (REG-10).
    notifySms: bool(row, "notify_sms", false),
    participantReason: text(row, "participant_reason"),
    decisionSource: text(row, "decision_source"),
    eventSlug: slug,
    eventTitlePl: text(row, "event_title_pl"),
    eventTitleEn: text(row, "event_title_en"),
    eventStartsAt: text(row, "event_starts_at"),
    eventEndsAt: text(row, "event_ends_at"),
    eventTimezone: text(row, "event_timezone"),
    orderStatus: text(row, "order_status"),
    amountCents: int(row, "amount_cents"),
    refundedCents: int(row, "refunded_amount_cents") ?? 0,
    currency: text(row, "currency"),
    webhooks: parseWebhooks(row["webhooks"]),
  };
}

/**
 * Sufit `limit` w `event_my_registrations`: SQL liczy
 * `LEAST(GREATEST(COALESCE(limit, 20), 1), 50)`
 * (`20260830090000_event_registration_checkout_binding.sql:792`).
 */
const MY_REGISTRATIONS_MAX = 50;

/**
 * Moje zgłoszenia - baza sama ogranicza wynik do `auth.uid()`.
 *
 * LIMIT JEDZIE ZAWSZE, I JEST NIM SUFIT. Ładunek bez `limit` znaczy dla RPC
 * „dwadzieścia", więc uczestnik z dwudziestym pierwszym zapisem po prostu nie
 * widział najstarszych zgłoszeń - i nie widział też informacji, że lista jest
 * ucięta. Wszystkie trzy powierzchnie (`ParticipantTicketsPanel`,
 * `MyEventsPanel`, `AccountMenuEventsSection`) wołają tę funkcję bez argumentów,
 * więc drugiej drogi do starszych wpisów nie ma.
 *
 * PARAMETRU TU NIE MA I NIE MA PO CO. RPC nie przyjmuje przesunięcia, a `limit`
 * ścina do 50 po stronie SQL - klient nie umie więc poprosić o stronę drugą,
 * a jedyne, co może zrobić, to poprosić o WSZYSTKO, co RPC odda. Zejście niżej
 * niż sufit byłoby wyłącznie ukrywaniem wierszy przed widokiem, który i tak
 * filtruje je u siebie.
 */
export async function fetchMyRegistrations(): Promise<ParticipantRegistration[]> {
  const { data, error } = await supabase.rpc("event_my_registrations", {
    p_payload: { limit: MY_REGISTRATIONS_MAX } as Json,
  });
  if (error) throw error;
  const root = bag(data);
  const rows = root === null ? [] : root["registrations"];
  if (!Array.isArray(rows)) return [];
  const out: ParticipantRegistration[] = [];
  for (const raw of rows) {
    const parsed = parseRegistration(raw);
    if (parsed !== null) out.push(parsed);
  }
  return out;
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
  "manage_expired",
  "already_closed",
  "not_found",
  "auth_required",
  "invalid_payload",
  "invalid_tenant",
] as const;
export type ChannelErrorCode = (typeof CHANNEL_ERROR_CODES)[number];

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

export interface SpeakerSessionEntry {
  sessionId: string;
  titlePl: string | null;
  titleEn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  role: string | null;
}

/** Mapa „kto występuje w jakim panelu": klucz to `user_id` albo `person_id`. */
export async function fetchEventSpeakerSessions(
  eventSlug: string,
): Promise<Map<string, SpeakerSessionEntry[]>> {
  const { data, error } = await supabase.rpc("event_attendee_sessions", {
    p_payload: { event_slug: eventSlug } as Json,
  });
  if (error) throw error;
  const root = bag(data);
  const rows = root === null ? [] : root["speakers"];
  const map = new Map<string, SpeakerSessionEntry[]>();
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const row = bag(raw);
    if (row === null) continue;
    const sessions: SpeakerSessionEntry[] = [];
    const list = row["sessions"];
    if (Array.isArray(list)) {
      for (const rawSession of list) {
        const s = bag(rawSession);
        const sessionId = s === null ? null : text(s, "session_id");
        if (s === null || sessionId === null) continue;
        sessions.push({
          sessionId,
          titlePl: text(s, "title_pl"),
          titleEn: text(s, "title_en"),
          startsAt: text(s, "starts_at"),
          endsAt: text(s, "ends_at"),
          role: text(s, "role"),
        });
      }
    }
    if (sessions.length === 0) continue;
    const keys: (string | null)[] = [text(row, "user_id"), text(row, "person_id")];
    // Katalog uczestników identyfikuje wiersz ZGŁOSZENIEM, nie osobą - bez tego
    // klucza karta nie miałaby czym trafić w prelegenta.
    const registrationIds = row["registration_ids"];
    if (Array.isArray(registrationIds)) {
      for (const value of registrationIds) {
        if (typeof value === "string" && value.trim() !== "") keys.push(value);
      }
    }
    for (const key of keys) {
      if (key !== null) map.set(key, sessions);
    }
  }
  return map;
}
