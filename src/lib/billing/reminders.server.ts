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
// PRZEBIEG JEST OPERACJĄ PLATFORMY. Obejmuje subskrypcje WSZYSTKICH najemców
// (każdy mail niesie najemcę SWOJEJ subskrypcji - host linku, redakcja treści,
// lista wykluczeń), ale tylko JEDNEGO środowiska operatora, rozstrzyganego po
// stronie serwera (`resolveEnvironment`). Do 12.10.2026 zapytanie nie miało
// filtra środowiska (klienci testowi z piaskownicy dostawali przypomnienia
// razem z produkcyjnymi), brało `limit 200` bez `ORDER BY` (przy większej
// liczbie rekordów w oknie część klientów nie dostawała przypomnienia wcale,
// i to za każdym razem innych) i dawało ręczne uruchomienie każdemu adminowi
// najemcy - z dowolnym wyprzedzeniem, które ZUŻYWAŁO klucz idempotencji
// właściwego przypomnienia (3 dni przed odnowieniem mail już nie wychodził).
//
// Moduł server-only - importuj wyłącznie z handlera crona i z funkcji panelu
// operatora platformy.
import { accessPeriodFromEvent, effectiveCancellationReason } from "@/lib/billing/accessPeriod";
import { notifyReminderEmail } from "@/lib/billing/notifications.server";
import { resolvePlanForPrice } from "@/lib/billing/purchaseEffects.server";
import { environmentGrantsAccess, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";

/** Domyślne wyprzedzenie przypomnienia (w dniach). */
export const REMINDER_LEAD_DAYS = 3;

/**
 * Rozmiar PARTII odczytu, nie limit przebiegu: przebieg czyta wszystkie
 * rekordy z okna, partia po partii, kursorem po `id`.
 */
export const REMINDER_BATCH_SIZE = 200;

/**
 * Bezpiecznik pętli partii. Kursor rośnie ściśle monotonicznie, więc w
 * zdrowej bazie pętla kończy się sama; ten sufit (1 000 x 200 = 200 000
 * rekordów w JEDNEJ dobie) chroni wyłącznie przed defektem, w którym kursor
 * przestałby się przesuwać.
 */
const MAX_BATCHES = 1_000;

/**
 * Wynik przebiegu. `renewal` i `expiring` liczą WYSŁANE wiadomości (dostawca
 * poczty przyjął je do kolejki), `skipped` - rekordy, dla których wysyłki nie
 * było: brak daty granicznej, brak adresu, odmowa dostawcy, błąd katalogu
 * planów. Ten podział jest jedynym sygnałem zwrotnym dla człowieka (toast w
 * panelu, log crona), więc nie wolno w nim zliczać prób jako sukcesów.
 * Subskrypcja, której dostęp kończy się PRZED oknem (karencja płatności) albo
 * której nigdy nie było (anulowana bez zapłaty), nie jest należna i nie trafia
 * do żadnego licznika - to nie awaria.
 */
export interface ReminderRunResult {
  readonly renewal: number;
  readonly expiring: number;
  readonly skipped: number;
}

interface SubRow {
  id: string;
  user_id: string;
  tenant_id: string;
  price_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_subscription_id: string;
  current_period_start: string | null;
  first_payment_failed_at: string | null;
  last_payment_at: string | null;
  purchase_confirmed_at: string | null;
}

/** Okno [start, end) w którym końcówka okresu wypada dokładnie za `leadDays`. */
export function reminderWindow(now: Date, leadDays: number): { from: string; to: string } {
  const from = new Date(now.getTime() + leadDays * 86_400_000);
  const to = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/**
 * Klucz idempotencji - jeden mail na subskrypcję, datę graniczną i OKNO.
 *
 * Standardowe okno (`REMINDER_LEAD_DAYS`) zachowuje dotychczasowy kształt
 * klucza - zmiana kształtu wysłałaby w dniu wdrożenia drugie przypomnienie
 * każdemu, kto pierwsze już dostał. Każde INNE wyprzedzenie dostaje własną
 * przestrzeń (`:lead<N>`): ręczne uruchomienie z `leadDays = 30` nie zjada
 * już klucza przypomnienia wysyłanego 3 dni przed odnowieniem.
 */
export function reminderSeed(
  subscriptionId: string,
  periodEnd: string,
  leadDays: number = REMINDER_LEAD_DAYS,
): string {
  const base = `${subscriptionId}:${periodEnd.slice(0, 10)}`;
  return leadDays === REMINDER_LEAD_DAYS ? base : `${base}:lead${leadDays}`;
}

interface DueQuery {
  from: string;
  to: string;
  environment: StripeEnv;
  /** Ostatnie `id` poprzedniej partii (kursor keyset); `null` = pierwsza partia. */
  after: string | null;
  limit: number;
}

/**
 * Jedna partia subskrypcji z okna. `ORDER BY id` + `id > kursor` daje
 * deterministyczny podział na partie: żaden rekord nie wypada między nimi
 * i żaden nie jest czytany dwa razy, nawet gdy w trakcie przebiegu webhook
 * dopisze lub zmieni wiersz.
 */
async function loadDueSubscriptions(query: DueQuery): Promise<SubRow[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let builder = supabaseAdmin
    .from("subscriptions")
    .select(
      "id, user_id, tenant_id, price_id, status, current_period_end, cancel_at_period_end, provider_subscription_id, current_period_start, first_payment_failed_at, last_payment_at, purchase_confirmed_at",
    )
    .eq("environment", query.environment)
    .in("status", ["active", "trialing", "past_due", "canceled"])
    .gte("current_period_end", query.from)
    .lt("current_period_end", query.to);
  if (query.after) builder = builder.gt("id", query.after);
  const { data, error } = await builder.order("id", { ascending: true }).limit(query.limit);
  if (error) throw new Error(`reminder lookup failed: ${error.message}`);
  return (data as SubRow[] | null) ?? [];
}

/**
 * Czy dostęp kończącej się subskrypcji trwa do końca okresu - ta sama reguła
 * co webhook (`accessPeriodFromEvent`, SUB-03). Anulowanie za brak płatności
 * zostawia w wierszu koniec NIEOPŁACONEGO okresu operatora (powód anulowania
 * nie jest zapisywany, więc wyprowadzamy go z kotwicy karencji i ostatniej
 * zapłaty - `effectiveCancellationReason`), a wypowiedzenie w trakcie
 * windykacji kończy karencja. Mail „dostęp zakończy się <koniec okresu>, wznów
 * subskrypcję" byłby wtedy nieprawdą o dostępie, który już zgasł.
 *
 * Anulowana subskrypcja NIGDY NIEOPŁACONA (porzucone 3DS, nieudana pierwsza
 * płatność: ani potwierdzenia zakupu, ani zaksięgowanej zapłaty) nie miała
 * dostępu wcale - ta sama reguła co `cancellationAccess` w webhooku dla wiersza
 * już `canceled`. Jej okres liczony od checkoutu (przy planie rocznym rok
 * naprzód) nie jest końcem żadnego dostępu.
 */
function accessLastsUntilPeriodEnd(row: SubRow, periodEnd: string, now: Date): boolean {
  const canceled = row.status === "canceled";
  if (canceled && !row.purchase_confirmed_at && !row.last_payment_at) return false;
  const { accessUntil } = accessPeriodFromEvent({
    kind: canceled ? "canceled" : "updated",
    storedPeriodEnd: periodEnd,
    status: row.status,
    periodStart: row.current_period_start,
    firstPaymentFailedAt: row.first_payment_failed_at,
    cancellationReason: canceled
      ? effectiveCancellationReason({
          firstPaymentFailedAt: row.first_payment_failed_at,
          lastPaymentAt: row.last_payment_at,
          periodStart: row.current_period_start,
        })
      : null,
    now,
  });
  // Nieczytelna data końca okresu: reguły nie da się policzyć - zostaje
  // zachowanie sprzed bramki (przypomnienie wychodzi).
  return accessUntil === null || Date.parse(accessUntil) >= Date.parse(periodEnd);
}

/**
 * Wysyła przypomnienia dla subskrypcji kończących okres za `leadDays` dni.
 * Fail-soft per rekord: błąd jednego odbiorcy nie przerywa całego przebiegu.
 *
 * ŚRODOWISKO, KTÓRE NIE NADAJE DOSTĘPU, NIE DOSTAJE PRZYPOMNIEŃ (S9, PAY-05).
 * Produkcja trzyma subskrypcje piaskownicy wyłącznie jako ślad księgowy
 * (`webhookDispatch.server`, „bookkeeping_only") - z prawdziwym `user_id`
 * z metadanych karty testowej. Przebieg z jawnym `environment = 'sandbox'`
 * na produkcji wysłałby realnemu klientowi „Twoja subskrypcja się odnawia"
 * za plan, którego nigdy nie kupił - więc kończy się pustym wynikiem bez
 * jednego zapytania (`environmentGrantsAccess`, ta sama bramka co webhook).
 *
 * @param batchSize   rozmiar partii odczytu (przebieg czyta WSZYSTKIE partie),
 * @param environment środowisko operatora; domyślnie rozstrzygane po stronie
 *                    serwera - nigdy z ładunku żądania.
 */
export async function runBillingReminders(
  leadDays: number = REMINDER_LEAD_DAYS,
  batchSize: number = REMINDER_BATCH_SIZE,
  now: Date = new Date(),
  environment: StripeEnv = resolveEnvironment(null),
): Promise<ReminderRunResult> {
  if (!environmentGrantsAccess(environment)) {
    console.warn("[billing-reminders] environment grants no access here - skipped", environment);
    return { renewal: 0, expiring: 0, skipped: 0 };
  }
  const { from, to } = reminderWindow(now, leadDays);
  const limit = Math.max(1, Math.floor(batchSize));

  let renewal = 0;
  let expiring = 0;
  let skipped = 0;

  let after: string | null = null;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await loadDueSubscriptions({ from, to, environment, after, limit });

    for (const row of rows) {
      const periodEnd = row.current_period_end;
      if (!periodEnd) {
        skipped += 1;
        continue;
      }
      const ending = row.status === "canceled" || row.cancel_at_period_end === true;
      if (ending && !accessLastsUntilPeriodEnd(row, periodEnd, now)) continue;
      try {
        const plan = await resolvePlanForPrice(row.price_id, {
          tenantId: row.tenant_id,
          userId: row.user_id,
        });
        // Liczymy WIADOMOŚCI, KTÓRE POSZŁY, a nie wywołania wysyłki. Wcześniej
        // licznik rósł zaraz po wywołaniu fail-soft `notifyReminderEmail`, więc
        // przy padniętej poczcie przebieg raportował dziesiątki przypomnień,
        // których nikt nie dostał - a `skipped`, jedyny sygnał do ponowienia,
        // nie ruszał się z zera. Zielony toast w panelu kłamał o wysyłce.
        const sent = await notifyReminderEmail({
          kind: ending ? "subscription_expiring" : "subscription_renewal_reminder",
          userId: row.user_id,
          // Najemca SUBSKRYPCJI, nie wołającego: przebieg jest platformowy,
          // a mail ma prowadzić na host i w redakcję organizacji adresata.
          tenantId: row.tenant_id,
          planId: plan?.planId ?? null,
          periodEnd,
          idempotencySeed: reminderSeed(row.provider_subscription_id, periodEnd, leadDays),
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

    if (rows.length < limit) return { renewal, expiring, skipped };
    // Partia jest pełna (`limit` >= 1 wierszy), a `id` to klucz główny -
    // ostatni wiersz zawsze niesie kursor.
    const last = rows[rows.length - 1].id;
    // Kursor, który się nie przesunął, oznacza pętlę bez końca - głośno,
    // zamiast cicho wysyłać te same przypomnienia w kółko.
    if (after !== null && last <= after) {
      throw new Error("reminder lookup failed: cursor did not advance");
    }
    after = last;
  }
  throw new Error(`reminder lookup failed: more than ${MAX_BATCHES} batches`);
}
