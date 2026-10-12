// Rdzeń obsługi zdarzeń operatora płatności - oddzielony od trasy HTTP.
//
// Dzięki temu ten sam kod obsługuje:
//   1. zdarzenie przychodzące (trasa `/api/public/payments/webhook`, po
//      weryfikacji podpisu),
//   2. ponowne przetworzenie z panelu admina (`webhookRetry.functions`), gdzie
//      podpisu już nie ma - pracujemy na ładunku zapisanym w dzienniku.
// Cała logika jest idempotentna, więc powtórka nie dubluje skutków.
//
// Moduł server-only (klient service_role) - importuj wyłącznie z handlerów.
import { catalogEntryByPriceId, planChangeDirection } from "@/lib/billing/catalog";
import { accessPeriodFromEvent } from "@/lib/billing/accessPeriod";
import { environmentGrantsAccess, type StripeEnv } from "@/lib/stripe.server";

export type SubscriptionData = {
  id: string;
  customerId: string;
  status: string;
  customData?: { userId?: string; purpose?: string; donationId?: string } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  scheduledChange?: { action?: string } | null;
  items: Array<{
    quantity?: number;
    /** Koniec okresu próbnego dla pozycji (operator podaje go per pozycja). */
    trialDates?: { startsAt?: string | null; endsAt?: string | null } | null;
    price: {
      id: string;
      externalId?: string | null;
      trialPeriod?: { interval?: string | null; frequency?: number | null } | null;
    };
    product?: { id: string; externalId?: string | null } | null;
  }>;
};

export type TransactionData = {
  id: string;
  subscriptionId?: string | null;
  customerId?: string | null;
  /** Identyfikator intencji płatności - klucz dopasowania przy zwrocie. */
  paymentIntentId?: string | null;
  currencyCode?: string | null;
  customData?: Record<string, unknown> | null;
  customer?: { email?: string | null } | null;
  details?: { totals?: { grandTotal?: string | null } | null } | null;
  payments?: Array<{ errorCode?: string | null }> | null;
  billingPeriod?: { endsAt?: string | null } | null;
  /**
   * Skąd pochodzi transakcja: sesja Checkout (`cs_...`) albo faktura
   * (`in_...`). Faktura subskrypcji niesie metadane subskrypcji, w tym
   * `orderId` - domknięcie zamówienia wolno wykonać WYŁĄCZNIE na sesji.
   */
  source?: "checkout_session" | "invoice" | null;
  /** Suma pozycji przed rabatem i podatkiem (sesja Checkout: `amount_subtotal`). */
  amountSubtotalCents?: number | null;
  /** Rabat zdjęty przez operatora (`total_details.amount_discount`). */
  amountDiscountCents?: number | null;
  /** Podatek doliczony przez operatora (`total_details.amount_tax`). */
  amountTaxCents?: number | null;
  /**
   * Kody promocyjne operatora wpisane przez kupującego w sesji
   * (`discounts[].promotion_code`). NASZ kupon jedzie jako `discounts[].coupon`
   * bez kodu, więc pusta lista = brak kodu spoza kasy. Realizacja sprawdza po
   * nich, czy kod należy do najemcy zamówienia (konto operatora jest wspólne).
   */
  promotionCodeIds?: string[] | null;
};

/** Wynik obsługi: `skipped` = zdarzenie spoza zakresu integracji. */
export type DispatchOutcome = "processed" | "skipped";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function readIds(data: SubscriptionData) {
  const item = data.items?.[0];
  const priceId = item?.price?.externalId ?? null;
  return {
    priceId,
    // Stripe w zdarzeniu NIE rozwija produktu ceny (`price.product` to sam
    // `prod_...`), więc `metadata.lovable_external_id` produktu w ładunku
    // webhooka po prostu nie ma. Bez wpisu katalogowego jako zapasu każde
    // `customer.subscription.created` z bramki kończyło się „missing
    // lookup_key/metadata" i subskrypcja nie powstawała wcale. Katalog jest
    // tym samym źródłem, z którego `catalogSync` nadał produktowi metadane,
    // więc wartość jest identyczna.
    productId: item?.product?.externalId ?? catalogEntryByPriceId(priceId)?.productId ?? null,
    quantity: item?.quantity ?? 1,
    /** Koniec triala: pozycja zdarzenia jest jedynym wiarygodnym źródłem. */
    trialEndsAt: item?.trialDates?.endsAt ?? null,
  };
}

/**
 * Znacznik czasu zdarzenia w ISO albo `null`, gdy operator (lub wiersz
 * dziennika przy ponowieniu) podał czas, którego nie da się odczytać.
 *
 * JEDNO miejsce na tę decyzję jest tu warunkiem spójności: strażnik kolejności
 * świadomie PRZEPUSZCZA zdarzenie bez wiarygodnego czasu, więc każdy kolejny
 * konsument tej samej wartości musi ją znieść tak samo. Wcześniej znosił ją
 * tylko strażnik, a `handleCreated` wywracał się na `Invalid time value`.
 */
