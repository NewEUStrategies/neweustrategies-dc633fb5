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
  isNonPaymentCancellation,
  isPreActivationSubscriptionStatus,
  paymentGraceAnchor,
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
  /**
   * `invoice.billing_reason` operatora (`subscription_cycle`, `subscription_create`,
   * `subscription_update`, ...). Brak = nieznany (sesja checkout, stary dziennik).
   */
  billingReason?: string | null;
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
 * Wiersz widziany przez strażnika, gdy zajęcie nie trafiło: znacznik oraz
 * DOKŁADNIE te kolumny, które zdarzenie stanu by zapisało - po nich remis
 * znaczników rozstrzyga, czy zdarzenie w ogóle coś zmienia.
 */
const GUARD_ROW_COLUMNS =
  "id, last_event_at, status, price_id, quantity, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end, pause_collection_behavior";

interface GuardRow {
  id: string;
  last_event_at: string | null;
  status: string | null;
  price_id: string | null;
  quantity: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_ends_at: string | null;
  cancel_at_period_end: boolean | null;
  pause_collection_behavior: string | null;
}

/**
 * Werdykt strażnika kolejności:
 *  - `claimed`   - znacznik zdarzenia jest teraz zapisany, stosujemy je,
 *  - `unguarded` - brak wiarygodnego czasu: nie blokujemy (i nie zajmujemy),
 *  - `absent`    - wiersza jeszcze nie ma (zdarzenie wyprzedziło `created`),
 *  - `stale`     - zapisany stan jest nowszy: pomijamy,
 *  - `tie`       - zapisany znacznik jest RÓWNY naszemu: kolejności nie da się
 *                  rozstrzygnąć z samego czasu (`row` = wiersz z tej chwili).
 */
type ClaimOutcome =
  { kind: "claimed" | "unguarded" | "absent" | "stale" } | { kind: "tie"; row: GuardRow };

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
 * (`resyncFromProvider`) zamiast zostawić własny, starszy zapis.
 *
 * REMIS TO NIE „STARSZE". Operator stempluje zdarzenia z dokładnością do
 * SEKUNDY, a jedna operacja potrafi wyemitować dwa różne `updated` w tej
 * samej sekundzie (upgrade, a po nim cofnięcie zaplanowanej rezygnacji;
 * zwolnienie harmonogramu, a po nim nowa cena). Ścisłe `<` odrzucało drugie
 * z nich jako „spóźnione" i stan zostawał na pierwszym - klient z
 * opłaconym upgrade'em widział stary plan albo „anulowanie zaplanowane" do
 * następnego cyklu (audyt SUB-04/SUB-14). Dlatego równy znacznik wraca jako
 * `tie`, a decyzję podejmuje `resolveTiedSubscriptionEvent`.
 *
 * WIERSZ, KTÓRY POJAWIŁ SIĘ W TRAKCIE. Warunkowy UPDATE i odczyt istnienia to
 * dwa zapytania. Gdy między nimi `created` wstawi wiersz (ze swoim, starszym
 * znacznikiem), UPDATE nie trafił, a odczyt widzi wiersz - wcześniej to był
 * werdykt „stan nowszy" i aktywacja po 3DS przepadała z odpowiedzią 200.
 * Teraz znacznik starszy od naszego (albo pusty) każe ponowić zajęcie RAZ;
 * prawdziwie nowszy zapis nadal daje `stale`.
 *
 * @param stamp znacznik z `eventStamp` (albo `createdEventStamp`); `null` =
 *        brak wiarygodnego czasu - nie blokujemy.
 */
