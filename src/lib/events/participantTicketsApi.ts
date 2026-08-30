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
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

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
  cancelReason: string | null;
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
    notifySms: bool(row, "notify_sms", true),
    cancelReason: text(row, "cancel_reason"),
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

/** Moje zgłoszenia - baza sama ogranicza wynik do `auth.uid()`. */
export async function fetchMyRegistrations(): Promise<ParticipantRegistration[]> {
  const { data, error } = await supabase.rpc("event_my_registrations", { p_payload: {} as Json });
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
}

export interface ChannelPrefs {
  registrationId: string;
  notifyEmail: boolean;
  notifySms: boolean;
}

/** Zmienia kanały powiadomień pojedynczego zgłoszenia. */
export async function setRegistrationChannels(input: ChannelPrefsInput): Promise<ChannelPrefs> {
  const payload: Record<string, Json> = {};
  if (input.registrationId !== undefined) payload["registration_id"] = input.registrationId;
  if (input.manageToken !== undefined) payload["manage_token"] = input.manageToken;
  if (input.notifyEmail !== undefined) payload["notify_email"] = input.notifyEmail;
  if (input.notifySms !== undefined) payload["notify_sms"] = input.notifySms;

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
    notifySms: bool(row, "notify_sms", true),
  };
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
