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
import { planChangeDirection } from "@/lib/billing/catalog";
import {
  accessPeriodFromEvent,
  isDelinquentSubscriptionStatus,
  isEntitledSubscriptionStatus,
} from "@/lib/billing/accessPeriod";
import type { StripeEnv } from "@/lib/stripe.server";
import type { PremiumNewsletterConsentGrant } from "@/lib/billing/premiumNewsletter";

export type SubscriptionData = {
  id: string;
  customerId: string;
  /**
   * Status ZNORMALIZOWANY: pauza poboru (`pause_collection`) przy statusie
   * operatora `active` przychodzi tu jako `paused` (`stripeEvents.server`).
   */
  status: string;
  customData?: {
    userId?: string;
    purpose?: string;
    donationId?: string;
    /** Zgoda z pola w checkoucie (metadane subskrypcji) - brak = pole niezaznaczone. */
    newsletterConsent?: PremiumNewsletterConsentGrant | null;
  } | null;
  currentBillingPeriod?: { startsAt?: string; endsAt?: string } | null;
  /** Zaplanowana rezygnacja (`cancel_at_period_end` albo `cancel_at` u operatora). */
  scheduledChange?: { action?: string; effectiveAt?: string | null } | null;
  /**
   * `cancellation_details.reason` operatora: `payment_failed` /
   * `payment_disputed` (koniec windykacji) albo `cancellation_requested`.
   */
  cancellationReason?: string | null;
  /**
   * Surowa pauza poboru. `behavior` (`void` / `keep_as_draft` /
   * `mark_uncollectible`) trafia do `subscriptions.pause_collection_behavior`:
   * wznowienie takiej pauzy to `pause_collection: null`, a statusu `paused`
   * bez niej - `subscriptions.resume`.
   */
  pauseCollection?: { behavior: string; resumesAt: string | null } | null;
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
  /** Numer próby obciążenia faktury (`invoice.attempt_count`) - klucz windykacji. */
  attemptCount?: number | null;
  /** Termin kolejnej próby (`invoice.next_payment_attempt`) - do maila windykacji. */
  nextPaymentAttemptAt?: string | null;
};

