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
import {
  accessPeriodFromEvent,
  effectiveCancellationReason,
  isDelinquentSubscriptionStatus,
  isEntitledSubscriptionStatus,
  isNonPaymentCancellation,
  isPreActivationSubscriptionStatus,
  paymentGraceAnchor,
} from "@/lib/billing/accessPeriod";
import type { UnmirroredPlanSubscriptionInput } from "@/lib/billing/duplicateSubscriptionAlert.server";
import type { OneTimeOutcome } from "@/lib/billing/oneTimeFulfilment.server";
import type { PremiumNewsletterConsentGrant } from "@/lib/billing/premiumNewsletter";
import type { AnnouncementQueue } from "@/lib/billing/purchaseEffects.server";
import type { AdjustmentAction } from "@/lib/billing/refunds.server";
import type { AppliedUpgradeCancelDateOutcome } from "@/lib/billing/subscriptionProvider.server";
import { environmentGrantsAccess, type StripeEnv } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";

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
  /**
   * Skąd pochodzi transakcja: sesja Checkout (`cs_...`) albo faktura
   * (`in_...`). Faktura subskrypcji niesie metadane subskrypcji, w tym
   * `orderId` - domknięcie zamówienia idempotentnie domyka pierwsza opłacona
   * faktura (trial), a windykacja dotyczy wyłącznie faktur. Ładunek sprzed
   * wdrożenia nie ma tego pola - patrz `transactionSource`.
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
  /** Numer próby obciążenia faktury (`invoice.attempt_count`) - klucz windykacji. */
  attemptCount?: number | null;
  /** Termin kolejnej próby (`invoice.next_payment_attempt`) - do maila windykacji. */
  nextPaymentAttemptAt?: string | null;
  /**
   * `invoice.billing_reason` operatora (`subscription_cycle`, `subscription_create`,
   * `subscription_update`, ...). Brak = nieznany (sesja checkout, stary dziennik).
   */
  billingReason?: string | null;
  /** Chwila zapłaty faktury u operatora (ISO) - data raty darowizny cyklicznej. */
  billedAt?: string | null;
  /**
   * Czy faktura obciąża za CAŁY okres (pozycja subskrypcji bez proraty,
   * `invoiceFullPeriodStart`) - dopłata za zmianę interwału otwiera nim nowy
   * okres. Brak = nieznane (stary dziennik) - jak zwykła dopłata.
   */
  chargesFullPeriod?: boolean | null;
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
 * tylko strażnik, a zapis `created` wywracał się na `Invalid time value`.
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
 * sekundzie. `created` jest z definicji najstarszym stanem subskrypcji, więc
 * każde inne zdarzenie z tej samej sekundy musi z nim wygrać - w obie strony
 * dostawy (późne `created` przegrywa z zapisanym `updated` jako `stale`),
 * bez remisu i bez odczytu stanu u operatora (SUB-02). Powtórka `created`
 * niesie ten sam znacznik i identyfikator, więc nadal jest `replay`.
 */
function createdEventStamp(occurredAt: string | null | undefined): string | null {
  const stamp = eventStamp(occurredAt);
  return stamp ? new Date(Date.parse(stamp) - 1).toISOString() : null;
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
 * Zajęcie zdarzenia DOKŁADNIE w postaci, w jakiej leży w wierszu: znacznik
 * i wartość `last_event_id` (po remisie `tie:<id>`). Zapis stanu subskrypcji
 * jest warunkowy względem tej pary (PAY-02 / PAY-10, 1.0) - `null` to
 * zdarzenie bez wiarygodnego czasu, które strażnik przepuścił bez zajęcia.
 */
interface EventClaim {
  stamp: string;
  id: string | null;
}

/**
 * Najwcześniejsza z dwóch chwil (ISO) - próg deduplikacji dzwonka założenia:
 * `created` i zdarzenie stanu, które je wyprzedziło, opisują TO SAMO założenie
 * subskrypcji, więc oba szukają dzwonka od początku pierwszego okresu.
 */
function earliestIso(...values: Array<string | null | undefined>): string | null {
  const times = values
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
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
 * ZAJĘCIE PORZĄDKUJE ZAJĘCIA, NIE SKUTKI (1.0). Skutki dwóch zajętych zdarzeń
 * biegną równolegle, a zapis uprawnienia starszego potrafi wylądować PO
 * zapisie nowszego. Dlatego stan subskrypcji zapisuje się NA KOŃCU, warunkiem
 * na własne zajęcie (`commitSubscriptionState`); gdy nowsze zdarzenie zdążyło
 * je przejąć, starsze wyrównuje uprawnienie do stanu z API operatora
 * (`resyncFromProvider`) zamiast zostawić własny, starszy zapis. To samo robi
 * zdarzenie `stale`: jego wcześniejsza próba mogła zapisać uprawnienie i paść,
 * zanim się wyrównała (patrz `handleSubscriptionEvent`).
 *
 * KOMUNIKATY PO ZAPISIE STANU. Mail, dzwonek i CRM czekają w kolejce
 * (`AnnouncementQueue`) na udany zapis stanu i dopiero wtedy wychodzą. Klient
 * słyszy więc wyłącznie o przejściach między stanami ZAPISANYMI po kolei:
 * nowsze zdarzenie czyta stan poprzedni po własnym zajęciu, a wcześniejszy
 * zapis stanu jest możliwy tylko przed tym zajęciem.
 *
 * DLACZEGO IDENTYFIKATOR. Para leży w wierszu PRZED skutkami, więc gdy skutki
 * padną, wiersz zostaje z tą samą parą. Bez identyfikatora ponowna dostawa
 * widziała równy znacznik i kończyła się `skipped`: klient tracił dostęp po
 * odnowieniu, bo jednorazowy błąd zapisu uprawnienia zamieniał się w zdarzenie
 * zgubione na zawsze. Z identyfikatorem to `replay` - skutki biegną jeszcze
 * raz (są idempotentne), a że stan subskrypcji czeka na koniec skutków,
 * powtórka widzi POPRZEDNI status i cenę, więc przejścia (pauza, wznowienie,
 * zmiana planu) nie giną (1.3).
 *
 * REMIS. Stripe podaje czas z rozdzielczością sekundy, więc dwa różne
 * zdarzenia jednej operacji (upgrade i cofnięcie zaplanowanej rezygnacji,
 * zwolnienie harmonogramu i nowa cena) mają często ten sam znacznik. Żadnego
 * z nich nie wolno po cichu porzucić, a który ładunek jest nowszy - nie
 * wiadomo. Wygrywa więc AUTORYTATYWNY stan z API operatora (patrz
 * `authoritativeSubscription`). `created` remisu z pierwszym `updated` nie
 * robi: jego znacznik to sekunda minus 1 ms (`createdEventStamp`, SUB-02).
 * Porównanie ładunku z wierszem („zdarzenie niczego nie zmienia - powtórka")
 * tu nie wystarcza: stan wiersza zapisuje się dopiero PO skutkach, więc wiersz
 * w trakcie cudzych skutków pokazuje jeszcze stan sprzed nich. Powtórkę
 * rozpoznaje identyfikator zdarzenia.
 *
 * BEZ ZWALNIANIA ZAJĘCIA. Cofanie `last_event_at` o 1 ms po błędzie obsługi
 * (SUB-02, #495) zastępuje tu `replay`: para zostaje w wierszu, a ponowienie
 * TEGO SAMEGO zdarzenia przechodzi całą obsługę jeszcze raz. Cofnięty
 * znacznik zrównałby się zresztą ze znacznikiem `created` tej samej sekundy
 * i zrobił z niego remis, a zapis stanu warunkiem na parę (`commitSubscriptionState`)
 * nie trafiłby już we własne zajęcie.
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
 * Czy błąd operatora to „nie ma takiego obiektu" (`resource_missing`) -
 * np. subskrypcja usunięta razem z danymi testowymi piaskownicy.
 */
function isResourceMissing(err: unknown): boolean {
  const failure = err as { code?: unknown; raw?: { code?: unknown } } | null;
  return (failure?.code ?? failure?.raw?.code) === "resource_missing";
}

/**
 * Stan subskrypcji z API operatora - rozstrzyga remis w obrębie sekundy
 * (`tie`) i wyrównuje uprawnienie po wyparciu przez nowsze zdarzenie
 * (`resync`, patrz `resyncFromProvider`). Klient środowiska ZDARZENIA
 * (piaskownica nie czyta produkcji).
 *
 * Kolejność jest stała: najpierw odczyt, potem zastosowanie, a porażka odczytu
 * to wyjątek (trasa odpowiada 500, operator ponawia, a ponowienie znów trafi
 * w remis - kolumna niesie `tie:`). Zastosowanie ładunku „na wszelki wypadek"
 * mogłoby cofnąć stan do starszego z dwóch zdjęć tej samej sekundy.
 * Produkt jest rozwijany, żeby mapowanie znało jego czytelny identyfikator.
 *
 * @returns `null`, gdy operator tej subskrypcji nie zna (`resource_missing`) -
 *          nie ma czego stosować, a wyjątek skazałby zdarzenie na ponowienia
 *          bez końca.
 */
async function authoritativeSubscription(
  subscriptionId: string,
  env: StripeEnv,
  purpose: "tie" | "resync" = "tie",
): Promise<SubscriptionData | null> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  let remote: unknown;
  try {
    const stripe = await getStripeClient(env);
    remote = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    });
  } catch (err) {
    if (isResourceMissing(err)) {
      console.warn(`[payments] subscription ${purpose}: unknown at provider`, subscriptionId);
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `subscription ${purpose}: provider read failed (${subscriptionId}): ${message}`,
    );
  }
  const { mapStripeSubscription } = await import("@/lib/billing/stripeEvents.server");
  return mapStripeSubscription(remote as Record<string, unknown>);
}

/**
 * Pola wiersza `subscriptions` z ładunku albo `null`, gdy brakuje powiązań.
 *
 * @param stamp znacznik zdarzenia - kotwica karencji wiersza zakładanego przez
 *        zdarzenie zaległości (wyprzedziło `created`): od tej chwili, nie „nigdy".
 */
function subscriptionRowFrom(data: SubscriptionData, env: StripeEnv, stamp: string | null = null) {
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
  const firstPaymentFailedAt = isDelinquentSubscriptionStatus(data.status)
    ? (stamp ?? new Date().toISOString())
    : null;
  return {
    userId,
    priceId,
    quantity,
    trialEndsAt,
    firstPaymentFailedAt,
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
      cancel_at_period_end: data.scheduledChange?.action === "cancel",
      // Pauza poboru: sposób wznowienia zależy od tego, czym ją ustawiono (SUB-14).
      pause_collection_behavior: data.pauseCollection?.behavior ?? null,
      first_payment_failed_at: firstPaymentFailedAt,
      environment: env,
      updated_at: new Date().toISOString(),
    },
  };
}