async function claimSubscriptionEvent(
  subscriptionId: string,
  env: StripeEnv,
  stamp: string | null,
): Promise<ClaimOutcome> {
  if (!stamp) return { kind: "unguarded" };
  const mine = Date.parse(stamp);

  const supabase = await admin();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: claimed, error } = await supabase
      .from("subscriptions")
      .update({ last_event_at: stamp })
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .or(`last_event_at.is.null,last_event_at.lt.${stamp}`)
      .select("id");
    if (error) throw new Error(`subscription event claim failed: ${error.message}`);
    if (claimed && claimed.length > 0) return { kind: "claimed" };

    // Zero zaktualizowanych wierszy: subskrypcji jeszcze nie ma, zapisany
    // stan jest nowszy, równy - albo wiersz zmienił się między zapytaniami.
    const { data: row, error: rowErr } = await supabase
      .from("subscriptions")
      .select(GUARD_ROW_COLUMNS)
      .eq("provider_subscription_id", subscriptionId)
      .eq("environment", env)
      .maybeSingle();
    if (rowErr) throw new Error(`subscription lookup failed: ${rowErr.message}`);
    if (!row) return { kind: "absent" };

    const stored = row.last_event_at ? Date.parse(row.last_event_at) : Number.NaN;
    if (stored === mine) return { kind: "tie", row: row as GuardRow };
    if (stored > mine) return { kind: "stale" };
    // Pusty albo starszy znacznik po nietrafionym UPDATE: wiersz powstał (albo
    // został zwolniony) między zapytaniami - zajmujemy jeszcze raz.
  }
  // Dwa razy z rzędu „starszy, a jednak nie do zajęcia" - nie zgadujemy.
  // Wyjątek zwraca zdarzenie operatorowi do ponowienia.
  throw new Error(`subscription event claim could not settle: ${subscriptionId}`);
}

/** Ta sama chwila (z dokładnością do ms) albo obie puste. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = a ? Date.parse(a) : Number.NaN;
  const tb = b ? Date.parse(b) : Number.NaN;
  if (Number.isNaN(ta) || Number.isNaN(tb)) return !a && !b;
  return ta === tb;
}

/**
 * Czy zdarzenie z remisu znaczników NIE zmieniłoby niczego, co zapisujemy:
 * ten sam status, cena, liczba miejsc, okres, koniec triala, zaplanowana
 * rezygnacja i pauza poboru. Wtedy to powtórka (ponowienie z panelu,
 * druga dostawa) albo zdarzenie równoważne - nie ma czego rozstrzygać.
 * Każda różnica = dwa RÓŻNE stany z tej samej sekundy.
 */
function eventMatchesStoredState(
  row: GuardRow,
  data: SubscriptionData,
  kind: "updated" | "canceled",
): boolean {
  if (kind === "canceled") return row.status === "canceled";
  const { priceId, quantity, trialEndsAt } = readIds(data);
  const periodStart = data.currentBillingPeriod?.startsAt ?? null;
  const periodEnd = data.currentBillingPeriod?.endsAt ?? trialEndsAt ?? null;
  return (
    row.status === data.status &&
    (!priceId || row.price_id === priceId) &&
    (row.quantity ?? 1) === quantity &&
    (row.cancel_at_period_end ?? false) === (data.scheduledChange?.action === "cancel") &&
    (row.pause_collection_behavior ?? null) === (data.pauseCollection?.behavior ?? null) &&
    (!periodStart || sameInstant(row.current_period_start, periodStart)) &&
    (!periodEnd || sameInstant(row.current_period_end, periodEnd)) &&
    (data.status !== "trialing" || sameInstant(row.trial_ends_at, trialEndsAt))
  );
}

/**
 * Żywy stan subskrypcji u operatora - właściwym klientem środowiska
 * zdarzenia (sandbox nie czyta produkcji). Błąd operatora RZUCA: zdarzenie
 * wraca do ponowienia, zamiast zniknąć jako „pominięte". `null` = operator
 * nie zna tej subskrypcji (usunięta w piaskownicy) - nie ma czego stosować.
 */
