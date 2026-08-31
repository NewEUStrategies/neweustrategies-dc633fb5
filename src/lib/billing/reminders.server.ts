// Etap 5 - automatyczne przypomnienia mailowe cyklu życia subskrypcji.
//
// Dwa okna czasowe liczone od "teraz":
//   - odnowienie   : subskrypcja aktywna, `current_period_end` za ~N dni,
//   - wygaśnięcie  : subskrypcja anulowana (lub `cancel_at_period_end`),
//                    dostęp kończy się za ~N dni.
//
// Idempotencja jest po stronie wysyłki (`sendTxEmail` + `idempotencyKey`
// zawierający datę graniczną), więc cron może chodzić dowolnie często i
// podwójne wywołania nie wygenerują drugiego maila.
//
// Moduł server-only - importuj wyłącznie z handlera crona.
import { notifyReminderEmail } from "@/lib/billing/notifications.server";
import { resolvePlanForPrice } from "@/lib/billing/purchaseEffects.server";

/** Domyślne wyprzedzenie przypomnienia (w dniach). */
export const REMINDER_LEAD_DAYS = 3;

/**
 * Wynik przebiegu. `renewal` i `expiring` liczą WYSŁANE wiadomości (dostawca
 * poczty przyjął je do kolejki), `skipped` - rekordy, dla których wysyłki nie
 * było: brak daty granicznej, brak adresu, odmowa dostawcy, błąd katalogu
 * planów. Ten podział jest jedynym sygnałem zwrotnym dla człowieka (toast w
 * panelu, log crona), więc nie wolno w nim zliczać prób jako sukcesów.
 */
export interface ReminderRunResult {
  readonly renewal: number;
  readonly expiring: number;
  readonly skipped: number;
}

interface SubRow {
  user_id: string;
  price_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_subscription_id: string;
}

/** Okno [start, end) w którym końcówka okresu wypada dokładnie za `leadDays`. */
export function reminderWindow(now: Date, leadDays: number): { from: string; to: string } {
  const from = new Date(now.getTime() + leadDays * 86_400_000);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Klucz idempotencji - jeden mail na subskrypcję i datę graniczną. */
export function reminderSeed(subscriptionId: string, periodEnd: string): string {
  return `${subscriptionId}:${periodEnd.slice(0, 10)}`;
}

async function loadDueSubscriptions(from: string, to: string, limit: number): Promise<SubRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select(
      "user_id, price_id, status, current_period_end, cancel_at_period_end, provider_subscription_id",
    )
    .in("status", ["active", "trialing", "past_due", "canceled"])
    .gte("current_period_end", from)
    .lt("current_period_end", to)
    .limit(limit);
  if (error) throw new Error(`reminder lookup failed: ${error.message}`);
  return (data as SubRow[] | null) ?? [];
}

/**
 * Wysyła przypomnienia dla subskrypcji kończących okres za `leadDays` dni.
 * Fail-soft per rekord: błąd jednego odbiorcy nie przerywa całego przebiegu.
 */
export async function runBillingReminders(
  leadDays: number = REMINDER_LEAD_DAYS,
  limit = 200,
  now: Date = new Date(),
): Promise<ReminderRunResult> {
  const { from, to } = reminderWindow(now, leadDays);
  const rows = await loadDueSubscriptions(from, to, limit);

  let renewal = 0;
  let expiring = 0;
  let skipped = 0;

  for (const row of rows) {
    const periodEnd = row.current_period_end;
    if (!periodEnd) {
      skipped += 1;
      continue;
    }
    const ending = row.status === "canceled" || row.cancel_at_period_end === true;
    try {
      const plan = await resolvePlanForPrice(row.price_id);
      // Liczymy WIADOMOŚCI, KTÓRE POSZŁY, a nie wywołania wysyłki. Wcześniej
      // licznik rósł zaraz po wywołaniu fail-soft `notifyReminderEmail`, więc
      // przy padniętej poczcie przebieg raportował dziesiątki przypomnień,
      // których nikt nie dostał - a `skipped`, jedyny sygnał do ponowienia,
      // nie ruszał się z zera. Zielony toast w panelu kłamał o wysyłce.
      const sent = await notifyReminderEmail({
        kind: ending ? "subscription_expiring" : "subscription_renewal_reminder",
        userId: row.user_id,
        planId: plan?.planId ?? null,
        periodEnd,
        idempotencySeed: reminderSeed(row.provider_subscription_id, periodEnd),
      });
      if (!sent) {
        skipped += 1;
        console.error("[billing-reminders] not sent", row.provider_subscription_id);
        continue;
      }
      if (ending) expiring += 1;
      else renewal += 1;
    } catch (err) {
      skipped += 1;
      console.error("[billing-reminders] failed", row.provider_subscription_id, err);
    }
  }

  return { renewal, expiring, skipped };
}
