// Treść przypomnień uczestnika (zadanie F2): wiersz partii
// `_event_reminders_claim` -> mail `event_reminder` / `event_session_reminder`
// albo SMS o wydarzeniu.
//
// KONTRAKT WIERSZY SZCZEGÓŁÓW (`PARTICIPANT_TX_DETAIL_LABELS`, spec B.8): mail
// o wydarzeniu pokazuje dokładnie `event`, `date`, `place`; mail o sesji -
// `event`, `session`, `date`, `room` (sala jest jedynym wierszem opcjonalnym).
// Treść maila jest statyczna, więc wszystko, co odbiorca ma zobaczyć „o sobie",
// jedzie w tych wierszach i w temacie.
//
// DATA W STREFIE WYDARZENIA Z PODPISEM STREFY: uczestnik z innej strefy musi
// wiedzieć, w jakiej strefie podana jest godzina.
//
// MODUŁ CZYSTY: zero klienta bazy i zero wysyłki - całość testowalna bez
// atrap. Wysyła `jobs/reminderJob.server.ts`.
import type { EmailLang } from "@/lib/email-templates/nes-layout";
import type { TxDetail } from "@/lib/email-templates/transactional";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { eventAddressLine } from "@/lib/events/eventAddress";
import { composeSmsBody, formatSmsMoment } from "@/lib/events/gsm7";
import type { DeliveryOutcome } from "@/lib/events/participantDelivery.server";
import { formatEventMoment } from "@/lib/events/registrationNotify.server";
import { eventTimeZoneLabel } from "@/lib/events/timezone";

export type ReminderKind = "event_reminder" | "session_reminder";
/** Kanały, które rezerwuje `_event_reminders_claim` (dzwonki wysyła baza). */
export type ReminderChannel = "email" | "sms";

/** Jedna zarezerwowana wysyłka z `_event_reminders_claim`. */
export interface ReminderClaim {
  deliveryId: string;
  kind: ReminderKind;
  channel: ReminderChannel;
  dedupeKey: string;
  tenantId: string;
  eventId: string;
  registrationId: string | null;
  sessionId: string | null;
  startsAt: string;
  lang: EmailLang;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  eventSlug: string;
  eventTitlePl: string | null;
  eventTitleEn: string | null;
  eventTimezone: string;
  eventLocation: string | null;
  eventFormat: string | null;
  eventStreetAddress: string | null;
  eventPostalCode: string | null;
  eventCity: string | null;
  eventCountry: string | null;
  sessionTitlePl: string | null;
  sessionTitleEn: string | null;
  roomName: string | null;
}

/** Wynik jednej wysyłki - element `_event_delivery_confirm_many`. */
export interface ReminderOutcome {
  id: string;
  status: DeliveryOutcome;
  /** Powód lub kod błędu, NIGDY dane osobowe (CHECK długości 500). */
  detail?: string;
}

export interface ParsedReminderClaims {
  claims: ReminderClaim[];
  /**
   * Zarezerwowane wiersze, których nie da się wysłać (uszkodzony kształt).
   * Wołający MUSI je zamknąć - inaczej czekałyby 15 minut na ponowne przejęcie
   * i wracały do partii bez końca.
   */
  invalidIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function uuid(value: unknown): string | null {
  const v = text(value);
  return v !== null && UUID.test(v) ? v : null;
}

function parseOne(row: Record<string, unknown>): ReminderClaim | null {
  const deliveryId = uuid(row.delivery_id);
  const tenantId = uuid(row.tenant_id);
  const eventId = uuid(row.event_id);
  const dedupeKey = text(row.dedupe_key);
  const startsAt = text(row.starts_at);
  const eventSlug = text(row.event_slug);
  const kind = row.kind;
  const channel = row.channel;
  if (
    deliveryId === null ||
    tenantId === null ||
    eventId === null ||
    dedupeKey === null ||
    startsAt === null ||
    Number.isNaN(new Date(startsAt).getTime()) ||
    eventSlug === null ||
    (kind !== "event_reminder" && kind !== "session_reminder") ||
    (channel !== "email" && channel !== "sms")
  ) {
    return null;
  }
  const sessionId = uuid(row.session_id);
  // Sesja bez identyfikatora nie ma dokąd prowadzić przyciskiem.
  if (kind === "session_reminder" && sessionId === null) return null;
  return {
    deliveryId,
    kind,
    channel,
    dedupeKey,
    tenantId,
    eventId,
    registrationId: uuid(row.registration_id),
    sessionId,
    startsAt,
    lang: row.lang === "en" ? "en" : "pl",
    email: text(row.email),
    phone: text(row.phone),
    firstName: text(row.first_name),
    eventSlug,
    eventTitlePl: text(row.event_title_pl),
    eventTitleEn: text(row.event_title_en),
    eventTimezone: text(row.event_timezone) ?? "Europe/Warsaw",
    eventLocation: text(row.event_location),
    eventFormat: text(row.event_format),
    eventStreetAddress: text(row.event_street_address),
    eventPostalCode: text(row.event_postal_code),
    eventCity: text(row.event_city),
    eventCountry: text(row.event_country),
    sessionTitlePl: text(row.session_title_pl),
    sessionTitleEn: text(row.session_title_en),
    roomName: text(row.room_name),
  };
}

/** Odpowiedź RPC (tablica jsonb) -> wysyłki + identyfikatory wierszy do zamknięcia. */
export function parseReminderClaims(data: unknown): ParsedReminderClaims {
  const claims: ReminderClaim[] = [];
  const invalidIds: string[] = [];
  if (!Array.isArray(data)) return { claims, invalidIds };
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const claim = parseOne(row);
    if (claim !== null) {
      claims.push(claim);
      continue;
    }
    const id = uuid(row.delivery_id);
    if (id !== null) invalidIds.push(id);
  }
  return { claims, invalidIds };
}