function eventStamp(occurredAt: string | null | undefined): string | null {
  if (!occurredAt) return null;
  const parsed = new Date(occurredAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Para (znacznik, identyfikator) zdarzenia, którego skutki właśnie startują -
 * to ona ląduje w `last_event_at` / `last_event_id` wiersza subskrypcji.
 */
interface EventMark {
  /** Znacznik czasu zdarzenia w ISO; `null` = czas nie do odczytania. */
  stamp: string | null;
  /** Identyfikator zdarzenia operatora; `null` u wołających bez niego. */
  eventId: string | null;
}

/**
 * Werdykt strażnika kolejności zdarzeń subskrypcji:
 *  - `fresh`   - zdarzenie nowsze niż zapisany stan, zajęte,
 *  - `replay`  - TO SAMO zdarzenie (znacznik i identyfikator) - ponowienie po
 *                porażce skutków; przetwarzamy jeszcze raz,
 *  - `tie`     - INNE zdarzenie z tą samą sekundą; zajęte, stan z API operatora,
 *  - `stale`   - starsze niż zapisany stan, pomijamy,
 *  - `missing` - wiersza subskrypcji nie ma (ścieżka zakładania),
 *  - `untimed` - wiersz jest, a czasu zdarzenia nie da się odczytać.
 */
type GuardVerdict = "fresh" | "replay" | "tie" | "stale" | "missing" | "untimed";

/**
 * Ile razy strażnik powtarza odczyt i zajęcie, gdy równoległy zapis zmienił
 * wiersz między zapytaniami. Trzy próby wystarczają z zapasem - wyścig wymaga
 * dwóch zdarzeń tej samej subskrypcji w tych samych milisekundach.
 */
const GUARD_MAX_ATTEMPTS = 3;

/**
 * Prefiks `last_event_id` po remisie rozstrzygniętym stanem z API operatora.
 * Dzięki niemu KAŻDE kolejne zdarzenie z tą samą sekundą - także ponowienie
 * zdarzenia, które remis wygrało - znów idzie po stan z API, a nie po własny
 * ładunek, który mógłby być starszym z dwóch zdjęć tej samej sekundy.
 */
const TIE_MARKER = "tie:";

/**
 * Strażnik kolejności zdarzeń subskrypcji.
 *
 * Operator nie gwarantuje kolejności dostarczenia, a ponowna dostawa starego
 * zdarzenia potrafi cofnąć stan (np. `past_due` po `activated`). Kolumny
 * `last_event_at` / `last_event_id` trzymają zdarzenie, którego skutki
 * ROZPOCZĘTO. Zajęcie świeższego zdarzenia to jeden warunkowy UPDATE
 * (`last_event_at IS NULL OR < stamp`) - atomowy, więc spóźnione zdarzenie nie
 * przeskoczy nowszego, nawet gdy przyjdą równolegle.
 *
 * DLACZEGO IDENTYFIKATOR. Strażnik zapisuje parę PRZED skutkami (inaczej dwa
 * równoległe zdarzenia mogłyby wykonać skutki w złej kolejności), więc gdy
 * skutki padną, wiersz zostaje z tą samą parą. Bez identyfikatora ponowna
 * dostawa widziała równy znacznik i kończyła się `skipped`: klient tracił
 * dostęp po odnowieniu, bo jednorazowy błąd zapisu uprawnienia zamieniał się
 * w zdarzenie zgubione na zawsze. Z identyfikatorem to `replay` - skutki
 * biegną jeszcze raz (są idempotentne).
 *
 * REMIS. Stripe podaje czas z rozdzielczością sekundy, więc `created` i
 * `updated` jednej kasy mają często ten sam znacznik. Żadnego z nich nie wolno
 * po cichu porzucić, a który ładunek jest nowszy - nie wiadomo. Wygrywa więc
 * AUTORYTATYWNY stan z API operatora (patrz `authoritativeSubscription`).
 *
 * Bez nowej funkcji w bazie: zajęcie świeżego zdarzenia (droga typowa) to
 * jedno zapytanie; odczyt rozstrzyga tylko przypadki, w których warunkowy
 * UPDATE nie trafił, a każdy zapis po odczycie jest warunkowy względem stanu,
 * który odczyt widział.
 */
async function claimSubscriptionEvent(
  subscriptionId: string,
  env: StripeEnv,
  mark: EventMark,
): Promise<GuardVerdict> {
  const supabase = await admin();
  const { stamp, eventId } = mark;

  if (!stamp) {
    // Brak wiarygodnego czasu - nie blokujemy (ponowienie wiersza dziennika
    // bez czasu musi dać się wykonać), ale ścieżka zakładania musi wiedzieć,
    // czy wiersz już jest.
    const { data: exists, error } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .maybeSingle();
    if (error) throw new Error(`subscription lookup failed: ${error.message}`);
    return exists ? "untimed" : "missing";
  }

  for (let attempt = 1; attempt <= GUARD_MAX_ATTEMPTS; attempt += 1) {
    const { data: claimed, error } = await supabase
      .from("subscriptions")
      .update({ last_event_at: stamp, last_event_id: eventId })
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .or(`last_event_at.is.null,last_event_at.lt.${stamp}`)
      .select("id");
    if (error) throw new Error(`subscription event claim failed: ${error.message}`);
    if (claimed && claimed.length > 0) return "fresh";

    // Zero zajętych wierszy: subskrypcji nie ma, zapisany stan jest nowszy,
    // to samo zdarzenie wraca albo inne zdarzenie ma tę samą sekundę.
    const { data: row, error: readErr } = await supabase
      .from("subscriptions")
      .select("last_event_at, last_event_id")
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .maybeSingle();
    if (readErr) throw new Error(`subscription lookup failed: ${readErr.message}`);
    if (!row) return "missing";

    const stored = row.last_event_at ? Date.parse(row.last_event_at) : Number.NaN;
    const incoming = Date.parse(stamp);
    if (stored > incoming) return "stale";
    if (stored === incoming) {
      if (eventId !== null && row.last_event_id === eventId) return "replay";
      // Remis: zajmujemy go warunkiem na SAM znacznik. Gdy między odczytem
      // a zapisem wszedł nowszy stan, UPDATE nie trafi, a kolejna próba
      // zobaczy `stale`.
      const { data: tied, error: tieErr } = await supabase
        .from("subscriptions")
        .update({ last_event_id: `${TIE_MARKER}${eventId ?? "unknown"}` })
        .eq("provider_subscription_id", subscriptionId)
        .eq("environment", env)
        .eq("last_event_at", stamp)
        .select("id");
      if (tieErr) throw new Error(`subscription event claim failed: ${tieErr.message}`);
      if (tied && tied.length > 0) return "tie";
    }
    // Znacznik pusty albo starszy, a warunkowy UPDATE nie trafił: wiersz
    // powstał lub zmienił się między zapytaniami - powtarzamy całość.
  }
  throw new Error(`subscription event guard: contention (${subscriptionId})`);
}

/**
 * Stan subskrypcji z API operatora - rozstrzyga remis w obrębie sekundy.
 *
 * Kolejność jest stała: najpierw odczyt, potem zastosowanie, a porażka odczytu
 * to wyjątek (trasa odpowiada 500, operator ponawia, a ponowienie znów trafi
 * w remis - kolumna niesie `tie:`). Zastosowanie ładunku „na wszelki wypadek"
 * mogłoby cofnąć stan do starszego z dwóch zdjęć tej samej sekundy.
 * Produkt jest rozwijany, żeby mapowanie znało jego czytelny identyfikator.
 */
async function authoritativeSubscription(
  subscriptionId: string,
  env: StripeEnv,
): Promise<SubscriptionData> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  let remote: unknown;
  try {
    const stripe = await getStripeClient(env);
    remote = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`subscription tie: provider read failed (${subscriptionId}): ${message}`);
  }
  const { mapStripeSubscription } = await import("@/lib/billing/stripeEvents.server");
  return mapStripeSubscription(remote as Record<string, unknown>);
}