/** Wynik obsługi: `skipped` = zdarzenie spoza zakresu integracji. */
export type DispatchOutcome = "processed" | "skipped";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function readIds(data: SubscriptionData) {
  const item = data.items?.[0];
  return {
    priceId: item?.price?.externalId ?? null,
    productId: item?.product?.externalId ?? null,
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
 * Znacznik porządkowy `subscription.created`: sekunda zdarzenia MINUS 1 ms.
 *
 * Operator stempluje zdarzenia z dokładnością do SEKUNDY, a `created` i
 * pierwsze `updated` (incomplete -> active po 3DS) lądują zwykle w tej samej
 * sekundzie. Przy równych znacznikach strażnik (`<`) odrzucał `updated`
 * dostarczone PO `created` - płacący zostawał w `incomplete`, czyli bez
 * dostępu. `created` jest z definicji najstarszym stanem subskrypcji, więc
 * każde inne zdarzenie z tej samej sekundy musi z nim wygrać - w obie strony
 * dostawy (późne `created` przegrywa z zapisanym `updated` tak samo).
 */
function createdEventStamp(occurredAt: string | null | undefined): string | null {
  const stamp = eventStamp(occurredAt);
  return stamp ? new Date(Date.parse(stamp) - 1).toISOString() : null;
}

/**
 * Strażnik kolejności zdarzeń subskrypcji.
 *
 * Operator nie gwarantuje kolejności dostarczenia, a ponowna dostawa starego
 * zdarzenia potrafi cofnąć stan (np. `past_due` po `activated`). Kolumna
 * `last_event_at` przechowuje znacznik NAJŚWIEŻSZEGO zastosowanego zdarzenia;
 * warunkowy UPDATE (`last_event_at < occurredAt`) jest atomowy, więc dwa
 * równoległe zdarzenia nie przeskoczą się nawzajem.
 *
 * @param stamp znacznik z `eventStamp` (albo `createdEventStamp`); `null` =
 *        brak wiarygodnego czasu - nie blokujemy.
 * @returns `true` gdy zdarzenie jest świeższe niż zapisany stan (lub wiersza
 *          jeszcze nie ma - wtedy przetwarzamy, bo to ścieżka zakładania).
 */
async function claimSubscriptionEvent(
  subscriptionId: string,
  env: StripeEnv,
  stamp: string | null,
): Promise<boolean> {
  if (!stamp) return true; // brak wiarygodnego czasu - nie blokujemy

  const supabase = await admin();
  const { data: claimed, error } = await supabase
    .from("subscriptions")
    .update({ last_event_at: stamp })
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .or(`last_event_at.is.null,last_event_at.lt.${stamp}`)
    .select("id");
  if (error) throw new Error(`subscription event claim failed: ${error.message}`);
  if (claimed && claimed.length > 0) return true;

  // Zero zaktualizowanych wierszy: albo subskrypcji jeszcze nie ma (zdarzenie
  // wyprzedziło `created`), albo zapisany stan jest nowszy.
  const { data: exists, error: existsErr } = await supabase
    .from("subscriptions")
    .select("id")
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();
  if (existsErr) throw new Error(`subscription lookup failed: ${existsErr.message}`);
  return !exists;
}

/**
 * Zwolnienie zajęcia po błędzie obsługi.
 *
 * Strażnik stempluje `last_event_at` PRZED obsługą, a operator ponawia
 * zdarzenie, które padło - z TYM SAMYM znacznikiem. Bez zwolnienia ponowienie
 * odbijało się od strażnika (`last_event_at < stamp` fałszywe) i kończyło jako
 * `skipped`: płatność pobrana, uprawnienia brak aż do następnego zdarzenia.
 * Cofamy znacznik o 1 ms - wyłącznie jeśli wciąż jest nasz - więc ponowienie
 * przejdzie, a każde zdarzenie starsze od naszego nadal jest odrzucane.
 * Nigdy nie rzuca: błąd obsługi, który tu trafił, jest ważniejszy.
 */
async function releaseSubscriptionEvent(
  subscriptionId: string,
  env: StripeEnv,
  stamp: string | null,
): Promise<void> {
  if (!stamp) return;
  try {
    const supabase = await admin();
    const { error } = await supabase
      .from("subscriptions")
      .update({ last_event_at: new Date(Date.parse(stamp) - 1).toISOString() })
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .eq("last_event_at", stamp);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error("[payments] subscription event release failed", subscriptionId, err);
  }
}

/** Obsługa pod zajęciem strażnika: błąd zwalnia zajęcie, żeby ponowienie przeszło. */
async function underClaim<T>(
  subscriptionId: string,
  env: StripeEnv,
  stamp: string | null,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    await releaseSubscriptionEvent(subscriptionId, env, stamp);
    throw err;
  }
}

/**
 * Atomowe zajęcie potwierdzenia zakupu (`purchase_confirmed_at`): `true`
 * DOKŁADNIE raz na subskrypcję. Wołane PO zapisie uprawnienia
 * (`applyPurchaseEffects`), więc awaria zapisu go nie zużywa, a dwa
 * równoległe zdarzenia (oba widzą poprzedni stan `incomplete`) nie wyślą
 * potwierdzenia dwa razy.
 */
async function claimPurchaseConfirmation(subscriptionId: string, env: StripeEnv): Promise<boolean> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("subscriptions")
    .update({ purchase_confirmed_at: new Date().toISOString() })
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .is("purchase_confirmed_at", null)
    .select("id");
  if (error) throw new Error(`purchase confirmation claim failed: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Wynik zakładania wiersza: `exists` = wiersz już był (nic nie zapisano). */
type CreateOutcome = "inserted" | "exists" | "invalid";

/**
 * Zakłada wiersz subskrypcji WYŁĄCZNIE, gdy go jeszcze nie ma.
 *
 * DLACZEGO NIE UPSERT. Zwykły upsert nadpisywał istniejący wiersz stanem
 * zdarzenia BEZ strażnika kolejności: spóźnione albo ponowione `created`
 * (`incomplete`) po `updated` (`active`) cofało status i przesuwało
 * `last_event_at` wstecz, a `incomplete` mapuje się na brak dostępu - płacący
 * tracił uprawnienie (audyt SUB-02). PostgREST nie dokłada warunku do
 * `ON CONFLICT DO UPDATE`, więc zapis jest dwuetapowy: tu `ON CONFLICT DO
 * NOTHING` (`ignoreDuplicates`), a gdy wiersz już był, wołający przepuszcza
 * zdarzenie przez `claimSubscriptionEvent` i stosuje je jak aktualizację.
 *
 * Efekty zakupu (mail, CRM, newsletter, dzwonek) idą tylko w stanie
 * `active|trialing` i tylko raz - po atomowym zajęciu `purchase_confirmed_at`
 * (`claimPurchaseConfirmation`), które następuje dopiero po zapisie
 * uprawnienia.
 *
 * @param stamp znacznik porządkowy zdarzenia (`created` -> `createdEventStamp`).
 */
async function handleCreated(
  data: SubscriptionData,
  env: StripeEnv,
  stamp: string | null,
): Promise<CreateOutcome> {
  const userId = data.customData?.userId;
  const { priceId, productId, quantity, trialEndsAt } = readIds(data);
  if (!userId) {
    console.error("[payments] missing customData.userId", data.id);
    return "invalid";
  }
  if (!priceId || !productId) {
    console.warn("[payments] missing lookup_key/metadata.lovable_external_id", data.id);
    return "invalid";
  }

  const supabase = await admin();
  const nowIso = new Date().toISOString();
  // Wiersz zakładany przez zdarzenie zaległości (wyprzedziło `created`):
  // kotwica karencji to chwila tego zdarzenia, nie „nigdy".
  const firstPaymentFailedAt = isDelinquentSubscriptionStatus(data.status)
    ? (stamp ?? nowIso)
    : null;
  const cancelAtPeriodEnd = data.scheduledChange?.action === "cancel";
  const { data: inserted, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
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
        cancel_at_period_end: cancelAtPeriodEnd,
        pause_collection_behavior: data.pauseCollection?.behavior ?? null,
        first_payment_failed_at: firstPaymentFailedAt,
        environment: env,
        // Znacznik ostatniego zastosowanego zdarzenia - podstawa strażnika
        // kolejności przy późniejszych aktualizacjach. Czas nie do odczytania
        // pomijamy: strażnik przepuścił takie zdarzenie świadomie, więc zapis
        // nie ma prawa się na nim wywrócić (kolumna zostaje pusta, a następne
        // zdarzenie z poprawnym czasem i tak ją zajmie).
        ...(stamp ? { last_event_at: stamp } : {}),
        updated_at: nowIso,
      },
      { onConflict: "provider_subscription_id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
  if (!inserted || inserted.length === 0) return "exists";

  const period = accessPeriodFromEvent({
    kind: "created",
    // W trialu dostęp trwa do końca okresu próbnego - dopiero pierwsze
    // obciążenie przesuwa go na pełny cykl rozliczeniowy.
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    status: data.status,
    periodStart: data.currentBillingPeriod?.startsAt ?? null,
    firstPaymentFailedAt,
  });

  // Uprawnienie zawsze (stan operatora wygrywa), potwierdzenie zakupu tylko
  // w stanie uprawniającym i raz - bramkę i zajęcie trzyma `applyPurchaseEffects`.
  const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPurchaseEffects({
    userId,
    priceId,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    environment: env,
    cancelAtPeriodEnd,
    claimConfirmation: () => claimPurchaseConfirmation(data.id, env),
    status: data.status,
    newsletterConsent: data.customData?.newsletterConsent ?? null,
  });

  // Plan Zespół: liczba opłaconych miejsc ustala limit organizacji.
  const { applySubscriptionSeats } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });
  return "inserted";
}

/** Stany sprzed pierwszej zapłaty: przejście z nich do `active|trialing` to ZAKUP. */
const PRE_ACTIVATION_STATUSES = new Set(["incomplete"]);

/**
 * Wspólna ścieżka dla wszystkich zdarzeń zmieniających stan subskrypcji:
 * `updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`.
 * Operator wysyła je jako osobne typy, ale ładunek ma identyczny kształt, a
 * autorytatywne jest pole `status` - dlatego obsługa jest jedna i idempotentna.
 *
 * Wołający zajął już zdarzenie strażnikiem kolejności (`stamp`).
 * `fromCreated` = to `subscription.created` stosowane na istniejącym wierszu
 * (ponowienie po błędzie): zakup potwierdzamy, jeśli jeszcze nie wyszedł.
 */
async function handleUpdated(
  data: SubscriptionData,
  env: StripeEnv,
  stamp: string | null,
  opts: { retried?: boolean; fromCreated?: boolean } = {},
): Promise<void> {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity, trialEndsAt } = readIds(data);

  const { data: existing } = await supabase
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at, purchase_confirmed_at",
    )
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  // Kolejność dostarczenia zdarzeń nie jest gwarantowana: `activated` potrafi
  // wyprzedzić `created`. Bez wiersza subskrypcji UPDATE trafiłby w pustkę i
  // zakup przepadłby po cichu - dlatego zakładamy go tą samą ścieżką co przy
  // utworzeniu (wstawienie-jeśli-brak, więc późniejsze `created` niczego nie
  // zdubluje ani nie cofnie).
  if (!existing && data.customData?.userId) {
    const created = await handleCreated(data, env, stamp);
    if (created !== "exists") return;
    // Wyścig z równoległym `created`: wiersz powstał między próbą zajęcia
    // a wstawieniem. Teraz już jest, więc zdarzenie musi przejść strażnika
    // jak każda aktualizacja - i dopiero wtedy zostać zastosowane.
    if (opts.retried) throw new Error(`subscription row vanished during update: ${data.id}`);
    if (!(await claimSubscriptionEvent(data.id, env, stamp))) return;
    await handleUpdated(data, env, stamp, { ...opts, retried: true });
    return;
  }

  const entitled = isEntitledSubscriptionStatus(data.status);
  // Kotwica karencji: PIERWSZA porażka cyklu. Wejście w zaległość ją ustawia
  // (jeśli windykacja jeszcze tego nie zrobiła), powrót do rozliczeń ją
  // zeruje, a stany obok (pauza, anulowanie) zostawiają bez zmian.
  const firstPaymentFailedAt = isDelinquentSubscriptionStatus(data.status)
    ? (existing?.first_payment_failed_at ?? stamp ?? new Date().toISOString())
    : entitled
      ? null
      : (existing?.first_payment_failed_at ?? null);

  // Zdarzenia stanu (pauza, wznowienie, past_due) bywają bez okresu
  // rozliczeniowego - wtedy zapisana data końca dostępu musi zostać nietknięta.
  // Przy zaległości dostęp kończy karencja, nie (przesunięty już) okres.
  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: data.status,
    periodStart: data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null,
    firstPaymentFailedAt,
  });
  const cancelAtPeriodEnd = data.scheduledChange?.action === "cancel";

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
      cancel_at_period_end: cancelAtPeriodEnd,
      // Pauza poboru: sposób wznowienia zależy od tego, czym ją ustawiono.
      pause_collection_behavior: data.pauseCollection?.behavior ?? null,
      first_payment_failed_at: firstPaymentFailedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions update failed: ${error.message}`);

  // Zdarzenia stanu (pauza, wznowienie, past_due) potrafią nie nieść pozycji
  // cennika - wtedy pracujemy na cenie zapisanej przy subskrypcji.
  const priceId = eventPriceId ?? existing?.price_id ?? null;

  // Plan Zespół: zmiana liczby opłaconych miejsc oraz stanu subskrypcji musi
  // natychmiast przełożyć się na limit i uprawnienia całego zespołu - z tą
  // samą karencją przy zaległości co dla uprawnienia indywidualnego.
  const { applySubscriptionSeats, applySubscriptionOrgState } =
    await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: data.id,
    status: data.status,
    priceId,
    accessUntil: period.accessUntil,
  });
  await applySubscriptionSeats({ subscriptionId: data.id, quantity, priceId });

  if (!existing?.user_id || !priceId) return;

  // Pierwsza zapłata subskrypcji założonej jako `incomplete` (3DS, przelew):
  // dopiero TERAZ jest zakup - mail, CRM, newsletter i dzwonek idą raz
  // (zajęcie `purchase_confirmed_at`), a uprawnienie synchronizuje ta sama
  // ścieżka co przy wstawieniu.
  const activates =
    entitled &&
    !existing.purchase_confirmed_at &&
    (opts.fromCreated || PRE_ACTIVATION_STATUSES.has(existing.status ?? ""));
  if (activates) {
    const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
    await applyPurchaseEffects({
      userId: existing.user_id,
      tenantId: existing.tenant_id ?? null,
      priceId,
      subscriptionId: data.id,
      periodEnd: period.accessUntil,
      environment: env,
      cancelAtPeriodEnd,
      claimConfirmation: () => claimPurchaseConfirmation(data.id, env),
      status: data.status,
    });
    return;
  }

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
      cancelAtPeriodEnd,
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
    status: data.status,
    cancelAtPeriodEnd,
  });
}

