// Kanały uczestnika poza e-mailem: dzwonek (rodzaj `event`) i SMS.
//
// DZWONEK PRZEZ `enqueue_notification`, NIGDY SUROWYM INSERT-EM. Funkcja
// bazowa rozstrzyga najemcę odbiorcy (z `profiles`), preferencję
// `enabled_event`, pięciominutową deduplikację i wysyłkę push. Surowy INSERT
// do `notifications` omijał wszystkie cztery naraz (defekt D0-3).
// Ikona wyłącznie z wyselekcjonowanej listy (`CURATED_ICON_NAMES`) - nazwa
// spoza niej ładuje w przeglądarce leniwy rejestr 109 KB.
//
// SMS: TRZY BRAMKI PRZED OPERATOREM (R-6, S11).
//   1. wyłącznik platformy - `SMSAPI_TOKEN` ORAZ `EVENT_SMS_ENABLED === "1"`
//      (polityka prywatności musi najpierw wymienić operatora SMS);
//   2. treść w GSM-7 i najwyżej 160 septetów (jeden segment) - treść budują
//      `composeSmsBody` + `formatSmsMoment`, tu tylko sprawdzamy;
//   3. budżet najemcy 300 SMS na dobę, FAIL-CLOSED: awaria licznika NIE
//      zdejmuje limitu z kanału, który kosztuje pieniądze.
// Dopiero potem `sendSms` (klucz idempotencji chroni przed powtórką tego
// samego przypomnienia z dwóch harmonogramów).
import { gsm7Septets, isGsm7 } from "@/lib/events/gsm7";
import type { SmsResult } from "@/lib/notify/sms.server";

/** Ikony dzwonka dopuszczone w powiadomieniach uczestnika (podzbiór listy kuratorskiej). */
export const PARTICIPANT_BELL_ICONS = [
  "calendar-clock",
  "credit-card",
  "award",
  "bookmark",
  "clipboard-list",
] as const;
export type ParticipantBellIcon = (typeof PARTICIPANT_BELL_ICONS)[number];

export interface EventBellInput {
  userId: string;
  titlePl: string;
  titleEn: string;
  bodyPl?: string;
  bodyEn?: string;
  /** Unikalny per temat (np. `/profile/tickets#offer-<id>`) - dedup bazy liczy się po href. */
  href: string;
  icon?: ParticipantBellIcon;
}

/** Dzwonek rodzaju `event`; identyfikator powiadomienia albo `null` (wyciszone/duplikat/błąd). */
export async function enqueueEventBell(input: EventBellInput): Promise<string | null> {
  const args: {
    p_user_id: string;
    p_kind: string;
    p_title_pl: string;
    p_title_en: string;
    p_body_pl?: string;
    p_body_en?: string;
    p_href: string;
    p_icon: string;
  } = {
    p_user_id: input.userId,
    p_kind: "event",
    p_title_pl: input.titlePl,
    p_title_en: input.titleEn,
    p_href: input.href,
    p_icon: input.icon ?? "calendar-clock",
  };
  if (input.bodyPl !== undefined) args.p_body_pl = input.bodyPl;
  if (input.bodyEn !== undefined) args.p_body_en = input.bodyEn;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("enqueue_notification", args);
    if (error) {
      console.warn("[participantNotify] bell failed", { error: error.message });
      return null;
    }
    return typeof data === "string" && data !== "" ? data : null;
  } catch (err) {
    console.warn("[participantNotify] bell threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Wyłącznik platformy dla SMS-ów uczestnika (token operatora ORAZ jawna zgoda środowiska). */
export function participantSmsEnabled(): boolean {
  return Boolean(process.env.SMSAPI_TOKEN) && process.env.EVENT_SMS_ENABLED === "1";
}

export interface ParticipantSmsInput {
  tenantId: string;
  to: string;
  body: string;
  idempotencyKey: string;
}

export type ParticipantSmsSkip = { ok: false; skipped: "disabled" | "budget" | "not_gsm7" };

/** Dobowy budżet SMS jednego najemcy (S11). */
export const PARTICIPANT_SMS_DAILY_BUDGET = 300;

/** Jeden segment GSM-7. */
const SMS_MAX_SEPTETS = 160;

export async function sendParticipantSms(
  input: ParticipantSmsInput,
): Promise<SmsResult | ParticipantSmsSkip> {
  if (!participantSmsEnabled()) return { ok: false, skipped: "disabled" };
  if (!isGsm7(input.body) || gsm7Septets(input.body) > SMS_MAX_SEPTETS) {
    return { ok: false, skipped: "not_gsm7" };
  }
  const { rateLimit } = await import("@/lib/server/rate-limit.server");
  const allowed = await rateLimit({
    scope: "event.sms.tenant",
    subjectId: input.tenantId,
    max: PARTICIPANT_SMS_DAILY_BUDGET,
    windowMinutes: 1440,
    failClosed: true,
  });
  if (!allowed) return { ok: false, skipped: "budget" };
  const { sendSms } = await import("@/lib/notify/sms.server");
  return sendSms({ to: input.to, body: input.body, idempotencyKey: input.idempotencyKey });
}