/** Pola wiersza `subscriptions` z ładunku albo `null`, gdy brakuje powiązań. */
function subscriptionRowFrom(data: SubscriptionData, env: StripeEnv) {
  const userId = data.customData?.userId;
  const { priceId, productId, quantity, trialEndsAt } = readIds(data);
  if (!userId) {
    console.error("[payments] missing customData.userId", data.id);
    return null;
  }
  if (!priceId || !productId) {
    console.warn("[payments] missing lookup_key/metadata.lovable_external_id", data.id);
    return null;
  }
  return {
    userId,
    priceId,
    quantity,
    trialEndsAt,
    row: {
      user_id: userId,
      provider_subscription_id: data.id,
      provider_customer_id: data.customerId,
      product_id: productId,
      price_id: priceId,
      status: data.status,
      quantity,
      current_period_start: data.currentBillingPeriod?.startsAt ?? null,
      current_period_end: data.currentBillingPeriod?.endsAt ?? null,
      // Okres próbny: zapisujemy datę końca, żeby profil i panel pokazywały
      // "trial do ...", a przypomnienia potrafiły uprzedzić pierwsze obciążenie.
      trial_ends_at: trialEndsAt,
      environment: env,
      updated_at: new Date().toISOString(),
    },
  };
}

type SubscriptionRowSource = NonNullable<ReturnType<typeof subscriptionRowFrom>>;

/**
 * Zakłada wiersz `subscriptions` WYŁĄCZNIE, gdy go nie ma
 * (`ON CONFLICT (provider_subscription_id) DO NOTHING`).
 *
 * Dawny upsert nadpisywał istniejący wiersz razem z `last_event_at`, więc
 * spóźnione `created` (np. po `deleted`) cofało strażnika i wskrzeszało
 * anulowaną subskrypcję. Wstawienie niesie parę strażnika - wiersz od
 * pierwszej chwili zna zdarzenie, którego skutki startują.
 *
 * @returns `inserted` - ten zapis założył wiersz; `exists` - przegraliśmy
 *          wyścig z równoległym zdarzeniem (wołający ponawia strażnika);
 *          `invalid` - ładunek bez właściciela albo identyfikatorów cennika,
 *          albo właściciel już nie istnieje.
 */
async function insertSubscriptionRow(
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
): Promise<
  { outcome: "inserted"; source: SubscriptionRowSource } | { outcome: "exists" | "invalid" }
> {
  const source = subscriptionRowFrom(data, env);
  if (!source) return { outcome: "invalid" };

  const supabase = await admin();
  const { data: inserted, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        ...source.row,
        // Czas nie do odczytania pomijamy: strażnik przepuścił takie zdarzenie
        // świadomie, a następne zdarzenie z poprawnym czasem i tak zajmie wiersz.
        ...(mark.stamp ? { last_event_at: mark.stamp, last_event_id: mark.eventId } : {}),
      },
      { onConflict: "provider_subscription_id", ignoreDuplicates: true },
    )
    .select("id");
  // 23503: konto właściciela usunięte (`user_id` -> `auth.users`). Zdarzenie
  // po zamknięciu konta (np. `deleted` subskrypcji anulowanej przy zamknięciu)
  // nie ma komu zapisać śladu, a wyjątek skazałby je na ponowienia bez końca.
  if (error?.code === "23503") {
    console.warn("[payments] subscription owner no longer exists", data.id);
    return { outcome: "invalid" };
  }
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
  return inserted && inserted.length > 0 ? { outcome: "inserted", source } : { outcome: "exists" };
}

/**
 * Skutki ZAŁOŻENIA subskrypcji: dostęp, mail, CRM, newsletter, dzwonek
 * i miejsca planu Zespół. `grantsAccess: false` (zdarzenie piaskownicy na
 * produkcji) zostawia wyłącznie ślad księgowy w `subscriptions`.
 */
async function applyCreationEffects(
  data: SubscriptionData,
  env: StripeEnv,
  source: SubscriptionRowSource,
  grantsAccess: boolean,
): Promise<void> {
  if (!grantsAccess) return;
  const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPurchaseEffects({
    userId: source.userId,
    priceId: source.priceId,
    subscriptionId: data.id,
    // W trialu dostęp trwa do końca okresu próbnego - dopiero pierwsze
    // obciążenie przesuwa go na pełny cykl rozliczeniowy.
    periodEnd: data.currentBillingPeriod?.endsAt ?? source.trialEndsAt ?? null,
    environment: env,
    status: data.status,
  });

  // Plan Zespół: liczba opłaconych miejsc ustala limit organizacji.
  const { applySubscriptionSeats } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionSeats({
    subscriptionId: data.id,
    quantity: source.quantity,
    priceId: source.priceId,
  });
}