async function handleCanceled(data: SubscriptionData, env: StripeEnv) {
  const supabase = await admin();
  const { data: existing } = await supabase
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, current_period_start, current_period_end, first_payment_failed_at",
    )
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      trial_ends_at: null,
      pause_collection_behavior: null,
      updated_at: new Date().toISOString(),
    })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  // Rezygnacja klienta: dostęp do końca opłaconego okresu. Koniec windykacji
  // (`payment_failed` / `payment_disputed`): okres nigdy nie został opłacony,
  // więc dostęp kończy karencja od pierwszej nieudanej płatności - a gdy ta
  // już minęła, dostępu nie ma wcale.
  const canceledPeriod = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: "canceled",
    cancellationReason: data.cancellationReason ?? null,
    periodStart: data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null,
    firstPaymentFailedAt: existing?.first_payment_failed_at ?? null,
  });

  if (!existing?.user_id || !existing.price_id) return;

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
      await markOneTimePaymentFailed(data.customData ?? null);
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

  const ctx = {
    subscriptionId: data.subscriptionId,
    environment: env,
    occurredAt,
    amountCents: amountFromTransaction(data),
    currency: data.currencyCode ?? null,
    // Klucz deduplikacji windykacji: faktura + numer próby. Ponowienia jednej
    // faktury mają ten sam identyfikator, więc dopiero `attempt_count`
    // odróżnia kolejną porażkę od powtórki zdarzenia o tej samej próbie.
    transactionId: data.id,
    attemptCount: data.attemptCount ?? null,
    // Termin kolejnej próby obciążenia - trafia do maila o nieudanej płatności.
    retryAt: data.nextPaymentAttemptAt ?? null,
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
    amountCents: Number.isFinite(amountCents) ? amountCents : null,
    capturedAmountCents: Number.isFinite(capturedCents) ? capturedCents : null,
    currency: str("currencyCode") ?? totals?.currencyCode ?? null,
    environment: env,
  });
}

