// Publiczne flagi funkcji uczestnika jednego wydarzenia
// (`event_participant_options(slug)`).
//
// NIEZALEŻNE OD WIDZA. RPC zwraca wyłącznie ustawienia organizatora i daty
// wydarzenia - ani słowa o tym, kto pyta. Dlatego odpowiedź wolno trzymać we
// wspólnym kluczu `["event-participant-options", slug]` dla każdego widza
// i nigdy nie niesie danych osobowych.
//
// LEKKI MODUŁ. Tę funkcję czyta menu kalendarza na PUBLICZNEJ stronie
// wydarzenia (tor A), więc z modułu ustawień panelu bierzemy wyłącznie TYP
// (`import type`) - wartości domyślne panelu nie wjeżdżają do publicznej paczki.
// Brak albo zły typ flagi = funkcja WYŁĄCZONA (bezpieczna strona), liczba
// złego typu = wartość domyślna kolumny.
import { supabase } from "@/integrations/supabase/client";
import type { RefundMode } from "@/lib/events/participantSettings";

export interface EventParticipantOptions {
  eventId: string;
  /** Strefa już bezpieczna (`_event_safe_timezone`) - nigdy pusta. */
  timezone: string;
  startsAt: string | null;
  endsAt: string | null;
  effectiveEnd: string | null;
  calendarExportEnabled: boolean;
  remindersEnabled: boolean;
  reminderEventLeadsMinutes: number[];
  sessionRemindersEnabled: boolean;
  sessionReminderLeadMinutes: number;
  reminderSmsEnabled: boolean;
  transferEnabled: boolean;
  transferDeadlineAt: string | null;
  refundMode: RefundMode;
  refundDeadlineHours: number;
  waitlistOfferHours: number;
  certificateEnabled: boolean;
  surveyEnabled: boolean;
  surveyOpensAt: string | null;
  surveyClosesAt: string | null;
}

type Bag = Record<string, unknown>;

function bag(value: unknown): Bag | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Bag)
    : null;
}

function flag(source: Bag, key: string): boolean {
  return source[key] === true;
}

function int(source: Bag, key: string, fallback: number): number {
  const value = source[key];
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function text(source: Bag, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Odpowiedź RPC -> flagi; `null` dla `{"ok":false}` (wydarzenie nieopublikowane/nieznane). */
export function parseEventParticipantOptions(raw: unknown): EventParticipantOptions | null {
  const row = bag(raw);
  if (row === null || row["ok"] !== true) return null;
  const eventId = text(row, "event_id");
  if (eventId === null) return null;
  const leads = row["reminder_event_leads_minutes"];
  return {
    eventId,
    timezone: text(row, "timezone") ?? "Europe/Warsaw",
    startsAt: text(row, "starts_at"),
    endsAt: text(row, "ends_at"),
    effectiveEnd: text(row, "effective_end"),
    calendarExportEnabled: flag(row, "calendar_export_enabled"),
    remindersEnabled: flag(row, "reminders_enabled"),
    reminderEventLeadsMinutes: Array.isArray(leads)
      ? leads.filter((lead): lead is number => typeof lead === "number" && Number.isInteger(lead))
      : [],
    sessionRemindersEnabled: flag(row, "session_reminders_enabled"),
    sessionReminderLeadMinutes: int(row, "session_reminder_lead_minutes", 15),
    reminderSmsEnabled: flag(row, "reminder_sms_enabled"),
    transferEnabled: flag(row, "transfer_enabled"),
    transferDeadlineAt: text(row, "transfer_deadline_at"),
    refundMode: row["refund_mode"] === "policy" ? "policy" : "none",
    refundDeadlineHours: int(row, "refund_deadline_hours", 168),
    waitlistOfferHours: int(row, "waitlist_offer_hours", 24),
    certificateEnabled: flag(row, "certificate_enabled"),
    surveyEnabled: flag(row, "survey_enabled"),
    surveyOpensAt: text(row, "survey_opens_at"),
    surveyClosesAt: text(row, "survey_closes_at"),
  };
}

/** Flagi opublikowanego wydarzenia; `null`, gdy wydarzenia nie ma albo nie jest publiczne. */
export async function fetchEventParticipantOptions(
  slug: string,
): Promise<EventParticipantOptions | null> {
  const { data, error } = await supabase.rpc("event_participant_options", { p_slug: slug });
  if (error) throw error;
  return parseEventParticipantOptions(data);
}