async function retrieveLiveSubscription(
  subscriptionId: string,
  env: StripeEnv,
): Promise<SubscriptionData | null> {
  const { getStripeClient } = await import("@/lib/stripe.server");
  const stripe = await getStripeClient(env);
  let live: unknown;
  try {
    live = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price.product"],
    });
  } catch (err) {
    const failure = err as { code?: unknown; raw?: { code?: unknown } } | null;
    if ((failure?.code ?? failure?.raw?.code) === "resource_missing") return null;
    throw err;
  }
  const { mapStripeSubscription } = await import("@/lib/billing/stripeEvents.server");
  return mapStripeSubscription(live as Record<string, unknown>);
}

/**
 * Remis znaczników: zapisany stan pochodzi ze zdarzenia z TEJ SAMEJ sekundy.
 *
 * Powtórka (zdarzenie nic by nie zmieniło) jest pomijana jak dotąd. Różny
 * stan znaczy, że w jednej sekundzie zaszły dwie zmiany, a ich kolejności
 * z czasu operatora nie odczytamy - więc NIE zgadujemy i nie wyrzucamy
 * żadnej: stosujemy AUTORYTATYWNY żywy stan subskrypcji pobrany od
 * operatora, który zawiera obie zmiany (i każdą wcześniejszą). Znacznik
 * zostaje równy, więc każde kolejne zdarzenie z tej sekundy znów trafi tutaj
 * i znów zastosuje żywy stan, a każde nowsze przejdzie zwykłym zajęciem.
 *
 * Zajęcia nie zwalniamy przy błędzie: znacznik należy do zdarzenia, które go
 * zapisało. Wyjątek (operator niedostępny, błąd bazy) wraca do trasy, a ta
 * odpowiada 500 - operator ponowi zdarzenie i remis rozstrzygnie się wtedy.
 */
async function resolveTiedSubscriptionEvent(
  data: SubscriptionData,
  env: StripeEnv,
  stamp: string,
  row: GuardRow,
  kind: "updated" | "canceled",
): Promise<DispatchOutcome> {
  if (eventMatchesStoredState(row, data, kind)) return "skipped";
  const live = await retrieveLiveSubscription(data.id, env);
  if (!live) {
    console.warn("[payments] tied subscription event: unknown at provider", data.id);
    return "skipped";
  }
  if (live.status === "canceled") await handleCanceled(live, env);
  else await handleUpdated(live, env, stamp);
  return "processed";
}

/**
 * Zdarzenie stanu subskrypcji pod strażnikiem kolejności - jedno wejście
 * dla `updated`-podobnych, `canceled` i `created` stosowanego na istniejącym
 * wierszu. Najwyżej dwie rundy: `absent` -> wstawienie, które zastało wiersz
 * założony równolegle (`exists`) -> zajęcie jeszcze raz, już na wierszu.
 */