/**
 * Zapis faktury dla transakcji. Zwraca `true`, gdy coś faktycznie zapisano -
 * `transaction.updated` bez zmian traktujemy jako pominięte zdarzenie.
 */
async function recordDocument(data: unknown, env: StripeEnv): Promise<boolean> {
  const { documentInputFromTransaction, recordTransactionDocument } =
    await import("@/lib/billing/billingDocuments.server");
  const input = documentInputFromTransaction(data, env);
  if (!input) return false;
  const outcome = await recordTransactionDocument(input).catch((e: unknown) => {
    console.error("[payments] billing document failed", input.transactionId, e);
    return "skipped" as const;
  });
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
  "adjustment.created",
  "adjustment.updated",
  "customer.updated",
  "address.updated",
  "business.updated",
] as const;

export interface DispatchInput {
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

export async function dispatchWebhookEvent(input: DispatchInput): Promise<DispatchOutcome> {
  const { eventType, environment: env, occurredAt } = input;

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

  switch (eventType) {
    case "subscription.created": {
      const sub = input.data as SubscriptionData;
      const stamp = createdEventStamp(occurredAt);
      return underClaim(sub.id, env, stamp, async () => {
        const created = await handleCreated(sub, env, stamp);
        if (created !== "exists") return "processed";
        // Wiersz już jest: powtórka `created` (np. ponowienie po błędzie, które
        // zwolniło zajęcie) albo nowsze zdarzenie stanu, które je wyprzedziło.
        // `created` niesie NAJSTARSZY stan subskrypcji, więc stosujemy go
        // wyłącznie przez tego samego strażnika kolejności co każdą
        // aktualizację - przy nowszym zapisie nie zmienia niczego. Bez
        // wiarygodnego czasu nie da się tego rozstrzygnąć, a zgadywanie
        // cofnęłoby stan: istniejący wiersz zostaje nietknięty.
        if (!stamp || !(await claimSubscriptionEvent(sub.id, env, stamp))) return "skipped";
        await handleUpdated(sub, env, stamp, { fromCreated: true });
        return "processed";
      });
    }
    // Wszystkie zdarzenia zmiany stanu subskrypcji dzielą jedną obsługę -
    // operator wysyła je jako osobne typy, ale autorytatywny jest `status`.
    case "subscription.updated":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.imported": {
      const sub = input.data as SubscriptionData;
      const stamp = eventStamp(occurredAt);
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji.
      if (!(await claimSubscriptionEvent(sub.id, env, stamp))) return "skipped";
      await underClaim(sub.id, env, stamp, () => handleUpdated(sub, env, stamp));
      return "processed";
    }
    case "subscription.canceled": {
      const sub = input.data as SubscriptionData;
      const stamp = eventStamp(occurredAt);
      if (!(await claimSubscriptionEvent(sub.id, env, stamp))) return "skipped";
      await underClaim(sub.id, env, stamp, () => handleCanceled(sub, env));
      return "processed";
    }
    // Nieudane obciążenie: operator sygnalizuje je dwoma zdarzeniami
    // (`payment_failed` przy odrzuceniu, `past_due` przy wejściu transakcji w
    // zaległość). Obsługa jest ta sama, a warstwa windykacji odsiewa duplikat
    // po identyfikatorze transakcji, więc mail idzie dokładnie raz.
    case "transaction.payment_failed":
    case "transaction.past_due":
      await handleTransaction(input.data as TransactionData, env, occurredAt, "failed");
      return "processed";
    case "transaction.completed":
      await recordDocument(input.data, env);
      await handleTransaction(input.data as TransactionData, env, occurredAt, "paid");
      return "processed";
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