type SubscriptionRowSource = NonNullable<ReturnType<typeof subscriptionRowFrom>>;

/** Kolumny wiersza `subscriptions` zapisywane przez obsługę zdarzenia. */
type SubscriptionPatch = Database["public"]["Tables"]["subscriptions"]["Update"];

/** Właściciel i najemca WIERSZA `subscriptions` (nigdy z ładunku). */
interface RowOwner {
  userId: string | null;
  tenantId: string | null;
}

/**
 * Zakłada wiersz `subscriptions` WYŁĄCZNIE, gdy go nie ma
 * (`ON CONFLICT (provider_subscription_id) DO NOTHING`).
 *
 * Dawny upsert nadpisywał istniejący wiersz razem z `last_event_at`, więc
 * spóźnione `created` (np. po `deleted`) cofało strażnika i wskrzeszało
 * anulowaną subskrypcję. Wstawienie niesie parę strażnika - wiersz od
 * pierwszej chwili zna zdarzenie, którego skutki wystartowały.
 *
 * @returns `outcome`: `inserted` - ten zapis założył wiersz; `exists` -
 *          przegraliśmy wyścig z równoległym zdarzeniem (wołający ponawia
 *          strażnika); `invalid` - właściciel już nie istnieje. `owner` -
 *          właściciel i najemca założonego wiersza z RETURNING (tylko przy
 *          `inserted`).
 */
async function insertSubscriptionRow(
  source: SubscriptionRowSource,
  subscriptionId: string,
  mark: EventMark,
  extra: { purchase_confirmed_at?: string } = {},
): Promise<{ outcome: "inserted" | "exists" | "invalid"; owner: RowOwner | null }> {
  const supabase = await admin();
  const { data: inserted, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        ...source.row,
        ...extra,
        // Czas nie do odczytania pomijamy: strażnik przepuścił takie zdarzenie
        // świadomie, a następne zdarzenie z poprawnym czasem i tak zajmie wiersz.
        ...(mark.stamp ? { last_event_at: mark.stamp, last_event_id: mark.eventId } : {}),
      },
      { onConflict: "provider_subscription_id", ignoreDuplicates: true },
    )
    // `tenant_id` i `user_id` z RETURNING: najemcę przypina trigger z profilu
    // właściciela, więc alarm o drugiej subskrypcji (przy zajęciu potwierdzenia
    // zakupu) nie bierze go z ładunku.
    .select("id, tenant_id, user_id");
  // 23503: konto właściciela usunięte (`user_id` -> `auth.users`). Zdarzenie
  // po zamknięciu konta (np. `deleted` subskrypcji anulowanej przy zamknięciu)
  // nie ma komu zapisać śladu, a wyjątek skazałby je na ponowienia bez końca.
  if (error?.code === "23503") {
    console.warn("[payments] subscription owner no longer exists", subscriptionId);
    return { outcome: "invalid", owner: null };
  }
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
  const row = inserted?.[0];
  if (!row) return { outcome: "exists", owner: null };
  return { outcome: "inserted", owner: { userId: row.user_id, tenantId: row.tenant_id } };
}

/**
 * Zapis stanu subskrypcji - OSTATNI krok obsługi zdarzenia, warunkowy
 * względem jego zajęcia (`last_event_at` + `last_event_id`).
 *
 * Dlaczego na końcu: skutki zależne od POPRZEDNIEGO stanu (przejście pauza ->
 * wznowienie, zmiana planu) czytają go z tego wiersza. Zapis przed skutkami
 * zostawiał powtórce po ich porażce wiersz już w nowym stanie - dzwonek, mail
 * i CRM przejścia nie szły nigdy (1.3 / 5.10 / 6.2).
 *
 * Dlaczego warunkowo: zero trafionych wierszy znaczy, że NOWSZE zdarzenie
 * przejęło wiersz w trakcie naszych skutków (1.0) - jego stan ma wygrać, a my
 * zwracamy `false`, żeby wołający wyrównał uprawnienie do stanu z API.
 * Bez zajęcia (czas nie do odczytania) zapis jest bezwarunkowy, jak dawniej.
 */
async function commitSubscriptionState(
  subscriptionId: string,
  env: StripeEnv,
  claim: EventClaim | null,
  patch: SubscriptionPatch,
  failure: string,
): Promise<boolean> {
  const supabase = await admin();
  let query = supabase
    .from("subscriptions")
    .update(patch)
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env);
  if (claim) {
    query = query.eq("last_event_at", claim.stamp);
    query =
      claim.id === null ? query.is("last_event_id", null) : query.eq("last_event_id", claim.id);
  }
  const { data: written, error } = await query.select("id");
  if (error) throw new Error(`${failure}: ${error.message}`);
  return claim === null || (written ?? []).length > 0;
}

/**
 * Stan organizacji i miejsca planu Zespół (klucz: subskrypcja). Ta sama
 * karencja co dla uprawnienia indywidualnego (`accessUntil`, SUB-03), a przy
 * anulowaniu - powód u operatora (koniec windykacji zostawia dostęp do końca
 * karencji, rezygnacja wstrzymuje zespół od razu). `quantity === null` -
 * liczba miejsc bez zmian (anulowanie zmienia wyłącznie stan organizacji).
 */
async function applyTeamState(input: {
  subscriptionId: string;
  status: string;
  priceId: string | null;
  quantity: number | null;
  accessUntil: string | null;
  cancellationReason?: string | null;
}): Promise<void> {
  const { applySubscriptionSeats, applySubscriptionOrgState } =
    await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: input.subscriptionId,
    status: input.status,
    priceId: input.priceId,
    accessUntil: input.accessUntil,
    ...(input.cancellationReason !== undefined
      ? { cancellationReason: input.cancellationReason }
      : {}),
  });
  if (input.quantity !== null) {
    await applySubscriptionSeats({
      subscriptionId: input.subscriptionId,
      quantity: input.quantity,
      priceId: input.priceId,
    });
  }
}

/**
 * Uprawnienie i miejsca zespołu ze stanu operatora - wspólne dla obsługi
 * zdarzenia i dla wyrównania po wyparciu. Same zapisy zbieżne (stan, nie
 * komunikaty): mail i dzwonek należą do obsługi konkretnego zdarzenia.
 */
async function applyEntitlementFromState(input: {
  subscriptionId: string;
  userId: string;
  tenantId: string | null;
  priceId: string;
  status: string;
  quantity: number | null;
  accessUntil: string | null;
  periodStart: string | null;
  /** Zaplanowana rezygnacja u operatora; brak = wołający jej nie zna. */
  cancelAtPeriodEnd?: boolean;
  /** `cancellation_details.reason` - wyłącznie przy `canceled`. */
  cancellationReason?: string | null;
}): Promise<{ planFound: boolean }> {
  // Plan Zespół: liczba opłaconych miejsc oraz stan subskrypcji muszą
  // natychmiast przełożyć się na limit i uprawnienia całego zespołu.
  await applyTeamState({
    subscriptionId: input.subscriptionId,
    status: input.status,
    priceId: input.priceId,
    quantity: input.quantity,
    accessUntil: input.accessUntil,
    cancellationReason: input.cancellationReason,
  });

  const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
  const plan = await resolvePlanForPrice(input.priceId, {
    tenantId: input.tenantId,
    userId: input.userId,
  });
  if (!plan) return { planFound: false };
  const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
  await syncEntitlementState({
    userId: input.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: input.subscriptionId,
    status: input.status,
    periodEnd: input.accessUntil,
    // S1: uprawnienie `refunded` ożywa wyłącznie dla OPŁACONEGO okresu
    // zaczętego PO korekcie (zaległość w nowym okresie - nie, patrz
    // `mayReviveRefunded`).
    periodStart: input.periodStart,
    ...(input.cancelAtPeriodEnd !== undefined
      ? { cancelAtPeriodEnd: input.cancelAtPeriodEnd }
      : {}),
  });
  return { planFound: true };
}

/**
 * Czy subskrypcja ma już wiersz uprawnienia (`user_subscriptions` po
 * `external_ref`). `limit(1)`, nie `maybeSingle()`: przed indeksem
 * unikalności (`user_subscriptions_external_ref_unique`) klucz bywał
 * zdublowany, a odpowiedź „wiele wierszy" to też „jest".
 */