async function runGuardedSubscriptionEvent(
  data: SubscriptionData,
  env: StripeEnv,
  stamp: string | null,
  kind: "updated" | "canceled",
): Promise<DispatchOutcome> {
  for (let round = 0; round < 2; round += 1) {
    const claim = await claimSubscriptionEvent(data.id, env, stamp);
    if (claim.kind === "stale") return "skipped";
    // Remis istnieje tylko przy wiarygodnym znaczniku (`unguarded` go nie ma).
    if (claim.kind === "tie" && stamp) {
      return resolveTiedSubscriptionEvent(data, env, stamp, claim.row, kind);
    }
    if (claim.kind === "absent" && kind === "updated" && data.customData?.userId) {
      // Kolejność dostarczenia nie jest gwarantowana: `activated` potrafi
      // wyprzedzić `created`. Zakładamy wiersz tą samą ścieżką co przy
      // utworzeniu (wstawienie-jeśli-brak, ze znacznikiem TEGO zdarzenia).
      const created = await underClaim(data.id, env, stamp, () => handleCreated(data, env, stamp));
      if (created !== "exists") return "processed";
      continue;
    }
    await underClaim(data.id, env, stamp, () =>
      kind === "canceled" ? handleCanceled(data, env) : handleUpdated(data, env, stamp),
    );
    return "processed";
  }
  throw new Error(`subscription row raced its own creation twice: ${data.id}`);
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
 * równoległe zdarzenia (oba widzą pusty znacznik) nie wyślą potwierdzenia
 * dwa razy.
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
 * zdarzenie przez strażnika (`runGuardedSubscriptionEvent`) i stosuje je jak
 * aktualizację.
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
    userId: source.userId,
    priceId: source.priceId,
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

/**
 * Wspólna ścieżka dla wszystkich zdarzeń zmieniających stan subskrypcji:
 * `updated`, `activated`, `trialing`, `past_due`, `paused`, `resumed`.
 * Operator wysyła je jako osobne typy, ale ładunek ma identyczny kształt, a
 * autorytatywne jest pole `status` - dlatego obsługa jest jedna i idempotentna.
 *
 * Wołający przepuścił już zdarzenie przez strażnika kolejności
 * (`runGuardedSubscriptionEvent`) - zajął je (`stamp`) albo rozstrzygnął
 * remis żywym stanem operatora. `stamp === null` = zdarzenie bez
 * wiarygodnego czasu, stosowane bez strażnika.
 */
async function handleUpdated(
  data: SubscriptionData,
  env: StripeEnv,
  stamp: string | null,
  opts: { retried?: boolean } = {},
): Promise<void> {
  const supabase = await admin();
  const { priceId: eventPriceId, quantity, trialEndsAt } = readIds(data);

  const { data: existing, error: existingErr } = await supabase
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at, purchase_confirmed_at",
    )
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  // PostgREST nie rzuca, tylko oddaje `{ data: null, error }`. Połknięty błąd
  // wyglądał jak „wiersza nie ma": ścieżka zakładania zastawała wiersz,
  // ponowne zajęcie WŁASNEGO znacznika odbijało się od `<`, a zdarzenie
  // kończyło się jako `processed` bez zastosowania - aktywacja po 3DS, pauza
  // czy zaległość przepadały bez ponowienia. Wyjątek zwalnia zajęcie
  // (`underClaim`), więc operator ponowi zdarzenie.
  if (existingErr) throw new Error(`subscription lookup failed: ${existingErr.message}`);

  // Brak wiersza tutaj: zdarzenie bez wiarygodnego czasu (strażnik nie mógł
  // ani zająć, ani założyć wiersza) albo wiersz zniknął po zajęciu. Zakładamy
  // go tą samą ścieżką co przy utworzeniu - wstawienie-jeśli-brak niczego nie
  // zdubluje ani nie cofnie. Gdy wiersz jednak powstał w międzyczasie,
  // zdarzenie przechodzi strażnika jeszcze raz, już na tym wierszu.
  if (!existing && data.customData?.userId) {
    const created = await handleCreated(data, env, stamp);
    if (created !== "exists") return;
    if (opts.retried) throw new Error(`subscription row vanished during update: ${data.id}`);
    const claim = await claimSubscriptionEvent(data.id, env, stamp);
    if (claim.kind === "stale") return;
    if (claim.kind === "absent") {
      throw new Error(`subscription row vanished during update: ${data.id}`);
    }
    if (claim.kind === "tie" && stamp) {
      await resolveTiedSubscriptionEvent(data, env, stamp, claim.row, "updated");
      return;
    }
    await handleUpdated(data, env, stamp, { retried: true });
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
    storedPeriodEnd: existing.current_period_end ?? null,
    status: data.status,
    periodStart: data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null,
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
 * planu) wykonuje się dokładnie raz: maile mają ziarna idempotencji, dzwonki
 * próg deduplikacji (chwila zdarzenia), CRM jest zapisem zbieżnym.
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
  };
  eventPriceId: string | null;
  quantity: number;
  accessUntil: string | null;
}): Promise<void> {
  const { data, env, mark, existing, eventPriceId } = input;
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

  if (!existing.user_id || !priceId) {
    // Bez właściciela albo ceny nie ma uprawnienia do przeliczenia - ale stan
    // organizacji i miejsca zespołu (klucz: subskrypcja) i tak muszą nadążyć.
    const { applySubscriptionSeats, applySubscriptionOrgState } =
      await import("@/lib/organizations/teamSeats.server");
    await applySubscriptionOrgState({ subscriptionId: data.id, status: data.status, priceId });
    await applySubscriptionSeats({ subscriptionId: data.id, quantity: input.quantity, priceId });
    return;
  }

  // Stan uprawniający bez wysłanego potwierdzenia = ZAKUP do potwierdzenia:
  // pierwsza zapłata subskrypcji założonej jako `incomplete` (3DS, przelew)
  // albo ponowienie po awarii, która przerwała potwierdzenie PO zapisie
  // statusu. Mail, CRM, newsletter i dzwonek idą raz (atomowe zajęcie
  // `purchase_confirmed_at`), a uprawnienie synchronizuje ta sama ścieżka co
  // przy wstawieniu.
  //
  // DLACZEGO SAM ZNACZNIK, A NIE „POPRZEDNI STATUS = incomplete". Zapis
  // statusu `active` idzie wyżej, PRZED efektami zakupu. Gdy plan albo
  // uprawnienie padły chwilowo, ponowienie zastawało już `active` i warunek
  // na poprzedni status uznawał zakup za dawno potwierdzony - mail, CRM
  // „won", dzwonek i jawna zgoda na newsletter z checkoutu przepadały na
  // zawsze (tak samo, gdy `updated` wyprzedziło `created` albo inne zdarzenie
  // wyprzedziło ponowienie `created`). Pusty znacznik jest jednoznaczny od
  // migracji 20261013090600 (wiersze sprzed znacznika mają go uzupełnionego).
  const activates = entitled && !existing.purchase_confirmed_at;
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
      newsletterConsent: data.customData?.newsletterConsent ?? null,
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
    status: data.status,
    cancelAtPeriodEnd,
  });
}

