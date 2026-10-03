// Zadanie w tle: przypomnienia o wydarzeniu i sesjach (F2) - e-mail i SMS.
//
// PODZIAŁ KANAŁÓW. Co jest należne, rozstrzyga JEDEN skaner w bazie
// (`_event_reminder_candidates`): ustawienia organizatora (włącznik, terminy,
// sesje, SMS), preferencje zgłoszenia (`remind_*`), bilet i opłata, cisza
// nocna, dziennik doręczeń. Dzwonki (rodzaj `event`, z push) wysyła sama baza
// w `run_event_reminders()` - ta sama funkcja, którą woła tick, cron
// społeczności i pg_cron. To zadanie wysyła resztę: e-mail i, gdy platforma
// ma operatora (`participantSmsEnabled`), SMS.
//
// PORCJE ZAMIAST RPC NA DORĘCZENIE. Jedna porcja to dwa wywołania bazy:
// `_event_reminders_claim` (rezerwacja + dane do wysyłki) i
// `_event_delivery_confirm_many` (zamknięcie). Termin sprawdzamy PRZED każdą
// porcją, a porcja jest mała - nie zostawiamy zarezerwowanych wierszy bez
// wysyłki. Gdy zamknięcie się nie uda, wpisy wrócą po 15 minutach, a klucz
// idempotencji poczty i SMS-a (= klucz deduplikacji) nie wyśle ich drugi raz.
//
// IMPORTY STATYCZNE: harmonogram ładuje ten moduł leniwie (`import()` w ticku
// i w cronie społeczności), więc wysyłka nie płaci za `import()` na każde
// doręczenie.
//
// Sygnatura zamrożona (kontrakt C.0.2): `(admin, opts) => Promise<ParticipantJobResult>`.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/integrations/supabase/types";
import { mapWithConcurrency } from "@/lib/async/pool";
import { sendTxEmail } from "@/lib/email/transactional.server";
import {
  EMPTY_JOB_RESULT,
  type ParticipantJobOptions,
  type ParticipantJobResult,
} from "@/lib/events/jobs/types";
import { participantSmsEnabled, sendParticipantSms } from "@/lib/events/participantNotify.server";
import {
  buildReminderEmail,
  buildReminderSms,
  parseReminderClaims,
  reminderIdempotencyKey,
  type ReminderClaim,
  type ReminderOutcome,
} from "@/lib/events/reminderNotice.server";
import { tenantPublicUrl } from "@/lib/events/tenantPublicOrigin.server";
import { normalizePhone } from "@/lib/notify/sms.server";

/** Wierszy w jednej porcji (RPC rezerwacji przyjmuje najwyżej 100). */
export const REMINDER_CLAIM_CHUNK = 20;
/** Sufit jednego przebiegu, gdy wołający nie poda mniejszego. */
export const REMINDER_RUN_LIMIT = 200;
/** Równoległych wysyłek (każda to kilka zapytań i render maila). */
export const REMINDER_SEND_CONCURRENCY = 4;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function deliverEmail(claim: ReminderClaim): Promise<ReminderOutcome> {
  const email = buildReminderEmail(claim);
  if (email === null) return { id: claim.deliveryId, status: "skipped", detail: "no_recipient" };
  // Domena najemcy, nie stała SITE_URL: uczestnik najemcy B nie może trafić
  // przyciskiem na stronę najemcy A.
  const ctaUrl = await tenantPublicUrl(claim.tenantId, email.ctaPath, email.lang);
  const result = await sendTxEmail({
    type: email.type,
    to: email.to,
    lang: email.lang,
    subjectName: email.subjectName,
    details: email.details,
    ctaUrl,
    metaName: email.metaName,
    tenantId: email.tenantId,
    idempotencyKey: email.idempotencyKey,
  });
  // Pominięcie sprawdzamy PRZED `ok`: blokada listy wykluczeń wraca jako
  // `{ ok: false, skipped }`, a nie jako błąd do ponowienia.
  if (result.skipped === "suppressed" || result.skipped === "no_recipient") {
    return { id: claim.deliveryId, status: "skipped", detail: result.skipped };
  }
  if (result.ok) {
    return result.skipped === "duplicate"
      ? { id: claim.deliveryId, status: "sent", detail: "duplicate" }
      : { id: claim.deliveryId, status: "sent" };
  }
  return { id: claim.deliveryId, status: "failed", detail: "email_send_failed" };
}