/**
 * `subscription.created` dla wiersza, który JUŻ jest (świeże zdarzenie albo
 * ponowienie tego samego `created` po porażce skutków): stan z ładunku trafia
 * do wiersza, a skutki założenia biegną jeszcze raz - są idempotentne (klucz
 * `external_ref`, ziarna idempotencji maili, upserty CRM i newslettera).
 */
async function handleCreated(data: SubscriptionData, env: StripeEnv, grantsAccess: boolean) {
  const source = subscriptionRowFrom(data, env);
  if (!source) return;

  const supabase = await admin();
  const { error } = await supabase
    .from("subscriptions")
    .update(source.row)
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  await applyCreationEffects(data, env, source, grantsAccess);
}

/**
 * Wspólna ścieżka dla wszystkich zdarzeń zmieniających stan subskrypcji:
 * `updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`.
 * Operator wysyła je jako osobne typy, ale ładunek ma identyczny kształt, a
 * autorytatywne jest pole `status` - dlatego obsługa jest jedna i idempotentna.
 */
async function handleUpdated(
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
  grantsAccess: boolean,
) {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity, trialEndsAt } = readIds(data);

  // Nieudany odczyt to NIE „brak wiersza": ścieżka zakładania niżej
  // zakończyłaby zdarzenie bez zapisu stanu, a dziennik pokazałby `processed`.
  const { data: existing, error: readErr } = await supabase
    .from("subscriptions")
    .select("user_id, tenant_id, price_id, status, current_period_end")
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  if (readErr) throw new Error(`subscription lookup failed: ${readErr.message}`);

  // Wiersz zniknął między strażnikiem a odczytem (albo strażnik przepuścił
  // zdarzenie bez czasu). Bez wiersza UPDATE trafiłby w pustkę i zakup
  // przepadłby po cichu - zakładamy go tą samą ścieżką co przy utworzeniu,
  // ale WYŁĄCZNIE wstawieniem: istniejącego (nowszego) wiersza ten zapis
  // nigdy nie nadpisze ani nie cofnie mu strażnika.
  if (!existing && data.customData?.userId) {
    const created = await insertSubscriptionRow(data, env, mark);
    if (created.outcome === "inserted") {
      await applyCreationEffects(data, env, created.source, grantsAccess);
    }
    return;
  }

  // Zdarzenia stanu (pauza, wznowienie, past_due) bywają bez okresu
  // rozliczeniowego - wtedy zapisana data końca dostępu musi zostać nietknięta.
  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: data.status,
  });

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: data.status,
      ...(eventPriceId ? { price_id: eventPriceId } : {}),
      quantity,
      ...(data.currentBillingPeriod?.startsAt
        ? { current_period_start: data.currentBillingPeriod.startsAt }
        : {}),
      current_period_end: period.periodEnd,
      // Wyjście z triala (`activated`) czyści datę - zdarzenie nie niesie już
      // `trialDates`, a zostawiona data sugerowałaby trwający okres próbny.
      trial_ends_at: data.status === "trialing" ? trialEndsAt : null,
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      updated_at: new Date().toISOString(),
    })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  // Zdarzenie piaskownicy na produkcji: ślad księgowy wyżej i nic więcej -
  // karta testowa nie rusza miejsc zespołu, uprawnień, CRM ani maili.
  if (!grantsAccess) return;

  // Zdarzenia stanu (pauza, wznowienie, past_due) potrafią nie nieść pozycji
  // cennika - wtedy pracujemy na cenie zapisanej przy subskrypcji.
  const priceId = eventPriceId ?? existing?.price_id ?? null;

  // Plan Zespół: zmiana liczby opłaconych miejsc oraz stanu subskrypcji musi
  // natychmiast przełożyć się na limit i uprawnienia całego zespołu.
  const { applySubscriptionSeats, applySubscriptionOrgState } =
    await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({ subscriptionId: data.id, status: data.status, priceId });
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });

  if (!existing?.user_id || !priceId) return;

  // Każda aktualizacja (pauza, wznowienie, past_due, nowy okres) musi trafić do
  // uprawnień, nie tylko zmiana planu.
  const { resolvePlanForPrice, applyStatusTransitionEffects } =
    await import("@/lib/billing/purchaseEffects.server");
  const plan = await resolvePlanForPrice(priceId, {
    tenantId: existing.tenant_id ?? null,
    userId: existing.user_id,
  });
  if (plan) {
    const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
    await syncEntitlementState({
      userId: existing.user_id,
      tenantId: plan.tenantId,
      planId: plan.planId,
      externalRef: data.id,
      status: data.status,
      periodEnd: period.accessUntil,
    });
  }

  // CRM + powiadomienie użytkownika przy zmianie samego stanu.
  await applyStatusTransitionEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    previousStatus: existing.status ?? null,
    status: data.status,
  });

  const direction = eventPriceId ? planChangeDirection(existing.price_id, eventPriceId) : "same";
  if (direction === "same") return;

  const { applyPlanChangeEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPlanChangeEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId,
    previousPriceId: existing.price_id,
    direction,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    environment: env,
  });
}