/**
 * Rezygnacja: skutki (stan organizacji, uprawnienie do końca okresu, mail,
 * CRM, dzwonek), potem zapis `canceled` warunkiem na zajęcie.
 *
 * @returns `false`, gdy nowsze zdarzenie przejęło wiersz w trakcie skutków.
 */
async function handleCanceled(
  data: SubscriptionData,
  env: StripeEnv,
  mark: EventMark,
  claim: EventClaim | null,
  grantsAccess: boolean,
): Promise<boolean> {
  const supabase = await admin();
  const { data: existing, error: existingErr } = await supabase
    .from("subscriptions")
    .select(
      "user_id, tenant_id, price_id, status, current_period_start, current_period_end, first_payment_failed_at, purchase_confirmed_at, last_payment_at",
    )
    .eq("provider_subscription_id", data.id)
    .eq("environment", env)
    .maybeSingle();
  // Ten sam powód co w `handleUpdated`: błąd odczytu to nie „wiersza nie ma".
  // Bez wiersza rezygnacja kończy się bez odebrania uprawnień i bez ponowienia.
  if (existingErr) throw new Error(`subscription lookup failed: ${existingErr.message}`);

  // NIGDY NIEOPŁACONA. Porzucone 3DS zostawia wiersz `incomplete` bez
  // potwierdzenia zakupu i bez żadnej zapłaty; anulowanie go (panel operatora,
  // zamknięcie konta, wygaśnięcie) nie jest rezygnacją klienta z opłaconego
  // okresu. Wcześniej ta ścieżka brała koniec okresu ze zdarzenia (miesiąc albo
  // ROK od checkoutu) i dawała go jako dostęp - plus mail „dostęp do końca
  // opłaconego okresu", dzwonek i CRM „churned" dla kogoś, kto nigdy nie był
  // klientem (audyt SUB-02). Trzy sygnały naraz, żeby nie odebrać dostępu
  // płacącemu, którego aktywacja jeszcze nie dotarła: status sprzed zapłaty,
  // brak potwierdzenia zakupu i brak zaksięgowanej płatności.
  const neverPaid =
    !!existing &&
    !existing.purchase_confirmed_at &&
    !existing.last_payment_at &&
    (isPreActivationSubscriptionStatus(existing.status) ||
      isPreActivationSubscriptionStatus(data.status));

  const nonPayment = !neverPaid && isNonPaymentCancellation(data.cancellationReason);
  const periodStart = data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null;
  // Anulowanie za brak płatności daje dostęp WYŁĄCZNIE w karencji. Kotwicę,
  // od której ją liczymy, zapisujemy w wierszu, gdy jeszcze jej nie było
  // (zdarzenia windykacji nie dotarły) - dobowy przebieg zespołów liczy koniec
  // TEJ SAMEJ karencji z wiersza, a bez kotwicy zostawiłby zespół aktywny.
  const graceAnchor = nonPayment
    ? paymentGraceAnchor({
        firstPaymentFailedAt: existing?.first_payment_failed_at ?? null,
        periodStart,
      })
    : null;

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: "canceled",
      trial_ends_at: null,
      pause_collection_behavior: null,
      ...(graceAnchor && !existing?.first_payment_failed_at
        ? { first_payment_failed_at: graceAnchor }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("provider_subscription_id", data.id)
    .eq("environment", env);
  if (error) throw new Error(`subscriptions cancel failed: ${error.message}`);

  // Rezygnacja klienta: dostęp do końca opłaconego okresu. Koniec windykacji
  // (`payment_failed` / `payment_disputed`): okres nigdy nie został opłacony,
  // więc dostęp kończy karencja od pierwszej nieudanej płatności - a gdy ta
  // już minęła, dostępu nie ma wcale. Nigdy nieopłacona: żadnego dostępu.
  const canceledPeriod = accessPeriodFromEvent({
    kind: "canceled",
    eventPeriodEnd: data.currentBillingPeriod?.endsAt ?? null,
    storedPeriodEnd: existing?.current_period_end ?? null,
    status: "canceled",
    cancellationReason: data.cancellationReason ?? null,
    periodStart,
    firstPaymentFailedAt: graceAnchor ?? existing?.first_payment_failed_at ?? null,
  });
  const accessUntil = neverPaid ? null : canceledPeriod.accessUntil;

    // Anulowanie planu Zespół wstrzymuje organizację - miejsca zostają, ale
    // przestają nadawać uprawnienia.
    const { applySubscriptionOrgState } = await import("@/lib/organizations/teamSeats.server");
    await applySubscriptionOrgState({
      subscriptionId: data.id,
      status: "canceled",
      priceId: existing.price_id,
    });

  // Plan Zespół: rezygnacja wstrzymuje organizację od razu (miejsca zostają,
  // ale przestają nadawać uprawnienia), a anulowanie za brak płatności -
  // dopiero z końcem karencji, jak uprawnienie indywidualne (`accessPeriod.ts`).
  const { applySubscriptionOrgState } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: data.id,
    status: "canceled",
    priceId: existing.price_id,
    accessUntil,
    cancellationReason: neverPaid ? null : (data.cancellationReason ?? null),
  });

  if (neverPaid) {
    // Bez maila, CRM i dzwonka - nie było zakupu, więc nie ma rezygnacji.
    // Uprawnienie dostaje jawny brak dostępu (wiersz `incomplete` miał je już
    // wygaszone, ale zapis jest idempotentny i domyka każdą inną kolejność).
    const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
    const plan = await resolvePlanForPrice(existing.price_id, {
      tenantId: existing.tenant_id ?? null,
      userId: existing.user_id,
    });
    if (!plan) return;
    const { syncEntitlementState } = await import("@/lib/billing/entitlementSync.server");
    await syncEntitlementState({
      userId: existing.user_id,
      tenantId: plan.tenantId,
      planId: plan.planId,
      externalRef: data.id,
      status: "canceled",
      periodEnd: null,
    });
    return;
  }

  const { applyCancellationEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyCancellationEffects({
    userId: existing.user_id,
    tenantId: existing.tenant_id ?? null,
    priceId: existing.price_id,
    subscriptionId: data.id,
    periodEnd: accessUntil,
    environment: env,
    nonPayment,
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
    if (kind !== "paid") return;
    const donations = await import("@/lib/billing/donations.server");
    const donationId =
      typeof data.customData.donationId === "string" ? data.customData.donationId : null;
    // `checkout.session.completed` w trybie subskrypcji niesie `subscriptionId`
    // i `purpose=donation`, ale NIE jest ratą - tę samą pierwszą wpłatę opisze
    // za chwilę `invoice.paid`. Księgowanie z obu dawało dwa wiersze jednej
    // wpłaty (klucze `cs_...` i `in_...`, audyt SUB-09); sesja tylko wiąże
    // subskrypcję z wierszem darowizny. Sesję poznajemy po identyfikatorze
    // operatora (`cs_test_...`/`cs_live_...`), bo ten sam kształt ma wiersz
    // dziennika odtwarzany z panelu.
    if (typeof data.id === "string" && data.id.startsWith("cs_")) {
      await donations.linkDonationSubscription({
        donationId,
        subscriptionId: data.subscriptionId,
        environment: env,
      });
      return;
    }
    const billedAt = (data as { billedAt?: unknown }).billedAt;
    await donations.recordRecurringDonationPayment({
      environment: env,
      donationId,
      subscriptionId: data.subscriptionId,
      invoiceId: data.id,
      amountCents: amountFromTransaction(data),
      currency: data.currencyCode ?? null,
      donorEmail: data.customer?.email ?? null,
      paidAt: typeof billedAt === "string" ? billedAt : null,
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
    // odróżnia kolejną porażkę od powtórki zdarzenia o tej samej próbie.
    transactionId: data.id,
    attemptCount: data.attemptCount ?? null,
    // Termin kolejnej próby obciążenia - trafia do maila o nieudanej płatności.
    retryAt: data.nextPaymentAttemptAt ?? null,
    // Odnowienie czy dopłata za zmianę w trakcie okresu - windykacja dotyczy
    // wyłącznie zaległości, nie odrzuconej dopłaty do upgrade'u.
    billingReason: data.billingReason ?? null,
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
 * Strażnik zapisuje parę (znacznik, identyfikator) PRZED skutkami, a stan
 * subskrypcji ląduje PO nich, warunkiem na tę parę. Gdy skutki padną, wyjątek
 * wraca do trasy (500 / `failed` w dzienniku), a ponowna dostawa tego samego
 * zdarzenia dostaje `replay` i przechodzi całą obsługę jeszcze raz - od tego
 * samego stanu poprzedniego. Gdy nowsze zdarzenie przejmie wiersz w trakcie
 * naszych skutków, uprawnienie wyrównuje stan z API operatora (1.0).
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

  /**
   * Wynik obsługi, która zapisywała stan: wyparta -> wyrównanie z API.
   * `appliedStatus` - status, który nasze skutki przekazały klientowi.
   */
  const settle = async (owned: boolean, appliedStatus: string): Promise<DispatchOutcome> => {
    if (!owned) await resyncFromProvider(data.id, env, grantsAccess, mark, appliedStatus);
    return "processed";
  };

  // Ścieżka zakładania, która przegrała wstawienie, zdążyła już zapisać
  // uprawnienie z NASZEGO ładunku - jeśli strażnik uzna nas teraz za
  // spóźnionych, ten zapis mógł nadpisać nowszy stan.
  let effectsLanded = false;
  for (let attempt = 1; ; attempt += 1) {
    const verdict = await claimSubscriptionEvent(data.id, env, mark);
    switch (verdict) {
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji.
      case "stale":
        if (!effectsLanded) return "skipped";
        await resyncFromProvider(data.id, env, grantsAccess, mark, null);
        return "processed";

      case "missing": {
        // `created` zakłada wiersz; zdarzenie stanu, które wyprzedziło
        // `created`, też - inaczej zakup przepadłby po cichu. Rezygnacja
        // zostawia wiersz-nagrobek z dostępem do końca opłaconego okresu.
        const created = await createSubscription(kind, data, env, mark, grantsAccess);
        effectsLanded = effectsLanded || created.effectsLanded;
        if (created.outcome !== "exists") return "processed";
        // Przegrany wyścig: równoległe zdarzenie założyło wiersz między
        // strażnikiem a wstawieniem. Rozstrzygamy od nowa (świeże / remis /
        // spóźnione) - wstawienie niczego nie nadpisało.
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
        const current = await authoritativeSubscription(data.id, env);
        const claim: EventClaim = {
          stamp: mark.stamp ?? "",
          id: `${TIE_MARKER}${mark.eventId ?? "unknown"}`,
        };
        return current.status === "canceled"
          ? settle(await handleCanceled(current, env, mark, claim, grantsAccess), "canceled")
          : settle(await handleUpdated(current, env, mark, claim, grantsAccess), current.status);
      }

      // `fresh`, `replay` (ponowienie po porażce skutków), `untimed`.
      default: {
        const claim: EventClaim | null =
          verdict === "untimed" || !mark.stamp ? null : { stamp: mark.stamp, id: mark.eventId };
        if (kind === "created") {
          return settle(await handleCreated(data, env, mark, claim, grantsAccess), data.status);
        }
        if (kind === "canceled") {
          return settle(await handleCanceled(data, env, mark, claim, grantsAccess), "canceled");
        }
        return settle(await handleUpdated(data, env, mark, claim, grantsAccess), data.status);
      }
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
        env,
      );
      return "processed";
    }
  }

  if (subscriptionKind) return handleSubscriptionEvent(subscriptionKind, input, grantsAccess);

  switch (eventType) {
    case "subscription.created": {
      const sub = input.data as SubscriptionData;
      const stamp = createdEventStamp(occurredAt);
      const created = await underClaim(sub.id, env, stamp, () => handleCreated(sub, env, stamp));
      if (created !== "exists") return "processed";
      // Wiersz już jest: powtórka `created` (np. ponowienie po błędzie, które
      // zwolniło zajęcie) albo nowsze zdarzenie stanu, które je wyprzedziło.
      // `created` niesie NAJSTARSZY stan subskrypcji, więc stosujemy go
      // wyłącznie przez tego samego strażnika kolejności co każdą
      // aktualizację - przy nowszym zapisie nie zmienia niczego. Bez
      // wiarygodnego czasu nie da się tego rozstrzygnąć, a zgadywanie
      // cofnęłoby stan: istniejący wiersz zostaje nietknięty.
      if (!stamp) return "skipped";
      return runGuardedSubscriptionEvent(sub, env, stamp, "updated");
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
      // Spóźnione zdarzenie nie może cofnąć nowszego stanu subskrypcji, a
      // zdarzenie z tej samej sekundy - zniknąć bez rozstrzygnięcia.
      const sub = input.data as SubscriptionData;
      return runGuardedSubscriptionEvent(sub, env, eventStamp(occurredAt), "updated");
    }
    case "subscription.canceled": {
      const sub = input.data as SubscriptionData;
      return runGuardedSubscriptionEvent(sub, env, eventStamp(occurredAt), "canceled");
    }
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