async function entitlementExists(subscriptionId: string): Promise<boolean> {
  const supabase = await admin();
  const { data, error } = await supabase
    .from("user_subscriptions")
    .select("id")
    .eq("external_ref", subscriptionId)
    .limit(1);
  if (error) throw new Error(`entitlement lookup failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** Kolumny wiersza `subscriptions`, z których liczymy dostęp po rezygnacji. */
const CANCELLATION_ROW_COLUMNS =
  "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at, purchase_confirmed_at, last_payment_at";

interface CancellationRow {
  user_id: string | null;
  tenant_id: string | null;
  price_id: string | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  first_payment_failed_at: string | null;
  purchase_confirmed_at: string | null;
  last_payment_at: string | null;
}

/** Dostęp po rezygnacji - jedna reguła dla obsługi zdarzenia i wyrównania. */
interface CancellationAccess {
  /** Subskrypcja NIGDY nieopłacona: bez dostępu, maila, dzwonka i CRM. */
  neverPaid: boolean;
  /** Koniec windykacji (`payment_failed` / `payment_disputed`), nie rezygnacja. */
  nonPayment: boolean;
  /**
   * Powód, z którym liczymy dostęp i stan zespołu (`effectiveCancellationReason`):
   * powód operatora, a bez niego - wniosek z kotwicy karencji. `null` przy
   * `neverPaid` albo gdy nie ma ani powodu, ani dowodu windykacji.
   */
  cancellationReason: string | null;
  periodStart: string | null;
  /**
   * Kotwica karencji do ZAPISANIA w wierszu (koniec windykacji, a zdarzenia
   * porażek nie dotarły) - inaczej dobowy przebieg zespołów nie miałby od
   * czego liczyć końca tej samej karencji. `null` = nic do zapisania.
   */
  graceAnchor: string | null;
  /** Do kiedy trwa dostęp (`null` = brak dostępu przy `neverPaid`). */
  accessUntil: string | null;
}

/**
 * Dostęp po rezygnacji (SUB-02 / SUB-03).
 *
 * NIGDY NIEOPŁACONA. Porzucone 3DS zostawia wiersz `incomplete` bez
 * potwierdzenia zakupu i bez żadnej zapłaty; jego anulowanie nie jest
 * rezygnacją z opłaconego okresu - bez dostępu (koniec okresu ze zdarzenia to
 * miesiąc albo ROK od checkoutu), maila, dzwonka i CRM „churned". Sygnały
 * naraz: brak potwierdzenia zakupu (`purchase_confirmed_at` - od migracji
 * `subscription_lifecycle_reconcile` NULL jest jednoznaczny), brak
 * zaksięgowanej płatności (`last_payment_at`) i stan sprzed zapłaty. Wiersz
 * już `canceled` z tymi samymi brakami liczy się tak samo: to ponowienie
 * rezygnacji po jej zapisie (`replay` po udanej obsłudze, wyrównanie po
 * wyparciu) - bez tego druga dostawa dawała nigdy nieopłaconej subskrypcji
 * dostęp do końca okresu i mail o rezygnacji.
 *
 * KONIEC WINDYKACJI. Anulowanie za brak płatności daje dostęp WYŁĄCZNIE
 * w karencji od pierwszej nieudanej płatności (a gdy ta minęła - wcale);
 * rezygnacja klienta - do końca opłaconego okresu.
 *
 * ANULOWANIE BEZ POWODU. Gdy operator powodu nie podał (anulowania sprzed
 * `cancellation_details`, stare wersje API), zapisana kotwica karencji bez
 * zapłaty za bieżący okres to koniec windykacji - także kotwica dopisana przez
 * uzgodnienie dawnych anulowań na dowodzie z faktury
 * (`effectiveCancellationReason`). Bez tego kolejne `deleted` bez powodu
 * (przycisk synchronizacji rozliczeń klienta, odtworzenie zdarzenia, remis,
 * wyrównanie po wyparciu) liczyło dostęp jak po rezygnacji i cofało przycięcie
 * do końca nieopłaconego okresu (SUB-03).
 */
function cancellationAccess(
  existing: CancellationRow | null,
  data: SubscriptionData,
): CancellationAccess {
  const neverPaid =
    !!existing &&
    !existing.purchase_confirmed_at &&
    !existing.last_payment_at &&
    (isPreActivationSubscriptionStatus(existing.status) ||
      isPreActivationSubscriptionStatus(data.status) ||
      existing.status === "canceled");
  const periodStart = data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null;
  const cancellationReason = neverPaid
    ? null
    : effectiveCancellationReason({
        reason: data.cancellationReason,
        firstPaymentFailedAt: existing?.first_payment_failed_at ?? null,
        lastPaymentAt: existing?.last_payment_at ?? null,
        periodStart,
      });
  const nonPayment = isNonPaymentCancellation(cancellationReason);
  const graceAnchor = nonPayment
    ? paymentGraceAnchor({
        firstPaymentFailedAt: existing?.first_payment_failed_at ?? null,
        periodStart,
      })
    : null;
  const period = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: "canceled",
    cancellationReason,
    periodStart,
    firstPaymentFailedAt: graceAnchor ?? existing?.first_payment_failed_at ?? null,
  });
  return {
    neverPaid,
    nonPayment,
    cancellationReason,
    periodStart,
    graceAnchor: graceAnchor && !existing?.first_payment_failed_at ? graceAnchor : null,
    accessUntil: neverPaid ? null : period.accessUntil,
  };
}

/**
 * Kotwica karencji stanu nie-końcowego: PIERWSZA porażka cyklu. Wejście
 * w zaległość ją ustawia (jeśli windykacja jeszcze tego nie zrobiła), powrót
 * do rozliczeń ją zeruje, a stany obok (pauza, `incomplete`) zostawiają bez
 * zmian (SUB-03).
 */
function firstPaymentFailureFor(
  status: string,
  stored: string | null,
  stamp: string | null,
): string | null {
  if (isDelinquentSubscriptionStatus(status)) {
    return stored ?? stamp ?? new Date().toISOString();
  }
  return isEntitledSubscriptionStatus(status) ? null : stored;
}

/**
 * Wyrównanie po wyparciu (1.0): nasze skutki mogły nadpisać uprawnienie
 * zapisane przez NOWSZE zdarzenie, które przejęło wiersz w trakcie. Stan
 * bierzemy z API operatora (nie z naszego ładunku i nie z wiersza, którego
 * nowsze zdarzenie mogło jeszcze nie zapisać), właściciela - z NASZEGO wiersza.
 * Wiersza `subscriptions` nie ruszamy: należy do zdarzenia, które go zajęło
 * (także kotwica karencji - liczymy z tej, którą wiersz już ma).
 *
 * Wyłącznie zapisy zbieżne (uprawnienie, organizacja, miejsca) - bez maila
 * i dzwonka. Wyparte zdarzenie niczego klientowi nie ogłosiło (komunikaty
 * czekają na zapis stanu, który się nie udał), a nowsze ogłosiło przejście od
 * stanu zapisanego przed nim - nie ma czego domykać.
 *
 * Porażka odczytu u operatora to wyjątek (zdarzenie `failed`). Ponowienie
 * zobaczy wtedy `stale` i wyrówna stan jeszcze raz (A1/A2) - dawniej `stale`
 * kończyło się `skipped`, a uprawnienie zostawało ze starszego zapisu aż do
 * kolejnego zdarzenia tej subskrypcji. Subskrypcja nieznana operatorowi
 * (`resource_missing`) - nie ma czego wyrównywać.
 */
async function resyncFromProvider(
  subscriptionId: string,
  env: StripeEnv,
  mark: EventMark,
  reason: "superseded" | "stale",
): Promise<void> {
  console.warn("[payments] subscription event out of order - entitlement resynced from provider", {
    subscriptionId,
    eventId: mark.eventId,
    reason,
  });
  const current = await authoritativeSubscription(subscriptionId, env, "resync");
  if (!current) return;

  const supabase = await admin();
  const { data: row, error } = await supabase
    .from("subscriptions")
    .select(CANCELLATION_ROW_COLUMNS)
    .eq("provider_subscription_id", subscriptionId)
    .eq("environment", env)
    .maybeSingle();
  if (error) throw new Error(`subscription lookup failed: ${error.message}`);
  if (!row?.user_id) return;

  const { priceId: currentPriceId, quantity, trialEndsAt } = readIds(current);
  const priceId = currentPriceId ?? row.price_id ?? null;
  if (!priceId) return;
  const periodStart = current.currentBillingPeriod?.startsAt ?? null;

  if (current.status === "canceled") {
    // Rezygnacja NIE zakłada uprawnienia przy wyrównaniu. To, czy anulowana
    // subskrypcja bez wcześniejszego dostępu dostaje okres do końca, rozstrzyga
    // wyłącznie nagrobek (`applyTombstoneAccess`: okres opłacony u operatora).
    // Bez tej bramki spóźnione `created` po nagrobku BEZ dostępu (pierwsza
    // płatność nieudana) - które jako `stale` teraz wyrównuje stan - nadawało
    // dostęp do końca nieopłaconego okresu ogólną regułą `canceled`.
    if (!(await entitlementExists(subscriptionId))) return;
    const access = cancellationAccess(row as CancellationRow, current);
    await applyEntitlementFromState({
      subscriptionId,
      userId: row.user_id,
      tenantId: row.tenant_id ?? null,
      priceId,
      status: "canceled",
      // Anulowanie nie zmienia limitu miejsc - tylko stan organizacji.
      quantity: null,
      accessUntil: access.accessUntil,
      // Jak w `handleCanceled`: koniec windykacji nie ożywia korekty.
      periodStart: access.nonPayment ? null : periodStart,
      cancellationReason: access.cancellationReason,
    });
    return;
  }

  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: current.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    storedPeriodEnd: row.current_period_end ?? null,
    status: current.status,
    periodStart: periodStart ?? row.current_period_start ?? null,
    // Kotwica z wiersza (nie „teraz"): wyrównanie nie zakłada nowego cyklu
    // windykacji, a bez kotwicy karencja liczy się od początku okresu.
    firstPaymentFailedAt: row.first_payment_failed_at ?? null,
  });
  await applyEntitlementFromState({
    subscriptionId,
    userId: row.user_id,
    tenantId: row.tenant_id ?? null,
    priceId,
    status: current.status,
    quantity,
    accessUntil: period.accessUntil,
    periodStart,
    cancelAtPeriodEnd: current.scheduledChange?.action === "cancel",
  });
}

/**
 * Atomowe zajęcie potwierdzenia zakupu (`purchase_confirmed_at`): `true`
 * DOKŁADNIE raz na subskrypcję (SUB-02). Wołane z komunikatu zakupu, czyli PO
 * zapisie stanu wiersza (w ścieżce zakładania - po jego wstawieniu): porażka
 * skutków, zapisu albo wyparcie nie zużywają potwierdzenia, a dwa równoległe
 * zdarzenia (oba widzą pusty znacznik) nie wyślą go dwa razy.
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Zakres sprawdzenia drugiego planu - właściciel i najemca z WIERSZA, nie z ładunku. */
interface DuplicateCheckScope {
  /**
   * Czytany w chwili ZAJĘCIA potwierdzenia, nie przy budowie zakresu: na
   * ścieżce zakładania skutki biegną przed wstawieniem wiersza, a właściciela
   * i najemcę wpisuje dopiero RETURNING wstawienia (`createSubscription`).
   * Zajęcie i tak czeka na udany zapis wiersza (`announcements`).
   */
  owner: RowOwner;
  priceId: string;
  status: string;
  purpose: string | null;
}

/**
 * `claimPurchaseConfirmation` + siatka bezpieczeństwa za kasą: druga żywa
 * subskrypcja planu tego konta (skrajny wyścig, osobny zakup w innym modelu
 * rozliczenia, subskrypcja z panelu z wpisanym właścicielem).
 *
 * DLACZEGO PRZY ZAJĘCIU, A NIE PRZY WSTAWIENIU. Zajęcie wygrywa DOKŁADNIE raz
 * na subskrypcję i dokładnie przy pierwszym wejściu w stan uprawniający -
 * także wtedy, gdy wiersz powstał jako `incomplete`, a `active` przyszło
 * osobnym `updated` po 3DS albo przelewie (zwykła droga kart z UE). Sprawdzenie
 * przy samym wstawieniu pomijało `incomplete` i nic go potem nie powtarzało.
 * Ponowienie po sukcesie przegrywa zajęcie i nie dzwoni drugi raz; ponowienie
 * po awarii przed zajęciem dochodzi do niego i sprawdza wtedy.
 *
 * Tylko alarm i log, bez anulowania; sprawdzenie biegnie za odpowiedzią
 * i NIGDY nie rzuca (także gdy moduł alarmu się nie załaduje) - zajęcie już
 * wygrało, więc wyjątek tutaj zgubiłby mail i dzwonek potwierdzenia na zawsze.
 * Wołają je wyłącznie skutki zakupu, a te biegną tylko przy `grantsAccess`
 * (PAY-05): ślad księgowy piaskownicy na produkcji niczego nie sprawdza.
 */
function claimConfirmationWithDuplicateCheck(
  subscriptionId: string,
  env: StripeEnv,
  scope: DuplicateCheckScope,
): () => Promise<boolean> {
  return async () => {
    const won = await claimPurchaseConfirmation(subscriptionId, env);
    if (!won) return false;
    try {
      const { userId, tenantId } = scope.owner;
      if (!userId || !tenantId) {
        throw new Error("subscription row without owner scope");
      }
      const { scheduleDuplicatePlanSubscriptionAlert } =
        await import("@/lib/billing/duplicateSubscriptionAlert.server");
      scheduleDuplicatePlanSubscriptionAlert({
        subscriptionId,
        userId,
        tenantId,
        environment: env,
        priceId: scope.priceId,
        status: scope.status,
        purpose: scope.purpose,
      });
    } catch (err) {
      console.error("[payments] duplicate plan subscription check not scheduled", {
        subscriptionId,
        error: errorText(err),
      });
    }
    return true;
  };
}

/**
 * Subskrypcja bez `metadata.userId` (panel operatora): wiersza nie zakładamy,
 * ale sprawdzamy, czy ten sam klient operatora nie ma już żywego planu
 * u NASZEGO właściciela (moduł alarmu czyta go z wierszy tego klienta).
 * W tle i nigdy nie rzuca. Wołający pilnuje `grantsAccess` (PAY-05) - karta
 * testowa na produkcji nie jest podwójnym obciążeniem.
 */
async function scheduleUnmirroredPlanCheck(data: SubscriptionData, env: StripeEnv): Promise<void> {
  const input: UnmirroredPlanSubscriptionInput = {
    subscriptionId: data.id,
    customerId: data.customerId,
    environment: env,
    priceId: readIds(data).priceId,
    status: data.status,
    purpose: data.customData?.purpose ?? null,
  };
  try {
    const { scheduleUnmirroredPlanSubscriptionAlert } =
      await import("@/lib/billing/duplicateSubscriptionAlert.server");
    scheduleUnmirroredPlanSubscriptionAlert(input);
  } catch (err) {
    console.error("[payments] duplicate plan subscription check not scheduled", {
      subscriptionId: input.subscriptionId,
      error: errorText(err),
    });
  }
}

/**
 * Skutki ZAŁOŻENIA subskrypcji: dostęp, mail, CRM, newsletter, dzwonek
 * i miejsca planu Zespół. Wołający pilnuje `grantsAccess` (zdarzenie
 * piaskownicy na produkcji zostawia wyłącznie ślad księgowy w `subscriptions`).
 * Mail, CRM, newsletter i dzwonek trafiają do `announcements` - wychodzą
 * dopiero po zapisie wiersza (patrz `AnnouncementQueue`), i tylko w stanie
 * opłaconym, raz (`purchase_confirmed_at`, SUB-02). Wygrane zajęcie
 * potwierdzenia uruchamia też sprawdzenie drugiego planu w zakresie `owner`
 * (RETURNING wstawienia - wpisuje go `createSubscription`).
 */
async function applyCreationEffects(
  data: SubscriptionData,
  env: StripeEnv,
  source: SubscriptionRowSource,
  mark: EventMark,
  announcements: AnnouncementQueue,
  owner: RowOwner,
): Promise<void> {
  const periodStart = data.currentBillingPeriod?.startsAt ?? null;
  // W trialu dostęp trwa do końca okresu próbnego - dopiero pierwsze
  // obciążenie przesuwa go na pełny cykl rozliczeniowy. Zaległość (zdarzenie
  // wyprzedziło `created`): dostęp do końca karencji.
  const period = accessPeriodFromEvent({
    kind: "created",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? source.trialEndsAt ?? null,
    status: data.status,
    periodStart,
    firstPaymentFailedAt: source.firstPaymentFailedAt,
  });
  const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPurchaseEffects({
    userId: source.userId,
    priceId: source.priceId,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    periodStart,
    environment: env,
    status: data.status,
    cancelAtPeriodEnd: data.scheduledChange?.action === "cancel",
    claimConfirmation: claimConfirmationWithDuplicateCheck(data.id, env, {
      owner,
      priceId: source.priceId,
      status: data.status,
      purpose: data.customData?.purpose ?? null,
    }),
    newsletterConsent: data.customData?.newsletterConsent ?? null,
    // `created` i zdarzenie, które je wyprzedziło, to TO SAMO założenie -
    // dzwonek szukamy od początku pierwszego okresu.
    eventAt: earliestIso(mark.stamp, periodStart),
    announcements,
  });

  // Plan Zespół: liczba opłaconych miejsc ustala limit organizacji.
  const { applySubscriptionSeats } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionSeats({
    subscriptionId: data.id,
    quantity: source.quantity,
    priceId: source.priceId,
  });
}

/** Przyczyny anulowania u operatora, przy których okres NIE został opłacony. */
const UNPAID_CANCELLATION_REASONS: ReadonlySet<string> = new Set([
  "payment_failed",
  "payment_disputed",
]);

/**
 * Dostęp z rezygnacji, która wyprzedziła założenie (nagrobek, 1.4).
 *
 * Ta sama reguła co przy rezygnacji z istniejącego wiersza: dostęp trwa do
 * końca OPŁACONEGO okresu (`mapProviderStatus('canceled', koniec)`). Spóźnione
 * `created` trafi potem w nowszy znacznik i niczego nie nada, więc bez tego
 * klient, który zapłacił za okres, nie dostawał dostępu wcale.
 *
 * Wiersza nie ma, więc nie ma też historii, z której wynikałoby, że okres
 * opłacono (subskrypcja `incomplete` anulowana po nieudanej płatności niesie
 * ten sam `current_period_end`). Rozstrzyga operator: ostatnia faktura
 * opłacona i przyczyna anulowania inna niż porażka płatności albo spór. Koniec
 * windykacji nie dostaje tu karencji (SUB-03): nasza baza nie ma kotwicy
 * pierwszej porażki, a klient bez wiersza nie miał dostępu, który karencja
 * by przedłużała. Koniec okresu też z API - zdarzenie usunięcia to stan
 * końcowy, a odczyt i tak jest potrzebny. Porażka odczytu RZUCA, zanim powstanie
 * nagrobek, więc ponowienie znów trafi w `missing` i rozstrzygnie to samo;
 * subskrypcja nieznana operatorowi (`resource_missing`) - bez dostępu.
 *
 * @returns `true`, gdy nagrobek nadał dostęp za OPŁACONY okres.
 */
async function applyTombstoneAccess(
  data: SubscriptionData,
  env: StripeEnv,
  source: SubscriptionRowSource,
): Promise<boolean> {
  // Bez planu najemcy (konto zamknięte, cena spoza katalogu) nie ma czego
  // nadać - i nie ma po co pytać operatora.
  const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
  const plan = await resolvePlanForPrice(source.priceId, { userId: source.userId });
  if (!plan) return false;

  const { getStripeClient } = await import("@/lib/stripe.server");
  let remote: Record<string, unknown>;
  try {
    const stripe = await getStripeClient(env);
    remote = (await stripe.subscriptions.retrieve(data.id, {
      expand: ["latest_invoice"],
    })) as unknown as Record<string, unknown>;
  } catch (err) {
    if (isResourceMissing(err)) {
      console.warn("[payments] canceled before created: unknown at provider - no access", data.id);
      return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`subscription tombstone: provider read failed (${data.id}): ${message}`);
  }
  const details = remote["cancellation_details"] as { reason?: unknown } | null | undefined;
  const reason = typeof details?.reason === "string" ? details.reason : null;
  const invoice = remote["latest_invoice"] as { status?: unknown } | string | null | undefined;
  const invoicePaid = typeof invoice === "object" && invoice !== null && invoice.status === "paid";
  if (!invoicePaid || (reason !== null && UNPAID_CANCELLATION_REASONS.has(reason))) {
    console.warn("[payments] canceled before created: period not paid - no access", {
      subscriptionId: data.id,
      reason,
    });
    return false;
  }

  const { mapStripeSubscription } = await import("@/lib/billing/stripeEvents.server");
  const current = mapStripeSubscription(remote);
  const period = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd:
      current.currentBillingPeriod?.endsAt ?? data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: null,
    status: "canceled",
  });
  const { mapProviderStatus, syncEntitlementState } =
    await import("@/lib/billing/entitlementSync.server");
  // Okres już minął: dostępu nie ma czego trzymać, a wiersz `canceled` dla
  // uprawnienia, którego nigdy nie było, tylko zaśmieca panel.
  if (mapProviderStatus("canceled", period.accessUntil) !== "active") return false;
  await syncEntitlementState({
    userId: source.userId,
    tenantId: plan.tenantId,
    planId: plan.planId,
    externalRef: data.id,
    status: "canceled",
    periodEnd: period.accessUntil,
    periodStart:
      current.currentBillingPeriod?.startsAt ?? data.currentBillingPeriod?.startsAt ?? null,
  });
  return true;
}

/**
 * Ścieżka zakładania (`missing`): SKUTKI, potem wstawienie wiersza (1.2).
 *
 * Wiersz `subscriptions` istnieje więc wyłącznie po skutkach założenia, które
 * się udały. Dawniej wstawienie szło pierwsze: gdy skutki padły, a przed
 * ponowieniem `created` przyszło inne zdarzenie, `created` było już `stale`
 * albo remisem - mail potwierdzenia, CRM, newsletter i dzwonek ginęły na
 * zawsze. Teraz porażka skutków zostawia „brak wiersza", a każde kolejne
 * zdarzenie tej subskrypcji (albo ponowione `created`) znów idzie tą ścieżką.
 * Skutki są idempotentne (klucz `external_ref`, ziarna maili, upserty CRM
 * i newslettera, dzwonek z progiem deduplikacji, potwierdzenie zakupu
 * zajmowane raz).
 *
 * Rezygnacja bez wiersza zostawia nagrobek (spóźnione `created` zobaczy
 * nowszy znacznik i nie wskrzesi subskrypcji), a dostęp do końca opłaconego
 * okresu ustala `applyTombstoneAccess`.
 *
 * Komunikaty założenia zostają w `announcements` WYŁĄCZNIE po udanym
 * wstawieniu - przegrane wstawienie (`exists`) ogłasza zdarzenie, które
 * wiersz założyło, a `invalid` nie ma komu.
 *
 * Zdarzenie stanu BEZ `metadata.userId` (subskrypcja z panelu operatora, np.
 * `incomplete` z `created`, które dopiero teraz weszło w `active`): wiersza
 * nie zakładamy, ale lustro jej nie zna, więc sprawdzenie drugiego planu idzie
 * po kliencie operatora; powtórki tłumi bramka jednokrotności modułu alarmu.
 *
 * @returns wynik wstawienia (`insertSubscriptionRow`); przegrane wstawienie
 *          wołający rozstrzyga strażnikiem jeszcze raz.
 */
async function createSubscription(
  kind: "created" | "updated" | "canceled",
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
  grantsAccess: boolean,
  announcements: AnnouncementQueue,
): Promise<"inserted" | "exists" | "invalid"> {
  const row: SubscriptionData =
    kind === "canceled" ? { ...data, status: "canceled", pauseCollection: null } : data;
  const source = subscriptionRowFrom(row, env, mark.stamp);
  if (!source) {
    if (grantsAccess && kind !== "canceled" && !row.customData?.userId) {
      await scheduleUnmirroredPlanCheck(row, env);
    }
    return "invalid";
  }

  // Właściciel i najemca do sprawdzenia drugiego planu: wpisuje je RETURNING
  // wstawienia niżej, a czyta zajęcie potwierdzenia - komunikat, który wychodzi
  // dopiero po udanym wstawieniu.
  const owner: RowOwner = { userId: null, tenantId: null };
  let extra: { purchase_confirmed_at?: string } = {};
  if (grantsAccess) {
    if (kind !== "canceled") {
      await applyCreationEffects(row, env, source, mark, announcements, owner);
    } else if (await applyTombstoneAccess(row, env, source)) {
      // Nagrobek OPŁACONEGO okresu: zakup rozstrzygnął operator, a potwierdzenia
      // anulowanej subskrypcji już nie będzie. Pusty `purchase_confirmed_at`
      // udawałby subskrypcję nigdy nieopłaconą - jej ponowiona rezygnacja albo
      // wyrównanie (`cancellationAccess`) odebrałyby opłacony okres.
      extra = { purchase_confirmed_at: new Date().toISOString() };
    }
  }
  const inserted = await insertSubscriptionRow(source, data.id, mark, extra);
  if (inserted.outcome !== "inserted") announcements.length = 0;
  if (inserted.owner) Object.assign(owner, inserted.owner);
  return inserted.outcome;
}

/**
 * Wspólna ścieżka dla wszystkich zdarzeń zmieniających stan subskrypcji:
 * `updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed` - oraz
 * dla `created`, które zastało wiersz (ponowienie po porażce albo wiersz
 * założony bez wiarygodnego czasu): `created` niesie NAJSTARSZY stan, więc
 * stosujemy go jak każdą aktualizację, pod tym samym strażnikiem (SUB-02).
 * Operator wysyła je jako osobne typy, ale ładunek ma identyczny kształt, a
 * autorytatywne jest pole `status` - dlatego obsługa jest jedna i idempotentna.
 *
 * KOLEJNOŚĆ: odczyt POPRZEDNIEGO stanu -> skutki (uprawnienie; komunikaty
 * przejścia stanu, zmiany planu albo potwierdzenia zakupu do `announcements`)
 * -> zapis nowego stanu warunkiem na zajęcie -> komunikaty (wołający, po
 * udanym zapisie).
 *
 * @returns `false`, gdy nowsze zdarzenie przejęło wiersz w trakcie skutków.
 */
async function handleUpdated(
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
  claim: EventClaim | null,
  grantsAccess: boolean,
  announcements: AnnouncementQueue,
): Promise<boolean> {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity, trialEndsAt } = readIds(data);

  // Nieudany odczyt to NIE „brak wiersza": ścieżka zakładania niżej
  // zakończyłaby zdarzenie bez zapisu stanu, a dziennik pokazałby `processed`.
  const { data: existing, error: readErr } = await supabase
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at, purchase_confirmed_at",
    )
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  if (readErr) throw new Error(`subscription lookup failed: ${readErr.message}`);

  // Wiersz zniknął między strażnikiem a odczytem. Bez wiersza zapis trafiłby
  // w pustkę i zakup przepadłby po cichu - zakładamy go tą samą ścieżką co
  // przy utworzeniu (skutki, potem WYŁĄCZNIE wstawienie: istniejącego,
  // nowszego wiersza ten zapis nigdy nie nadpisze ani nie cofnie mu strażnika).
  if (!existing) {
    if (!data.customData?.userId) return true;
    const created = await createSubscription(
      "updated",
      data,
      env,
      mark,
      grantsAccess,
      announcements,
    );
    // Przegrane wstawienie: wiersz założyło równoległe zdarzenie, a nasze
    // skutki mogły wylądować po jego - wołający wyrówna uprawnienie.
    return created !== "exists";
  }

  const firstPaymentFailedAt = firstPaymentFailureFor(
    data.status,
    existing.first_payment_failed_at ?? null,
    mark.stamp,
  );
  // Zdarzenia stanu (pauza, wznowienie, past_due) bywają bez okresu
  // rozliczeniowego - wtedy zapisana data końca dostępu musi zostać nietknięta.
  // Przy zaległości dostęp kończy karencja, nie (przesunięty już) okres.
  const period = accessPeriodFromEvent({
    kind: "updated",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null,
    storedPeriodEnd: existing.current_period_end ?? null,
    status: data.status,
    periodStart: data.currentBillingPeriod?.startsAt ?? existing.current_period_start ?? null,
    firstPaymentFailedAt,
  });
  const cancelAtPeriodEnd = data.scheduledChange?.action === "cancel";

  // Zdarzenie piaskownicy na produkcji: wyłącznie ślad księgowy niżej -
  // karta testowa nie rusza miejsc zespołu, uprawnień, CRM ani maili.
  if (grantsAccess) {
    await applyUpdateEffects({
      data,
      env,
      mark,
      existing,
      eventPriceId,
      quantity,
      accessUntil: period.accessUntil,
      cancelAtPeriodEnd,
      announcements,
    });
  }

  return commitSubscriptionState(
    data.id,
    env,
    claim,
    {
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
    },
    "subscriptions update failed",
  );
}

/**
 * Skutki zdarzenia stanu. `existing` to stan SPRZED zdarzenia - wiersz
 * dostaje nowy dopiero po tych skutkach, więc powtórka po ich porażce widzi
 * ten sam punkt wyjścia i przejście (dzwonek, mail, CRM, mail o zmianie
 * planu) wykonuje się dokładnie raz. Komunikaty idą do `announcements`:
 * porażka zapisu stanu po nich nie zostawia klienta z „wstrzymana" bez
 * „wznowiona" (A3).
 *
 * ZAKUP DO POTWIERDZENIA (SUB-02). Stan opłacony (`active` / `trialing`)
 * z pustym `purchase_confirmed_at` to zakup: pierwsza zapłata subskrypcji
 * założonej jako `incomplete` (3DS, przelew), ponowienie po awarii albo
 * zdarzenie, które wyprzedziło ponowienie `created`. Wtedy skutkiem jest
 * potwierdzenie zakupu (uprawnienie + mail, CRM, zgoda z checkoutu, dzwonek -
 * raz, atomowym zajęciem znacznika), a nie przejście stanu. Wyzwalaczem jest
 * SAM znacznik, nie poprzedni status, więc potwierdzenie nie ginie, gdy jego
 * komunikat padł już po zapisie stanu.
 */
async function applyUpdateEffects(input: {
  data: SubscriptionData;
  env: StripeEnv;
  mark: EventMark;
  existing: {
    user_id: string | null;
    tenant_id: string | null;
    price_id: string | null;
    status: string | null;
    purchase_confirmed_at: string | null;
  };
  eventPriceId: string | null;
  quantity: number;
  accessUntil: string | null;
  cancelAtPeriodEnd: boolean;
  announcements: AnnouncementQueue;
}): Promise<void> {
  const { data, env, mark, existing, eventPriceId, announcements } = input;
  // Zdarzenia stanu (pauza, wznowienie, past_due) potrafią nie nieść pozycji
  // cennika - wtedy pracujemy na cenie zapisanej przy subskrypcji.
  const priceId = eventPriceId ?? existing.price_id ?? null;
  const periodStart = data.currentBillingPeriod?.startsAt ?? null;

  if (!existing.user_id || !priceId) {
    // Bez właściciela albo ceny nie ma uprawnienia do przeliczenia - ale stan
    // organizacji i miejsca zespołu (klucz: subskrypcja) i tak muszą nadążyć.
    await applyTeamState({
      subscriptionId: data.id,
      status: data.status,
      priceId,
      quantity: input.quantity,
      accessUntil: input.accessUntil,
    });
    return;
  }

  if (isEntitledSubscriptionStatus(data.status) && !existing.purchase_confirmed_at) {
    await applyTeamState({
      subscriptionId: data.id,
      status: data.status,
      priceId,
      quantity: input.quantity,
      accessUntil: input.accessUntil,
    });
    const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
    await applyPurchaseEffects({
      userId: existing.user_id,
      tenantId: existing.tenant_id ?? null,
      priceId,
      subscriptionId: data.id,
      periodEnd: input.accessUntil,
      periodStart,
      environment: env,
      status: data.status,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
      // Pierwsze wejście w stan uprawniający istniejącego wiersza (aktywacja po
      // 3DS / przelewie): wygrane zajęcie sprawdza drugi plan w zakresie
      // `existing`, nie ładunku.
      claimConfirmation: claimConfirmationWithDuplicateCheck(data.id, env, {
        owner: { userId: existing.user_id, tenantId: existing.tenant_id },
        priceId,
        status: data.status,
        purpose: data.customData?.purpose ?? null,
      }),
      newsletterConsent: data.customData?.newsletterConsent ?? null,
      eventAt: mark.stamp,
      announcements,
    });
    return;
  }

  // Każda aktualizacja (pauza, wznowienie, past_due, nowy okres) musi trafić do
  // uprawnień, nie tylko zmiana planu.
  await applyEntitlementFromState({
    subscriptionId: data.id,
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId,
    status: data.status,
    quantity: input.quantity,
    accessUntil: input.accessUntil,
    periodStart,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
  });

  // CRM + powiadomienie użytkownika przy zmianie samego stanu.
  const { applyStatusTransitionEffects, applyPlanChangeEffects } =
    await import("@/lib/billing/purchaseEffects.server");
  await applyStatusTransitionEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId,
    subscriptionId: data.id,
    periodEnd: input.accessUntil,
    previousStatus: existing.status ?? null,
    status: data.status,
    eventAt: mark.stamp,
    announcements,
  });

  const direction = eventPriceId ? planChangeDirection(existing.price_id, eventPriceId) : "same";
  if (direction === "same") return;

  await applyPlanChangeEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId,
    previousPriceId: existing.price_id,
    direction,
    subscriptionId: data.id,
    periodEnd: input.accessUntil,
    periodStart,
    environment: env,
    // Ten sam stan operatora co wyżej - bez niego plan zmieniany w trakcie
    // pauzy dostawał uprawnienie `active`.
    status: data.status,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    eventAt: mark.stamp,
    announcements,
  });
}

/**
 * Rezygnacja: skutki (stan organizacji, uprawnienie do końca opłaconego okresu
 * albo karencji; mail, CRM i dzwonek do `announcements`), potem zapis
 * `canceled` warunkiem na zajęcie. Subskrypcja nigdy nieopłacona: jawny brak
 * dostępu, bez komunikatów (patrz `cancellationAccess`).
 *
 * @returns `false`, gdy nowsze zdarzenie przejęło wiersz w trakcie skutków.
 */
async function handleCanceled(
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
  claim: EventClaim | null,
  grantsAccess: boolean,
  announcements: AnnouncementQueue,
): Promise<boolean> {
  const supabase = await admin();
  const { data: existing, error: readErr } = await supabase
    .from("subscriptions")
    .select(CANCELLATION_ROW_COLUMNS)
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  // Bez odczytu nie wiadomo, komu odebrać dostęp - rezygnacja z `processed`
  // zostawiłaby uprawnienie aktywne bez płatności.
  if (readErr) throw new Error(`subscription lookup failed: ${readErr.message}`);

  const row = existing as CancellationRow | null;
  const access = cancellationAccess(row, data);

  if (grantsAccess && row?.user_id && row.price_id) {
    // Plan Zespół: rezygnacja wstrzymuje organizację od razu (miejsca zostają,
    // ale przestają nadawać uprawnienia), a anulowanie za brak płatności -
    // dopiero z końcem karencji, jak uprawnienie indywidualne.
    await applyTeamState({
      subscriptionId: data.id,
      status: "canceled",
      priceId: row.price_id,
      quantity: null,
      accessUntil: access.accessUntil,
      cancellationReason: access.cancellationReason,
    });

    if (access.neverPaid) {
      // Bez maila, CRM i dzwonka - nie było zakupu, więc nie ma rezygnacji.
      // Uprawnienie dostaje jawny brak dostępu (wiersz `incomplete` miał je już
      // wygaszone, ale zapis jest idempotentny i domyka każdą inną kolejność).
      const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
      const plan = await resolvePlanForPrice(row.price_id, {
        tenantId: row.tenant_id ?? null,
        userId: row.user_id,
      });
      if (plan) {
        const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
        await syncEntitlementState({
          userId: row.user_id,
          tenantId: plan.tenantId,
          planId: plan.planId,
          externalRef: data.id,
          status: "canceled",
          periodEnd: null,
          periodStart: access.periodStart,
        });
      }
    } else {
      const { applyCancellationEffects } = await import("@/lib/billing/purchaseEffects.server");
      await applyCancellationEffects({
        userId: row.user_id,
        tenantId: row.tenant_id ?? null,
        priceId: row.price_id,
        subscriptionId: data.id,
        periodEnd: access.accessUntil,
        // Koniec windykacji to nie opłacony okres - nie ożywia korekty (S1 x
        // SUB-03, `mayReviveRefunded`): karencja nie jest dla klienta, któremu
        // zwróciliśmy pieniądze albo który odebrał je sporem.
        periodStart: access.nonPayment ? null : (data.currentBillingPeriod?.startsAt ?? null),
        environment: env,
        nonPayment: access.nonPayment,
        eventAt: mark.stamp,
        announcements,
      });
    }
  }

  return commitSubscriptionState(
    data.id,
    env,
    claim,
    {
      status: "canceled",
      trial_ends_at: null,
      pause_collection_behavior: null,
      ...(access.graceAnchor ? { first_payment_failed_at: access.graceAnchor } : {}),
      updated_at: new Date().toISOString(),
    },
    "subscriptions cancel failed",
  );
}

/**
 * Migawka `customer.subscription.pending_update_applied`: stan subskrypcji
 * PO zastosowaniu oczekującej zmiany plus, z TEJ CHWILI (`stripeEvents.server`):
 * dołączony harmonogram, ostatnia faktura (ta, której zapłata zastosowała
 * zmianę) i data końca zaplanowana datą `cancel_at` (sekundy, bez flagi) -
 * `null` = brak. Wpisy dziennika sprzed tych pól ich nie mają: bez nich
 * dyspozytor operatora o datę nie pyta.
 */
export type PendingUpdateAppliedData = SubscriptionData & {
  scheduleId?: string | null;
  latestInvoiceId?: string | null;
  cancelAt?: number | null;
};

/**
 * Odrzucona dopłata (upgrade, więcej miejsc) opłacona później: operator
 * zastosował zmianę, ale harmonogram zachowany przy odmowie cofnąłby ją na
 * koniec okresu. Decyzję podejmuje warstwa operatora na żywym stanie
 * (`reconcileScheduleWithAppliedUpdate`), klientem środowiska ZDARZENIA.
 *
 * Błąd operatora RZUCA - celowo bez łapania: trasa odpowiada 500, dziennik
 * zostawia zdarzenie `failed`, a operator ponawia je i rozstrzygnięcie idzie
 * od nowa. „Pominięte" przy żywym sprzecznym harmonogramie byłoby ciche:
 * stary downgrade wszedłby przy odnowieniu.
 *
 * @returns czy harmonogram u operatora się zmienił (zwolniony albo przepisany)
 */
async function settleScheduleAfterAppliedUpdate(
  data: PendingUpdateAppliedData,
  env: StripeEnv,
): Promise<boolean> {
  if (!data.scheduleId) return false;
  const { reconcileScheduleWithAppliedUpdate } =
    await import("@/lib/billing/subscriptionProvider.server");
  const outcome = await reconcileScheduleWithAppliedUpdate(env, data.id, {
    scheduleId: data.scheduleId,
    lines: (data.items ?? []).map((item) => ({
      price: item.price.id,
      quantity: item.quantity ?? 1,
    })),
  });
  return outcome === "released" || outcome === "rewritten";
}

/**
 * Odrzucony upgrade planu przy dacie końca `cancel_at` (panel, portal),
 * opłacony później: po udanej dopłacie data schodzi od razu, a tu - dopiero
 * teraz, decyzją warstwy operatora na żywym stanie
 * (`clearCancelDateAfterAppliedUpgrade`). Zdejmuje ją wyłącznie wtedy, gdy to
 * data z chwili prośby o upgrade (znacznik na fakturze), od tamtej pory się
 * nie zmieniła, a od zapłaty nie minęło okno ponowień operatora - inaczej
 * zostaje (`kept_stale`: dostawa spóźniona dłużej). Migawka bez daty nie pyta
 * operatora wcale: data ustawiona po zastosowaniu zmiany to nowsza decyzja
 * klienta.
 *
 * Błąd operatora RZUCA, jak przy harmonogramie.
 *
 * @returns wynik warstwy operatora; `null` = migawka bez daty końca
 */
async function settleCancelDateAfterAppliedUpdate(
  data: PendingUpdateAppliedData,
  env: StripeEnv,
): Promise<AppliedUpgradeCancelDateOutcome | null> {
  if (typeof data.cancelAt !== "number") return null;
  const { clearCancelDateAfterAppliedUpgrade } =
    await import("@/lib/billing/subscriptionProvider.server");
  return clearCancelDateAfterAppliedUpgrade(env, data.id, {
    invoiceId: data.latestInvoiceId ?? null,
    cancelAt: data.cancelAt,
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

/** Źródło transakcji po rozstrzygnięciu (patrz `transactionSource`). */
type TransactionSource = "checkout_session" | "invoice";

/**
 * Skąd pochodzi transakcja: sesja Checkout czy faktura.
 *
 * Ładunek sprzed wdrożenia (wiersz dziennika odtwarzany przez zamiatarkę albo
 * panel) nie niesie `source` - rozpoznajemy je po identyfikatorze operatora
 * (S6, 4.7): `cs_...` to sesja, `in_...` faktura. Bez tego powtórka starej
 * sesji subskrypcji omijała domknięcie zamówienia i zakładała fantomowy
 * dokument `cs_...`. Identyfikator spoza obu kształtów (dawny operator) to
 * `null`: rozliczenie zamówienia go nie dotyczy, windykacja tak.
 */
function transactionSource(data: TransactionData): TransactionSource | null {
  if (data.source === "checkout_session" || data.source === "invoice") return data.source;
  if (typeof data.id === "string" && data.id.startsWith("cs_")) return "checkout_session";
  if (typeof data.id === "string" && data.id.startsWith("in_")) return "invoice";
  return null;
}

/** Identyfikator NASZEGO zamówienia z metadanych (`orderId`, historycznie `order_id`). */
function orderIdOf(customData: Record<string, unknown> | null | undefined): string | null {
  for (const key of ["orderId", "order_id"]) {
    const value = customData?.[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Skutki realizacji zakupu jednorazowego, po których zakup ISTNIEJE w księgach:
 * zamówienie opłacone (`order`), darowizna zaksięgowana (`donation`) albo
 * zamówienie opłacone i wstrzymane do decyzji administratora (`held`, S8 -
 * pieniądze pobrane, księgi zgodne z operatorem). Tylko wtedy powstaje
 * dokument w panelu klienta i zakup w GA4 (S7, 6.8): nadkomplet zwrócony od
 * razu (`oversold_refunded`) ani pominięcie (`skipped`) zakupem nie są - dawniej
 * klient widział opłacony dokument za pieniądze, które już wróciły.
 */
const RECORDED_ONE_TIME_OUTCOMES: ReadonlySet<OneTimeOutcome> = new Set<OneTimeOutcome>([
  "order",
  "donation",
  "held",
]);

/** Jak zakończyła się obsługa opłaconej albo nieudanej transakcji. */
type TransactionHandling =
  | { path: "one_time"; outcome: OneTimeOutcome }
  | { path: "subscription"; source: TransactionSource | null }
  | { path: "closed" };

async function handleTransaction(
  data: TransactionData,
  env: StripeEnv,
  occurredAt: string,
  kind: "failed" | "paid",
): Promise<TransactionHandling> {
  const source = transactionSource(data);

  // Nieudana płatność SESJI Checkout (płatność odroczona: SEPA, Bacs) albo
  // płatności jednorazowej: zamówienie się zamyka, rezerwacja kuponu wraca do
  // puli, zgłoszenie na wydarzenie jest NIEOPŁACONE. Dotyczy także sesji
  // w trybie `subscription` (S6, 4.8 / 5.8 / 7.11): subskrypcja nigdy nie
  // wystartowała, więc windykacja (mail „płatność nie powiodła się" z terminem
  // kolejnej próby) byłaby nieprawdą, a zamówienie wisiałoby jako `processing`
  // z zajętym użyciem limitowanego kodu na zawsze.
  if (kind === "failed" && (source === "checkout_session" || !data.subscriptionId)) {
    const { markOneTimePaymentFailed } = await import("@/lib/billing/oneTimeFulfilment.server");
    await markOneTimePaymentFailed(data.customData ?? null, env);
    return { path: "closed" };
  }

  // Transakcja bez subskrypcji = płatność jednorazowa (odblokowanie treści,
  // bilet, darowizna). Rozpoznanie idzie po `custom_data`, które ustawia
  // serwer przy tworzeniu transakcji - klient nie ma jak go podmienić.
  if (!data.subscriptionId) {
    const { fulfilOneTimeTransaction } = await import("@/lib/billing/oneTimeFulfilment.server");
    const outcome = await fulfilOneTimeTransaction(
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
        source,
        // Chwila pobrania wg operatora: powtórka (zamiatarka, uzgadnianie) nie
        // przenosi starego przychodu na dziś.
        paidAt: occurredAt,
      },
      env,
    );
    if (RECORDED_ONE_TIME_OUTCOMES.has(outcome)) await reportPurchaseToGa4(data, env);
    return { path: "one_time", outcome };
  }

  // Darowizna cykliczna: brak uprawnień i windykacji planów - każda opłacona
  // FAKTURA (także pierwsza, `subscription_create`) to osobna wpłata.
  if (data.customData?.purpose === "donation") {
    if (kind !== "paid") return { path: "closed" };
    const donations = await import("@/lib/billing/donations.server");
    const donationId =
      typeof data.customData.donationId === "string" ? data.customData.donationId : null;
    // Sesja Checkout w trybie subskrypcji niesie `subscriptionId`
    // i `purpose=donation`, ale NIE jest ratą - tę samą pierwszą wpłatę opisze
    // za chwilę `invoice.paid`. Księgowanie z obu dawało dwa wiersze jednej
    // wpłaty (klucze `cs_...` i `in_...`, audyt SUB-09); sesja tylko wiąże
    // subskrypcję z wierszem darowizny. Źródło rozpoznaje `transactionSource`
    // (także ładunek dziennika sprzed pola `source` - po prefiksie `cs_`).
    if (source === "checkout_session") {
      await donations.linkDonationSubscription({
        donationId,
        subscriptionId: data.subscriptionId,
        environment: env,
      });
      return { path: "subscription", source };
    }
    await donations.recordRecurringDonationPayment({
      environment: env,
      donationId,
      subscriptionId: data.subscriptionId,
      invoiceId: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      donorEmail: data.customer?.email ?? null,
      paidAt: typeof data.billedAt === "string" ? data.billedAt : null,
    });
    return { path: "subscription", source };
  }

  // Domknięcie NASZEGO zamówienia subskrypcji (księgi, kupon) - S4. Sesja
  // Checkout domyka zamówienie z pobraniem; sesja bez pobrania (trial, rabat
  // 100%) tylko stempluje identyfikatory, a domyka je PIERWSZA opłacona
  // faktura (te same metadane `orderId`). Odnowienia trafiają w zamówienie już
  // opłacone i nic nie zmieniają - rozliczenie jest idempotentne. Uprawnienie
  // nadaje wyłącznie ścieżka `subscription.*` - tu nie wolno go dublować.
  if (kind === "paid" && source !== null && orderIdOf(data.customData)) {
    const { settleSubscriptionCheckoutOrder } =
      await import("@/lib/billing/oneTimeFulfilment.server");
    await settleSubscriptionCheckoutOrder(
      {
        id: data.id,
        amountCents: amountFromTransaction(data),
        currency: data.currencyCode ?? null,
        customerEmail: data.customer?.email ?? null,
        customData: data.customData ?? null,
        // Identyfikator SESJI wyłącznie z sesji - faktura nie nadpisuje go
        // własnym `in_...`.
        sessionId: source === "checkout_session" ? data.id : null,
        paymentIntentId: data.paymentIntentId ?? null,
        customerId: data.customerId ?? null,
        subscriptionId: data.subscriptionId,
        amountSubtotalCents: data.amountSubtotalCents ?? null,
        amountDiscountCents: data.amountDiscountCents ?? null,
        amountTaxCents: data.amountTaxCents ?? null,
        promotionCodeIds: data.promotionCodeIds ?? null,
        source,
        paidAt: occurredAt,
      },
      env,
    );
  }

  // Windykacja dotyczy FAKTUR subskrypcji. Sesja Checkout nie jest ani
  // porażką cyklu (obsłużona wyżej), ani jego odzyskaniem (4.5): dawniej
  // powtórka sesji z uzgadniania przesuwała `last_payment_at` na „teraz",
  // zerowała licznik prób i wysyłała „Płatność zaksięgowana" klientowi,
  // którego odnowienie wciąż wisiało.
  if (source === "checkout_session") return { path: "subscription", source };

  const ctx = {
    subscriptionId: data.subscriptionId,
    environment: env,
    occurredAt,
    amountCents: amountFromTransaction(data),
    currency: data.currencyCode ?? null,
    // Klucz deduplikacji windykacji: faktura + numer próby. Ponowienia jednej
    // faktury mają ten sam identyfikator, więc dopiero `attempt_count`
    // odróżnia kolejną porażkę od powtórki zdarzenia o tej samej próbie
    // (`transaction.payment_failed` i `transaction.past_due` to jedna próba).
    transactionId: data.id,
    attemptCount: data.attemptCount ?? null,
    // Termin kolejnej próby obciążenia - trafia do maila o nieudanej płatności.
    retryAt: data.nextPaymentAttemptAt ?? null,
    // Odnowienie czy dopłata za zmianę w trakcie okresu - windykacja dotyczy
    // wyłącznie zaległości, nie odrzuconej dopłaty do upgrade'u (SUB-16).
    billingReason: data.billingReason ?? null,
    // Dopłata, która otworzyła nowy okres (zmiana interwału), opłaca okres
    // jak odnowienie - przesuwa `last_payment_at`.
    chargesFullPeriod: data.chargesFullPeriod ?? null,
  };
  const dunning = await import("@/lib/billing/dunning.server");
  if (kind === "failed") await dunning.applyPaymentFailedEffects(ctx);
  else await dunning.applyPaymentRecoveredEffects(ctx);
  return { path: "subscription", source };
}

/**
 * Czy opłacona transakcja dostaje dokument w panelu klienta (PAY-12, S7).
 * Zakup jednorazowy - wyłącznie, gdy realizacja zaksięgowała zakup.
 * Subskrypcja - faktura tak, pierwsza sesja Checkout nie: rozliczeniem jest
 * faktura (`in_...`), którą zapisze jej własne `invoice.paid`, a obok niej
 * wisiałby fantom `cs_...`.
 */
function recordsDocument(handled: TransactionHandling): boolean {
  if (handled.path === "one_time") return RECORDED_ONE_TIME_OUTCOMES.has(handled.outcome);
  if (handled.path === "subscription") return handled.source !== "checkout_session";
  return false;
}

/**
 * Akcje korekty znane obsłudze zwrotów. Słownik ma jedno źródło
 * (`AdjustmentAction` w `refunds.server`), a `satisfies` pilnuje, żeby nowa
 * akcja w unii nie ominęła tej listy - ręcznie przepisana unia rozjeżdżała się
 * z normalizatorem przy każdej zmianie.
 */
const ADJUSTMENT_ACTIONS = {
  refund: true,
  chargeback: true,
  chargeback_warning: true,
  credit: true,
  other: true,
} as const satisfies Record<AdjustmentAction, true>;

/**
 * Akcja korekty z luźnego ładunku. Wartość spoza słownika (wiersz dziennika
 * z innej wersji normalizatora, literówka) to `other`, czyli gałąź, która
 * NICZEGO nie odbiera. Samo rzutowanie typu przepuszczało ją dalej, a obsługa
 * zwrotów traktuje każdą akcję inną niż `credit`/`other` jak zwrot - nieznana
 * akcja ze statusem `approved` odbierała dostęp.
 */
function adjustmentAction(value: string | null): AdjustmentAction {
  return value !== null && Object.hasOwn(ADJUSTMENT_ACTIONS, value)
    ? (value as AdjustmentAction)
    : "other";
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
    action: adjustmentAction(str("action")),
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

export interface DispatchInput {
  /**
   * Identyfikator zdarzenia u operatora (`evt_...`, albo syntetyczny
   * `reconcile_...`). Ten sam przy każdej ponownej dostawie i przy ponowieniu
   * z panelu - po nim strażnik kolejności odróżnia powtórkę TEGO SAMEGO
   * zdarzenia od innego zdarzenia z tym samym znacznikiem czasu.
   *
   * Synchronizacja na żądanie (`selfSync.server`) podaje syntetyczny
   * `self-sync:<subskrypcja>:<sekunda>`. Bez identyfikatora (stary wołający)
   * zdarzenie nigdy nie jest uznane za ponowienie, a ta sama sekunda to remis
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

async function handleDonationSubscription(data: SubscriptionData, status: string, env: StripeEnv) {
  const { syncDonationSubscription } = await import("@/lib/billing/donations.server");
  // Środowisko zdarzenia wiąże zapis: subskrypcja z piaskownicy nie zamyka
  // ani nie przepina darowizny produkcyjnej (audyt SUB-10).
  await syncDonationSubscription({
    subscriptionId: data.id,
    donationId: data.customData?.donationId ?? null,
    status,
    environment: env,
  });
}

/** Rodzaj obsługi zdarzenia `subscription.*` albo `null` dla innych typów. */
function subscriptionEventKind(eventType: string): "created" | "updated" | "canceled" | null {
  switch (eventType) {
    case "subscription.created":
      return "created";
    // Wszystkie zdarzenia zmiany stanu subskrypcji dzielą jedną obsługę -
    // operator wysyła je jako osobne typy, ale autorytatywny jest `status`.
    // Oczekująca zmiana zastosowana po późniejszej zapłacie też: jej lustro
    // to zwykła aktualizacja, ale PRZED nim dyspozytor rozstrzyga harmonogram
    // i datę końca u operatora (`handlePendingUpdateApplied`).
    case "subscription.updated":
    case "subscription.activated":
    case "subscription.trialing":
    case "subscription.past_due":
    case "subscription.paused":
    case "subscription.resumed":
    case "subscription.imported":
    case "subscription.pending_update_applied":
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
 * Strażnik zapisuje parę (znacznik, identyfikator) PRZED skutkami, a stan
 * subskrypcji ląduje PO nich, warunkiem na tę parę. Gdy skutki padną, wyjątek
 * wraca do trasy (500 / `failed` w dzienniku), a ponowna dostawa tego samego
 * zdarzenia dostaje `replay` i przechodzi całą obsługę jeszcze raz - od tego
 * samego stanu poprzedniego. Gdy nowsze zdarzenie przejmie wiersz w trakcie
 * naszych skutków, uprawnienie wyrównuje stan z API operatora (1.0).
 * Komunikaty dla klienta wychodzą wyłącznie po udanym zapisie stanu.
 */
async function handleSubscriptionEvent(
  kind: "created" | "updated" | "canceled",
  input: DispatchInput,
  grantsAccess: boolean,
): Promise<DispatchOutcome> {
  const env = input.environment;
  const data = input.data as SubscriptionData;
  const mark: EventMark = {
    // `created` - sekunda minus 1 ms: najstarszy stan przegrywa z każdym
    // innym zdarzeniem tej samej sekundy (SUB-02, `createdEventStamp`).
    stamp: kind === "created" ? createdEventStamp(input.occurredAt) : eventStamp(input.occurredAt),
    eventId: input.eventId ?? null,
  };

  // `created` bez właściciela albo identyfikatorów cennika nie ma czego
  // zapisać - ani wiersza, ani skutków. Odsiewamy je PRZED strażnikiem, żeby
  // śmieciowy ładunek nie zajmował znacznika istniejącej subskrypcji.
  if (kind === "created" && !subscriptionRowFrom(data, env)) {
    // Subskrypcja spoza kasy (panel operatora nie wpisuje metadanych): bez
    // właściciela nie nadajemy dostępu, ale klient płaci - a jeśli ma już żywy
    // plan, płaci podwójnie. Właściciela zna wyłącznie nasza baza.
    if (grantsAccess && !data.customData?.userId) await scheduleUnmirroredPlanCheck(data, env);
    return "processed";
  }

  // Komunikaty skutków bieżącej próby - wychodzą PO zapisie stanu (A3).
  const announcements: AnnouncementQueue = [];
  const deliver = async (): Promise<void> => {
    if (announcements.length === 0) return;
    const { deliverAnnouncements } = await import("@/lib/billing/purchaseEffects.server");
    await deliverAnnouncements(announcements);
  };

  /**
   * Wynik obsługi, która zapisywała stan. Zapis się udał -> komunikaty
   * (przejściowa porażka potwierdzenia zakupu wraca stąd wyjątkiem -
   * `RetryableAnnouncementError` - a ponowienie, `replay`, ogłosi zakup
   * jeszcze raz, bo `purchase_confirmed_at` zostało puste). Wyparta -> bez
   * komunikatów (nikt nie zapisał stanu, o którym mówią), uprawnienie
   * wyrównuje stan z API operatora.
   */
  const settle = async (owned: boolean): Promise<DispatchOutcome> => {
    if (owned) {
      await deliver();
    } else {
      announcements.length = 0;
      if (grantsAccess) await resyncFromProvider(data.id, env, mark, "superseded");
    }
    return "processed";
  };

  for (let attempt = 1; ; attempt += 1) {
    const verdict = await claimSubscriptionEvent(data.id, env, mark);
    switch (verdict) {
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji - ale
      // jego WCZEŚNIEJSZA próba mogła zapisać uprawnienie i paść przed
      // wyrównaniem (porażka odczytu u operatora albo zapisu stanu po
      // wyparciu, A1/A2). Strażnik tej próby nie pamięta - parę w wierszu
      // nadpisało nowsze zdarzenie - więc spóźnione zdarzenie ZAWSZE wyrównuje
      // uprawnienie stanem z API: to zapis zbieżny, a koszt to jeden odczyt
      // u operatora na zdarzenie dostarczone poza kolejnością. Dawne `skipped`
      // zostawiało klienta z cudzym, starszym zapisem do następnego zdarzenia.
      // Ślad księgowy piaskownicy na produkcji niczego nie nadał.
      case "stale":
        if (!grantsAccess) return "skipped";
        await resyncFromProvider(data.id, env, mark, "stale");
        return "processed";

      case "missing": {
        // `created` zakłada wiersz; zdarzenie stanu, które wyprzedziło
        // `created`, też - inaczej zakup przepadłby po cichu. Rezygnacja
        // zostawia wiersz-nagrobek z dostępem do końca opłaconego okresu.
        const created = await createSubscription(
          kind,
          data,
          env,
          mark,
          grantsAccess,
          announcements,
        );
        if (created === "inserted") await deliver();
        if (created !== "exists") return "processed";
        // Przegrany wyścig: równoległe zdarzenie założyło wiersz między
        // strażnikiem a wstawieniem. Rozstrzygamy od nowa (świeże / remis /
        // spóźnione) - wstawienie niczego nie nadpisało, a nasz zapis
        // uprawnienia nadpisze albo wyrówna kolejna runda.
        if (attempt >= GUARD_MAX_ATTEMPTS) {
          throw new Error(`subscription event guard: contention (${data.id})`);
        }
        continue;
      }

      // Remis w obrębie sekundy: stan z API operatora, nie z ładunku. Wiersz
      // już jest, a istnieje wyłącznie po udanych skutkach założenia - tu
      // tylko odświeżamy stan (także dla `created`).
      case "tie": {
        // Ślad księgowy piaskownicy na produkcji: zajęcie remisu wystarczy,
        // a produkcja nie odpytuje API piaskownicy w odpowiedzi na jej webhook.
        if (!grantsAccess) return "processed";
        // Operator tej subskrypcji nie zna (usunięta w piaskownicy): nie ma
        // czego stosować - bez zgadywania z ładunku.
        const current = await authoritativeSubscription(data.id, env);
        if (!current) return "skipped";
        const claim: EventClaim = {
          stamp: mark.stamp ?? "",
          id: `${TIE_MARKER}${mark.eventId ?? "unknown"}`,
        };
        const handle = current.status === "canceled" ? handleCanceled : handleUpdated;
        return settle(await handle(current, env, mark, claim, grantsAccess, announcements));
      }

      // `fresh`, `replay` (ponowienie po porażce skutków), `untimed`.
      // `created`, które zastało wiersz, stosujemy jak aktualizację (SUB-02):
      // skutki założenia już były albo wrócą jako zakup do potwierdzenia
      // (pusty `purchase_confirmed_at`), a wstawienie nie ma czego dopisać.
      default: {
        // `created` bez wiarygodnego czasu na ISTNIEJĄCYM wierszu: nie da się
        // rozstrzygnąć, czy nie cofa nowszego stanu - wiersz zostaje nietknięty.
        if (kind === "created" && verdict === "untimed") return "skipped";
        const claim: EventClaim | null =
          verdict === "untimed" || !mark.stamp ? null : { stamp: mark.stamp, id: mark.eventId };
        const handle = kind === "canceled" ? handleCanceled : handleUpdated;
        return settle(await handle(data, env, mark, claim, grantsAccess, announcements));
      }
    }
  }
}

/**
 * Oczekująca zmiana zastosowana po późniejszej zapłacie
 * (`subscription.pending_update_applied`). NAJPIERW harmonogram i data końca
 * u operatora (żywy stan - niezależnie od werdyktu strażnika, bo spóźniona
 * migawka nie czyni sprzecznego harmonogramu ani opłaconej rezygnacji mniej
 * żywymi), potem lustro TĄ SAMĄ drogą co każda aktualizacja
 * (`handleSubscriptionEvent`: strażnik kolejności, remis i wyrównanie stanem
 * z API operatora). Błąd operatora rzuca PRZED zajęciem zdarzenia, więc
 * ponowienie przejdzie strażnika i rozstrzygnie wszystkie kroki od nowa; błąd
 * lustra po zajęciu ponowienie dostaje jako `replay`, a kroki u operatora
 * czytają żywy stan i nie powtarzają zmiany, która już weszła.
 *
 * IZOLACJA ŚRODOWISK (PAY-05). Zdarzenie piaskownicy na wdrożeniu
 * produkcyjnym zostawia wyłącznie ślad księgowy lustra: produkcja ani nie
 * czyta, ani nie zmienia piaskownicy operatora w odpowiedzi na jej webhook
 * (jak przy remisie i wyrównaniu po wyparciu).
 *
 * @returns `processed`, gdy cokolwiek zmieniło się u operatora; inaczej wynik
 *          lustra.
 */
async function handlePendingUpdateApplied(
  input: DispatchInput,
  grantsAccess: boolean,
): Promise<DispatchOutcome> {
  if (!grantsAccess) return handleSubscriptionEvent("updated", input, grantsAccess);
  const env = input.environment;
  const sub = input.data as PendingUpdateAppliedData;
  const settled = await settleScheduleAfterAppliedUpdate(sub, env);
  const cancelDate = await settleCancelDateAfterAppliedUpdate(sub, env);
  // Migawka niesie datę z chwili zastosowania. Gdy u operatora końca już
  // nie ma (zdjęty teraz albo przy wcześniejszej próbie), lustro dostaje
  // stan operatora - jak `cancelAtPeriodEnd` ścieżki synchronicznej - bez
  // chwilowego „kończy się" przy subskrypcji, która się odnowi. Okres
  // (przedłużony po zdjęciu daty w bieżącym okresie) domyka zdarzenie
  // `customer.subscription.updated` tego zdjęcia.
  const endGone = cancelDate === "cleared" || cancelDate === "not_scheduled";
  const mirrored = await handleSubscriptionEvent(
    "updated",
    endGone ? { ...input, data: { ...sub, scheduledChange: null } } : input,
    grantsAccess,
  );
  return settled || cancelDate === "cleared" ? "processed" : mirrored;
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
        env,
      );
      return "processed";
    }
  }

  // Oczekująca zmiana zastosowana po późniejszej zapłacie: rozstrzygnięcie
  // u operatora, potem lustro jak każda aktualizacja.
  if (eventType === "subscription.pending_update_applied") {
    return handlePendingUpdateApplied(input, grantsAccess);
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
      const handled = await handleTransaction(
        input.data as TransactionData,
        env,
        occurredAt,
        "paid",
      );
      // Dokument PO realizacji (PAY-12): właściciela zakupu jednorazowego
      // ustala zamówienie po `provider_intent_id`, które stempluje dopiero
      // realizacja - zapis przed nią nie znajdował właściciela i zakup nie
      // dostawał dokumentu nigdy. Co dostaje dokument - `recordsDocument`.
      if (recordsDocument(handled)) await recordDocument(input.data, env, "completed");
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