async function handleCanceled(data: SubscriptionData, env: StripeEnv, grantsAccess: boolean) {
  const supabase = await admin();
  const { data: existing, error: readErr } = await supabase
    .from("subscriptions")
    .select("user_id, tenant_id, price_id, current_period_end")
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  // Bez odczytu nie wiadomo, komu odebrać dostęp - rezygnacja z `processed`
  // zostawiłaby uprawnienie aktywne bez płatności.
  if (readErr) throw new Error(`subscription lookup failed: ${readErr.message}`);

  const { error } = await supabase
    .from("subscriptions")
    .update({ status: "canceled", trial_ends_at: null, updated_at: new Date().toISOString() })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  const canceledPeriod = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: "canceled",
  });

  if (!grantsAccess || !existing?.user_id || !existing.price_id) return;

  // Anulowanie planu Zespół wstrzymuje organizację - miejsca zostają, ale
  // przestają nadawać uprawnienia.
  const { applySubscriptionOrgState } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: data.id,
    status: "canceled",
    priceId: existing.price_id,
  });

  const { applyCancellationEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyCancellationEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId: existing.price_id,
    subscriptionId: data.id,
    periodEnd: canceledPeriod.accessUntil,
    environment: env,
  });
}

function amountFromTransaction(data: TransactionData): number | null {
  const raw = data.details?.totals?.grandTotal;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Najemca zakupu jednorazowego - z NASZEGO wiersza (zamówienie albo
 * darowizna), nigdy z ładunku operatora. Zapytania filtrują po środowisku
 * zdarzenia, tak jak realizacja zamówienia (`oneTimeFulfilment.server`).
 * `null` = nie da się przypisać; wtedy zakup nie idzie do GA4 wcale.
 */
async function purchaseTenant(
  customData: Record<string, unknown> | null | undefined,
  env: StripeEnv,
): Promise<string | null> {
  const text = (key: string): string | null => {
    const value = customData?.[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const supabase = await admin();
  const orderId = text("orderId") ?? text("order_id");
  if (orderId) {
    const { data } = await supabase
      .from("payment_orders")
      .select("tenant_id")
      .eq("id", orderId)
      .eq("environment", env)
      .maybeSingle();
    return data?.tenant_id ?? null;
  }
  const donationId = text("donationId");
  if (donationId) {
    const { data } = await supabase
      .from("donations")
      .select("tenant_id")
      .eq("id", donationId)
      .eq("environment", env)
      .maybeSingle();
    return data?.tenant_id ?? null;
  }
  return null;
}

/**
 * GA4: zakup zgłaszany z serwera (ścieżka pewna).
 *
 * NAJEMCA DECYDUJE O STRUMIENIU. Zakup idzie do strumienia z panelu analityki
 * najemcy i nie idzie wcale, gdy najemca odłączył GA4 (`ga4_enabled: false`)
 * - albo gdy zakupu nie da się przypisać do najemcy. Wcześniej każdy zakup
 * szedł do strumienia wdrożenia niezależnie od panelu (audyt wyd. 12).
 *
 * `client_id`: pole `_ga_client_id` w metadanych sesji zszywa zakup z sesją
 * przeglądarki, ale DZIŚ ŻADEN silnik checkoutu go nie zapisuje - zakup
 * liczy się więc ze stabilnym zastępnikiem z identyfikatora transakcji
 * (`syntheticClientId`), a deduplikację z przeglądarką daje `transaction_id`.
 * Odczyt zostaje, bo pole jest jedynym miejscem, którym przyszły zapis
 * (np. z `ga4ClientId()` po stronie klienta) dojedzie tu bez zmian.
 * Nigdy nie rzuca - analityka nie może wywrócić realizacji płatności.
 */
async function reportPurchaseToGa4(data: TransactionData, env: StripeEnv): Promise<void> {
  try {
    const tenantId = await purchaseTenant(data.customData, env);
    if (!tenantId) return;
    const clientId = data.customData?.["_ga_client_id"];
    const { sendGa4Purchase } = await import("@/lib/analytics/ga4Mp.server");
    await sendGa4Purchase({
      transactionId: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      clientId: typeof clientId === "string" ? clientId : null,
      tenantId,
    });
  } catch (err) {
    console.error("[payments] GA4 purchase report failed", data.id, err);
  }
}

async function handleTransaction(
  data: TransactionData,
  env: StripeEnv,
  occurredAt: string,
  kind: "failed" | "paid",
) {
  // Transakcja bez subskrypcji = płatność jednorazowa (odblokowanie treści,
  // bilet, darowizna). Rozpoznanie idzie po `custom_data`, które ustawia
  // serwer przy tworzeniu transakcji - klient nie ma jak go podmienić.
  if (!data.subscriptionId) {
    if (kind === "failed") {
      // Odrzucona płatność jednorazowa: zgłoszenie na wydarzenie zostaje, ale
      // musi być widoczne jako NIEOPŁACONE - inaczej organizator wpuściłby na
      // salę osobę, której karta nie przeszła.
      const { markOneTimePaymentFailed } = await import("@/lib/billing/oneTimeFulfilment.server");
      await markOneTimePaymentFailed(data.customData ?? null, env);
      return;
    }
    if (kind !== "paid") return;
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    await fulfilOneTimeTransaction(
      {
        id: data.id,
        amountCents: amountFromTransaction(data),
        currency: data.currencyCode ?? null,
        customerEmail: data.customer?.email ?? null,
        customData: data.customData ?? null,
        sessionId: data.id,
        paymentIntentId: data.paymentIntentId ?? null,
        customerId: data.customerId ?? null,
        amountSubtotalCents: data.amountSubtotalCents ?? null,
        amountDiscountCents: data.amountDiscountCents ?? null,
        amountTaxCents: data.amountTaxCents ?? null,
        promotionCodeIds: data.promotionCodeIds ?? null,
      },
      env,
    );
    await reportPurchaseToGa4(data, env);
    return;
  }
  // Odnowienie darowizny cyklicznej: brak uprawnień i windykacji planów -
  // każda opłacona faktura ma zostać zaksięgowana jako osobna wpłata.
  if (data.customData?.purpose === "donation") {
    if (kind !== "paid") return;
    const { recordRecurringDonationPayment } = await import("@/lib/billing/donations.server");
    await recordRecurringDonationPayment({
      donationId: (data.customData.donationId as string | undefined) ?? null,
      subscriptionId: data.subscriptionId,
      invoiceId: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      donorEmail: data.customer?.email ?? null,
    });
    return;
  }

  // Pierwsza sesja Checkout subskrypcji domyka NASZE zamówienie (księgi,
  // kupon). Uprawnienie nadaje wyłącznie ścieżka `subscription.*` - tu nie
  // wolno go dublować. Faktury odnowień niosą to samo `orderId` w metadanych
  // subskrypcji, dlatego bramką jest źródło zdarzenia, nie same metadane.
  if (kind === "paid" && data.source === "checkout_session") {
    const { settleSubscriptionCheckoutOrder } =
      await import("@/lib/billing/oneTimeFulfilment.server");
    await settleSubscriptionCheckoutOrder(
      {
        id: data.id,
        amountCents: amountFromTransaction(data),
        currency: data.currencyCode ?? null,
        customerEmail: data.customer?.email ?? null,
        customData: data.customData ?? null,
        sessionId: data.id,
        paymentIntentId: data.paymentIntentId ?? null,
        customerId: data.customerId ?? null,
        subscriptionId: data.subscriptionId,
        amountSubtotalCents: data.amountSubtotalCents ?? null,
        amountDiscountCents: data.amountDiscountCents ?? null,
        amountTaxCents: data.amountTaxCents ?? null,
        promotionCodeIds: data.promotionCodeIds ?? null,
      },
      env,
    );
  }

  const ctx = {
    subscriptionId: data.subscriptionId,
    environment: env,
    occurredAt,
    amountCents: amountFromTransaction(data),
    currency: data.currencyCode ?? null,
    // Klucz deduplikacji windykacji: `transaction.payment_failed` i
    // `transaction.past_due` opisują TĘ SAMĄ nieudaną transakcję.
    transactionId: data.id,
  };
  const dunning = await import("@/lib/billing/dunning.server");
  if (kind === "failed") await dunning.applyPaymentFailedEffects(ctx);
  else await dunning.applyPaymentRecoveredEffects(ctx);
}

/**
 * Korekty rozliczeniowe operatora: zwrot, obciążenie zwrotne, kredyt.
 *
 * Payload korekty jest luźniejszy niż subskrypcyjny (SDK nie eksportuje dla
 * niego stabilnego typu), więc czytamy pola defensywnie i całą decyzję
 * przekazujemy do `applyRefundEffects`.
 */
async function handleAdjustment(data: Record<string, unknown>, env: StripeEnv): Promise<void> {
  const str = (key: string): string | null =>
    typeof data[key] === "string" ? (data[key] as string) : null;

  const totals = data.totals as
    { total?: string; captured?: string; currencyCode?: string } | undefined;
  const totalRaw = totals?.total;
  const amountCents = totalRaw !== undefined ? Math.round(Number(totalRaw)) : null;
  const capturedRaw = totals?.captured;
  const capturedCents = capturedRaw !== undefined ? Math.round(Number(capturedRaw)) : null;

  const { applyRefundEffects } = await import("@/lib/billing/refunds.server");
  await applyRefundEffects({
    adjustmentId: str("id") ?? "",
    transactionId: str("transactionId"),
    subscriptionId: str("subscriptionId"),
    action: (str("action") ?? "other") as
      "refund" | "chargeback" | "chargeback_warning" | "credit" | "other",
    status: str("status"),
    // Surowy status sporu u operatora (`needs_response`, `won`, `lost`) - trafia
    // do alertu dla zespołu, decyzję podejmuje już słownik domenowy wyżej.
    providerStatus: str("providerStatus"),
    amountCents: Number.isFinite(amountCents) ? amountCents : null,
    capturedAmountCents: Number.isFinite(capturedCents) ? capturedCents : null,
    currency: str("currencyCode") ?? totals?.currencyCode ?? null,
    environment: env,
    // Tylko zwrot, który nie doszedł (`refund.failed`) - kod trafia do
    // dziennika zwrotów i alarmu, patrz `escalateFailedRefund`.
    failureReason: str("failureReason"),
  });
}

/**
 * Zapis faktury dla transakcji. Zwraca `true`, gdy coś faktycznie zapisano -
 * `transaction.updated` bez zmian traktujemy jako pominięte zdarzenie.
 *
 * `fallbackStatus` - status, gdy ładunek go nie niesie (ładunek z dziennika
 * sprzed pola `status` w normalizatorze); `transaction.completed` znaczy
 * „opłacone".
 *
 * NIEUDANY ZAPIS TO BŁĄD ZDARZENIA, nie „pominięte". Rejestr dokumentów jest
 * dowodem sprzedaży dla członka i księgowości; zdarzenie zamknięte jako
 * przetworzone mimo braku dokumentu nigdy by nie wróciło (Stripe ponawia
 * wyłącznie po odpowiedzi innej niż 2xx). Rzucamy więc - trasa webhooka
 * oznacza zdarzenie jako `failed`, oddaje 500, a operator dostarcza je
 * ponownie (zapis jest idempotentny). Alarm dla administratorów najemcy
 * wysyła już `recordTransactionDocument`.
 */
async function recordDocument(
  data: unknown,
  env: StripeEnv,
  fallbackStatus: string | null = null,
): Promise<boolean> {
  const { documentInputFromTransaction, recordTransactionDocument } =
    await import("@/lib/billing/billingDocuments.server");
  const input = documentInputFromTransaction(data, env, fallbackStatus);
  if (!input) return false;
  const outcome = await recordTransactionDocument(input);
  if (outcome === "failed") {
    throw new Error(`billing document not recorded: ${input.transactionId}`);
  }
  return outcome !== "skipped";
}

/** Typy zdarzeń obsługiwane przez integrację (jedno miejsce prawdy). */
export const HANDLED_EVENT_TYPES = [
  "subscription.created",
  "subscription.updated",
  "subscription.activated",
  "subscription.trialing",
  "subscription.past_due",
  "subscription.paused",
  "subscription.resumed",
  "subscription.imported",
  "subscription.canceled",
  "transaction.completed",
  "transaction.updated",
  "transaction.payment_failed",
  "transaction.past_due",
  "transaction.expired",
  "adjustment.created",
  "adjustment.updated",
  "customer.updated",
  "address.updated",
  "business.updated",
] as const;

export interface DispatchInput {
  /**
   * Identyfikator zdarzenia u operatora (`evt_...`, albo syntetyczny
   * `reconcile_...`). Ten sam przy każdej ponownej dostawie i przy ponowieniu
   * z panelu - po nim strażnik kolejności odróżnia powtórkę TEGO SAMEGO
   * zdarzenia od innego zdarzenia z tym samym znacznikiem czasu.
   *
   * Opcjonalny wyłącznie dla synchronizacji na żądanie (`selfSync.server`),
   * która stempluje zdarzenie chwilą „teraz" - bez identyfikatora zdarzenie
   * nigdy nie jest uznane za ponowienie, a ta sama sekunda to remis
   * rozstrzygany stanem z API operatora (bezpiecznie, tylko drożej).
   */
  eventId?: string | null;
  eventType: string;
  data: unknown;
  environment: StripeEnv;
  occurredAt: string;
}

/**
 * Kieruje zdarzenie do właściwej obsługi. Bez efektów ubocznych poza bazą,
 * więc wywołanie z panelu admina (retry) daje ten sam skutek co dostarczenie
 * przez operatora.
 */
/**
 * Subskrypcja darowizny to nie plan dostępu - nie nadaje uprawnień i nie ma
 * odpowiednika w `BILLING_CATALOG`. Rozpoznajemy ją po `metadata.purpose`
 * ustawianym po stronie serwera przy tworzeniu sesji checkout.
 */
function isDonationSubscription(data: SubscriptionData): boolean {
  return data.customData?.purpose === "donation";
}

async function handleDonationSubscription(data: SubscriptionData, status: string) {
  const { syncDonationSubscription } = await import("@/lib/billing/donations.server");
  await syncDonationSubscription({
    subscriptionId: data.id,
    donationId: data.customData?.donationId ?? null,
    status,
  });
}

/** Rodzaj obsługi zdarzenia `subscription.*` albo `null` dla innych typów. */
function subscriptionEventKind(eventType: string): "created" | "updated" | "canceled" | null {
  switch (eventType) {
    case "subscription.created":
      return "created";
    // Wszystkie zdarzenia zmiany stanu subskrypcji dzielą jedną obsługę -
    // operator wysyła je jako osobne typy, ale autorytatywny jest `status`.
    case "subscription.updated":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.imported":
      return "updated";
    case "subscription.canceled":
      return "canceled";
    default:
      return null;
  }
}

/**
 * Zdarzenie subskrypcji przez strażnika kolejności - JEDNA droga dla
 * `created`, zdarzeń stanu i rezygnacji (dawniej `created` omijało strażnika,
 * a jego upsert cofał `last_event_at`, więc spóźnione `created` wskrzeszało
 * anulowaną subskrypcję).
 *
 * Strażnik zapisuje parę (znacznik, identyfikator) PRZED skutkami. Gdy skutki
 * padną, wyjątek wraca do trasy (500 / `failed` w dzienniku), a ponowna
 * dostawa tego samego zdarzenia dostaje `replay` i przechodzi całą obsługę
 * jeszcze raz.
 */
async function handleSubscriptionEvent(
  kind: "created" | "updated" | "canceled",
  input: DispatchInput,
  grantsAccess: boolean,
): Promise<DispatchOutcome> {
  const env = input.environment;
  const data = input.data as SubscriptionData;
  const mark: EventMark = { stamp: eventStamp(input.occurredAt), eventId: input.eventId ?? null };

  // `created` bez właściciela albo identyfikatorów cennika nie ma czego
  // zapisać - ani wiersza, ani skutków. Odsiewamy je PRZED strażnikiem, żeby
  // śmieciowy ładunek nie zajmował znacznika istniejącej subskrypcji.
  if (kind === "created" && !subscriptionRowFrom(data, env)) return "processed";

  for (let attempt = 1; ; attempt += 1) {
    const verdict = await claimSubscriptionEvent(data.id, env, mark);
    switch (verdict) {
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji.
      case "stale":
        return "skipped";

      case "missing": {
        // `created` zakłada wiersz; zdarzenie stanu, które wyprzedziło
        // `created`, też - inaczej zakup przepadłby po cichu. Rezygnacja
        // zostawia wiersz-nagrobek: spóźnione `created` zobaczy wtedy nowszy
        // znacznik i nie wskrzesi subskrypcji, która już się skończyła.
        const row: SubscriptionData = kind === "canceled" ? { ...data, status: "canceled" } : data;
        const created = await insertSubscriptionRow(row, env, mark);
        if (created.outcome === "invalid") return "processed";
        if (created.outcome === "inserted") {
          // Nagrobek nie ma czego anulować - uprawnienia nigdy nie nadano.
          if (kind !== "canceled") {
            await applyCreationEffects(row, env, created.source, grantsAccess);
          }
          return "processed";
        }
        // Przegrany wyścig: równoległe zdarzenie założyło wiersz między
        // strażnikiem a wstawieniem. Rozstrzygamy od nowa (świeże / remis /
        // spóźnione) - wstawienie niczego nie nadpisało.
        if (attempt >= GUARD_MAX_ATTEMPTS) {
          throw new Error(`subscription event guard: contention (${data.id})`);
        }
        continue;
      }

      // Remis w obrębie sekundy: stan z API operatora, nie z ładunku. Wiersz
      // już jest, więc skutki założenia wykonało zdarzenie, które go wstawiło
      // - tu tylko odświeżamy stan (także dla `created`).
      case "tie": {
        const current = await authoritativeSubscription(data.id, env);
        if (current.status === "canceled") await handleCanceled(current, env, grantsAccess);
        else await handleUpdated(current, env, mark, grantsAccess);
        return "processed";
      }

      // `fresh`, `replay` (ponowienie po porażce skutków), `untimed`.
      default:
        if (kind === "created") await handleCreated(data, env, grantsAccess);
        else if (kind === "canceled") await handleCanceled(data, env, grantsAccess);
        else await handleUpdated(data, env, mark, grantsAccess);
        return "processed";
    }
  }
}

export async function dispatchWebhookEvent(input: DispatchInput): Promise<DispatchOutcome> {
  const { eventType, environment: env, occurredAt } = input;
  const subscriptionKind = subscriptionEventKind(eventType);

  // IZOLACJA ŚRODOWISK (PAY-05). Na wdrożeniu produkcyjnym zdarzenie
  // piaskownicy (karta testowa) nie może nadać niczego realnego - a
  // `metadata.userId` subskrypcji testowej potrafi wskazać prawdziwe konto,
  // `user_subscriptions` zaś nie zna środowisk. Zostaje WYŁĄCZNIE ślad
  // księgowy subskrypcji (wiersz `subscriptions` z `environment = 'sandbox'`
  // i parą strażnika), po którym sonda nocna i diagnostyka widzą, że webhook
  // piaskownicy żyje. Każdy inny typ (realizacja zamówienia, windykacja,
  // dokument, korekta, dane klienta, darowizna) kończy się `skipped`, zanim
  // dotknie bazy.
  const grantsAccess = environmentGrantsAccess(env);
  if (!grantsAccess) {
    const bookkeeping =
      subscriptionKind !== null && !isDonationSubscription(input.data as SubscriptionData);
    console.warn("[payments] sandbox event on production deployment", {
      eventId: input.eventId ?? null,
      eventType,
      environment: env,
      handling: bookkeeping ? "bookkeeping_only" : "skipped",
    });
    if (!bookkeeping) return "skipped";
  }

  if (eventType.startsWith("subscription.")) {
    const sub = input.data as SubscriptionData;
    if (isDonationSubscription(sub)) {
      await handleDonationSubscription(
        sub,
        eventType === "subscription.canceled" ? "canceled" : (sub.status ?? "active"),
      );
      return "processed";
    }
  }

  if (subscriptionKind) return handleSubscriptionEvent(subscriptionKind, input, grantsAccess);

  switch (eventType) {
    // Nieudane obciążenie: operator sygnalizuje je dwoma zdarzeniami
    // (`payment_failed` przy odrzuceniu, `past_due` przy wejściu transakcji w
    // zaległość). Obsługa jest ta sama, a warstwa windykacji odsiewa duplikat
    // po identyfikatorze transakcji, więc mail idzie dokładnie raz.
    case "transaction.payment_failed":
    case "transaction.past_due":
      await handleTransaction(input.data as TransactionData, env, occurredAt, "failed");
      return "processed";
    case "transaction.completed": {
      const txn = input.data as TransactionData;
      await handleTransaction(txn, env, occurredAt, "paid");
      // Dokument PO realizacji (PAY-12): właściciela zakupu jednorazowego
      // ustala zamówienie po `provider_intent_id`, które stempluje dopiero
      // realizacja - zapis przed nią nie znajdował właściciela i zakup nie
      // dostawał dokumentu nigdy. Pierwsza sesja Checkout subskrypcji
      // dokumentu NIE zakłada: rozliczeniem jest faktura (`in_...`), którą
      // zapisze jej własne `invoice.paid` - inaczej obok faktury wisiałby
      // fantom `cs_...`.
      if (!(txn.source === "checkout_session" && txn.subscriptionId)) {
        await recordDocument(input.data, env, "completed");
      }
      return "processed";
    }
    // Porzucona sesja Checkout: zamówienie się zamyka, a rezerwacja kuponu
    // wraca do puli - inaczej limitowany kod wyczerpują same porzucone kasy.
    case "transaction.expired": {
      const { expireCheckoutOrder } = await import("@/lib/billing/oneTimeFulfilment.server");
      const txn = input.data as TransactionData;
      const expired = await expireCheckoutOrder(
        {
          id: txn.id,
          amountCents: amountFromTransaction(txn),
          currency: txn.currencyCode ?? null,
          customerEmail: txn.customer?.email ?? null,
          customData: txn.customData ?? null,
          sessionId: txn.id,
          paymentIntentId: txn.paymentIntentId ?? null,
          customerId: txn.customerId ?? null,
        },
        env,
      );
      return expired ? "processed" : "skipped";
    }
    // Operator nadaje numer faktury i domyka kwoty osobnym zdarzeniem - bez
    // niego dokument w panelu klienta zostałby bez numeru.
    case "transaction.updated":
      return (await recordDocument(input.data, env)) ? "processed" : "skipped";
    case "adjustment.created":
    case "adjustment.updated":
      await handleAdjustment(input.data as Record<string, unknown>, env);
      return "processed";
    // Zmiany danych klienta u operatora (e-mail, adres, dane firmy) wracają do
    // profilu rozliczeniowego - inaczej faktury i stawka podatku rozjeżdżają się.
    case "customer.updated": {
      const { syncCustomerProfile } = await import("@/lib/billing/customerSync.server");
      await syncCustomerProfile(input.data, env);
      return "processed";
    }
    case "address.updated": {
      const { syncCustomerAddress } = await import("@/lib/billing/customerSync.server");
      await syncCustomerAddress(input.data, env);
      return "processed";
    }
    case "business.updated": {
      const { syncCustomerBusiness } = await import("@/lib/billing/customerSync.server");
      await syncCustomerBusiness(input.data, env);
      return "processed";
    }
    default:
      return "skipped";
  }
}