async function deliverSms(claim: ReminderClaim): Promise<ReminderOutcome> {
  const body = buildReminderSms(claim);
  if (body === null) return { id: claim.deliveryId, status: "skipped", detail: "no_body" };
  const to = normalizePhone(claim.phone);
  if (to === null) return { id: claim.deliveryId, status: "skipped", detail: "invalid_phone" };
  const result = await sendParticipantSms({
    tenantId: claim.tenantId,
    to,
    body,
    idempotencyKey: reminderIdempotencyKey(claim),
  });
  if ("skipped" in result && result.skipped !== undefined) {
    // `duplicate` = ten sam SMS wyszedł już z innego harmonogramu.
    if (result.skipped === "duplicate") {
      return { id: claim.deliveryId, status: "sent", detail: "duplicate" };
    }
    return { id: claim.deliveryId, status: "skipped", detail: result.skipped };
  }
  if (result.ok) return { id: claim.deliveryId, status: "sent" };
  return { id: claim.deliveryId, status: "failed", detail: "sms_send_failed" };
}

/** Jedna wysyłka. Nigdy nie rzuca - wyjątek to `failed` (ponowienie, proby < 3). */
export async function deliverReminder(claim: ReminderClaim): Promise<ReminderOutcome> {
  try {
    return claim.channel === "sms" ? await deliverSms(claim) : await deliverEmail(claim);
  } catch (err) {
    // W logu rodzaj i kanał, bez adresu, numeru i klucza deduplikacji.
    console.error("[eventReminders] delivery threw", {
      kind: claim.kind,
      channel: claim.channel,
      error: messageOf(err),
    });
    return { id: claim.deliveryId, status: "failed", detail: "exception" };
  }
}

async function confirmBatch(
  admin: SupabaseClient<Database>,
  outcomes: readonly ReminderOutcome[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const items: Json = outcomes.map((o) =>
    o.detail === undefined
      ? { id: o.id, status: o.status }
      : { id: o.id, status: o.status, detail: o.detail },
  );
  try {
    const { error } = await admin.rpc("_event_delivery_confirm_many", { p_items: items });
    if (error) console.warn("[eventReminders] confirm failed", { error: error.message });
  } catch (err) {
    console.warn("[eventReminders] confirm threw", { error: messageOf(err) });
  }
}

export async function runEventParticipantReminders(
  admin: SupabaseClient<Database>,
  opts: ParticipantJobOptions,
): Promise<ParticipantJobResult> {
  const requested =
    typeof opts.limit === "number" && Number.isFinite(opts.limit)
      ? Math.trunc(opts.limit)
      : REMINDER_RUN_LIMIT;
  const cap = Math.max(1, Math.min(requested, REMINDER_RUN_LIMIT));
  const sms = participantSmsEnabled();
  const result: ParticipantJobResult = { ...EMPTY_JOB_RESULT, note: "reminders" };

  while (result.claimed < cap) {
    if (Date.now() >= opts.deadlineAt) {
      result.note = "deadline";
      break;
    }
    const want = Math.min(REMINDER_CLAIM_CHUNK, cap - result.claimed);
    const { data, error } = await admin.rpc("_event_reminders_claim", {
      p_limit: want,
      p_sms: sms,
    });
    // Awaria rezerwacji niczego nie zarezerwowała - harmonogram zapisze błąd,
    // a kolejny tick spróbuje od nowa.
    if (error) throw new Error(error.message);

    const { claims, invalidIds } = parseReminderClaims(data);
    const batch = claims.length + invalidIds.length;
    if (batch === 0) break;
    result.claimed += batch;

    const outcomes = await mapWithConcurrency(claims, REMINDER_SEND_CONCURRENCY, deliverReminder);
    for (const id of invalidIds) outcomes.push({ id, status: "skipped", detail: "invalid_row" });
    for (const outcome of outcomes) {
      if (outcome.status === "sent") result.sent += 1;
      else if (outcome.status === "skipped") result.skipped += 1;
      else result.failed += 1;
    }
    await confirmBatch(admin, outcomes);

    // Krótsza porcja = skaner nie ma już nic należnego.
    if (batch < want) break;
  }
  if (result.claimed >= cap && result.note === "reminders") result.note = "limit";
  return result;
}