function pick(lang: EmailLang, pl: string | null, en: string | null): string {
  return (lang === "en" ? (en ?? pl) : (pl ?? en)) ?? "";
}

function eventTitle(claim: ReminderClaim): string {
  return pick(claim.lang, claim.eventTitlePl, claim.eventTitleEn);
}

function sessionTitle(claim: ReminderClaim): string {
  return pick(claim.lang, claim.sessionTitlePl, claim.sessionTitleEn);
}

/** Termin w strefie wydarzenia z krótką nazwą strefy („10 października 2026 18:00 (CEST)"). */
export function reminderMoment(startsAt: string, timezone: string, lang: EmailLang): string {
  const when = formatEventMoment(startsAt, timezone, lang);
  if (when === "") return "";
  const zone = eventTimeZoneLabel(startsAt, timezone, lang);
  return zone === "" ? when : `${when} (${zone})`;
}

/**
 * Wiersz „Miejsce": lokalizacja i adres strukturalny (bez powtórzeń), a gdy
 * wydarzenie nie ma ani jednego - „Online" (kontrakt B.8: wiersz jest zawsze).
 */
export function reminderPlace(claim: ReminderClaim): string {
  const address = eventAddressLine({
    streetAddress: claim.eventStreetAddress,
    postalCode: claim.eventPostalCode,
    city: claim.eventCity,
    country: claim.eventCountry,
  });
  const location = claim.eventLocation ?? "";
  if (location === "") return address === "" ? "Online" : address;
  if (address === "" || location.includes(address)) return location;
  if (address.includes(location)) return address;
  return `${location}, ${address}`;
}

/** Ścieżka przycisku (kontrakt B.8) - bez prefiksu języka i domeny najemcy. */
export function reminderCtaPath(claim: ReminderClaim): string {
  const slug = encodeURIComponent(claim.eventSlug);
  if (claim.kind === "session_reminder" && claim.sessionId !== null) {
    return `/events/${slug}/me?tab=schedule#event-session-${claim.sessionId}`;
  }
  return `/events/${slug}`;
}

export interface ReminderEmail {
  type: "event_reminder" | "event_session_reminder";
  to: string;
  lang: EmailLang;
  subjectName: string;
  details: TxDetail[];
  ctaPath: string;
  metaName: string | null;
  tenantId: string;
  idempotencyKey: string;
}

/** Klucz idempotencji poczty i SMS-a = klucz deduplikacji dziennika. */
export function reminderIdempotencyKey(claim: ReminderClaim): string {
  return `event-reminder:${claim.dedupeKey}`;
}

/** Wiersz e-mail -> wejście `sendTxEmail` albo `null`, gdy nie ma adresu. */
export function buildReminderEmail(claim: ReminderClaim): ReminderEmail | null {
  if (claim.channel !== "email" || claim.email === null) return null;
  const isSession = claim.kind === "session_reminder";
  const type = isSession ? "event_session_reminder" : "event_reminder";
  const labels = txCopy(type, claim.lang).labels;
  const event = eventTitle(claim);
  const when = reminderMoment(claim.startsAt, claim.eventTimezone, claim.lang);

  const details: TxDetail[] = [];
  if (event !== "") details.push({ label: labels.event, value: event });
  if (isSession) {
    const session = sessionTitle(claim);
    if (session !== "") details.push({ label: labels.session, value: session });
    if (when !== "") details.push({ label: labels.date, value: when });
    if (claim.roomName !== null) details.push({ label: labels.room, value: claim.roomName });
  } else {
    if (when !== "") details.push({ label: labels.date, value: when });
    details.push({ label: labels.place, value: reminderPlace(claim) });
  }

  return {
    type,
    to: claim.email,
    lang: claim.lang,
    // Temat niesie to, o czym jest przypomnienie: sesję albo wydarzenie.
    subjectName: isSession ? sessionTitle(claim) || event : event,
    details,
    ctaPath: reminderCtaPath(claim),
    metaName: claim.firstName,
    tenantId: claim.tenantId,
    idempotencyKey: reminderIdempotencyKey(claim),
  };
}

/**
 * Treść SMS-a (jeden segment GSM-7): termin liczbami w strefie wydarzenia,
 * tytuł przycięty do budżetu. `null`, gdy wiersz nie jest SMS-em o wydarzeniu
 * albo nie ma czytelnego terminu.
 */
export function buildReminderSms(claim: ReminderClaim): string | null {
  if (claim.channel !== "sms" || claim.kind !== "event_reminder") return null;
  const moment = formatSmsMoment(claim.startsAt, claim.eventTimezone);
  if (moment === "") return null;
  const zone = eventTimeZoneLabel(claim.startsAt, claim.eventTimezone, claim.lang);
  const at = zone === "" ? moment : `${moment} ${zone}`;
  const template =
    claim.lang === "en"
      ? (title: string) => `NES reminder: ${title} starts ${at}. Details in your e-mail.`
      : (title: string) => `NES przypomina: ${title} - start ${at}. Szczegoly w e-mailu.`;
  return composeSmsBody(template, eventTitle(claim));
}
