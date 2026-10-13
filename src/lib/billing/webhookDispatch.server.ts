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
  effectiveCancellationReason,
  isDelinquentSubscriptionStatus,
  isEntitledSubscriptionStatus,
  isNonPaymentCancellation,
  isPreActivationSubscriptionStatus,
  paymentGraceAnchor,
} from "@/lib/billing/accessPeriod";
import type { StripeEnv } from "@/lib/stripe.server";
import type { PremiumNewsletterConsentGrant } from "@/lib/billing/premiumNewsletter";
import type { UnmirroredPlanSubscriptionInput } from "@/lib/billing/duplicateSubscriptionAlert.server";
import type { AppliedUpgradeCancelDateOutcome } from "@/lib/billing/subscriptionProvider.server";

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
 * zdarzenia potrafi cofnąć stan (np. `past_due` po `activated`). Kolumna
 * `last_event_at` przechowuje znacznik NAJŚWIEŻSZEGO zastosowanego zdarzenia;
 * warunkowy UPDATE (`last_event_at < occurredAt`) jest atomowy, więc dwa
 * równoległe zdarzenia nie przeskoczą się nawzajem.
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Zakres sprawdzenia drugiego planu - właściciel i najemca z WIERSZA, nie z ładunku. */
interface DuplicateCheckScope {
  userId: string | null | undefined;
  tenantId: string | null | undefined;
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
      if (!scope.userId || !scope.tenantId) {
        throw new Error("subscription row without owner scope");
      }
      const { scheduleDuplicatePlanSubscriptionAlert } =
        await import("@/lib/billing/duplicateSubscriptionAlert.server");
      scheduleDuplicatePlanSubscriptionAlert({
        subscriptionId,
        userId: scope.userId,
        tenantId: scope.tenantId,
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
 * W tle i nigdy nie rzuca.
 */
async function scheduleUnmirroredPlanCheck(input: UnmirroredPlanSubscriptionInput): Promise<void> {
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
    // Subskrypcja spoza kasy (panel operatora nie wpisuje metadanych): bez
    // właściciela nie nadajemy dostępu, ale klient płaci - a jeśli ma już żywy
    // plan, płaci podwójnie. Właściciela zna wyłącznie nasza baza.
    await scheduleUnmirroredPlanCheck({
      subscriptionId: data.id,
      customerId: data.customerId,
      environment: env,
      priceId,
      status: data.status,
      purpose: data.customData?.purpose ?? null,
    });
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
    // `tenant_id` i `user_id` z RETURNING: najemcę przypina trigger z profilu
    // właściciela, więc alarm o drugiej subskrypcji (przy zajęciu potwierdzenia
    // niżej) nie bierze go z ładunku.
    .select("id, tenant_id, user_id");
  if (error) throw new Error(`subscriptions upsert failed: ${error.message}`);
  if (!inserted || inserted.length === 0) return "exists";
  const insertedRow = inserted[0];

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
  // Wygrane zajęcie uruchamia też sprawdzenie drugiego planu (zakres z RETURNING).
  const { applyPurchaseEffects } = await import("@/lib/billing/purchaseEffects.server");
  await applyPurchaseEffects({
    userId,
    priceId,
    subscriptionId: data.id,
    periodEnd: period.accessUntil,
    environment: env,
    cancelAtPeriodEnd,
    claimConfirmation: claimConfirmationWithDuplicateCheck(data.id, env, {
      userId: insertedRow?.user_id,
      tenantId: insertedRow?.tenant_id,
      priceId,
      status: data.status,
      purpose: data.customData?.purpose ?? null,
    }),
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

  // Bez wiersza i bez `metadata.userId`: subskrypcja spoza kasy (panel
  // operatora), np. `incomplete` z `created`, które dopiero teraz weszło w
  // `active`. Lustro jej nie zna, więc sprawdzenie drugiego planu idzie po
  // kliencie operatora; powtórki tłumi bramka jednokrotności modułu alarmu.
  if (!existing) {
    await scheduleUnmirroredPlanCheck({
      subscriptionId: data.id,
      customerId: data.customerId,
      environment: env,
      priceId: eventPriceId,
      status: data.status,
      purpose: data.customData?.purpose ?? null,
    });
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
      // Pierwsze wejście w stan uprawniający istniejącego wiersza (aktywacja po
      // 3DS / przelewie): wygrane zajęcie sprawdza drugi plan w zakresie
      // `existing`, nie ładunku.
      claimConfirmation: claimConfirmationWithDuplicateCheck(data.id, env, {
        userId: existing.user_id,
        tenantId: existing.tenant_id,
        priceId,
        status: data.status,
        purpose: data.customData?.purpose ?? null,
      }),
      status: data.status,
      newsletterConsent: data.customData?.newsletterConsent ?? null,
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

  const periodStart = data.currentBillingPeriod?.startsAt ?? existing?.current_period_start ?? null;
  // Powód bez podanego przez operatora: zapisana kotwica karencji bez zapłaty
  // za bieżący okres to koniec windykacji - także kotwica dopisana przez
  // uzgodnienie dawnych anulowań na dowodzie z faktury. Bez tego kolejne
  // `deleted` bez powodu (przycisk synchronizacji rozliczeń klienta,
  // odtworzenie zdarzenia, remis) liczyło dostęp jak po rezygnacji i cofało
  // przycięcie do końca nieopłaconego okresu.
  const cancellationReason = neverPaid
    ? null
    : effectiveCancellationReason({
        reason: data.cancellationReason,
        firstPaymentFailedAt: existing?.first_payment_failed_at ?? null,
        lastPaymentAt: existing?.last_payment_at ?? null,
        periodStart,
      });
  const nonPayment = isNonPaymentCancellation(cancellationReason);
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
    cancellationReason,
    periodStart,
    firstPaymentFailedAt: graceAnchor ?? existing?.first_payment_failed_at ?? null,
  });
  const accessUntil = neverPaid ? null : canceledPeriod.accessUntil;

  if (!existing?.user_id || !existing.price_id) return;

  // Plan Zespół: rezygnacja wstrzymuje organizację od razu (miejsca zostają,
  // ale przestają nadawać uprawnienia), a anulowanie za brak płatności -
  // dopiero z końcem karencji, jak uprawnienie indywidualne (`accessPeriod.ts`).
  const { applySubscriptionOrgState } = await import("@/lib/organizations/teamSeats.server");
  await applySubscriptionOrgState({
    subscriptionId: data.id,
    status: "canceled",
    priceId: existing.price_id,
    accessUntil,
    cancellationReason,
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
    // Odnowienie czy dopłata za zmianę w trakcie okresu - windykacja dotyczy
    // wyłącznie zaległości, nie odrzuconej dopłaty do upgrade'u.
    billingReason: data.billingReason ?? null,
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
    // Tylko zwrot, który nie doszedł (`refund.failed`) - kod trafia do
    // dziennika zwrotów i alarmu, patrz `escalateFailedRefund`.
    failureReason: str("failureReason"),
  });
}

/**
 * Zapis faktury dla transakcji. Zwraca `true`, gdy coś faktycznie zapisano -
 * `transaction.updated` bez zmian traktujemy jako pominięte zdarzenie.
 *
 * NIEUDANY ZAPIS TO BŁĄD ZDARZENIA, nie „pominięte". Rejestr dokumentów jest
 * dowodem sprzedaży dla członka i księgowości; zdarzenie zamknięte jako
 * przetworzone mimo braku dokumentu nigdy by nie wróciło (Stripe ponawia
 * wyłącznie po odpowiedzi innej niż 2xx). Rzucamy więc - trasa webhooka
 * oznacza zdarzenie jako `failed`, oddaje 500, a operator dostarcza je
 * ponownie (zapis jest idempotentny). Alarm dla administratorów najemcy
 * wysyła już `recordTransactionDocument`.
 */
async function recordDocument(data: unknown, env: StripeEnv): Promise<boolean> {
  const { documentInputFromTransaction, recordTransactionDocument } =
    await import("@/lib/billing/billingDocuments.server");
  const input = documentInputFromTransaction(data, env);
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
  "subscription.pending_update_applied",
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

export async function dispatchWebhookEvent(input: DispatchInput): Promise<DispatchOutcome> {
  const { eventType, environment: env, occurredAt } = input;

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
    // Oczekująca zmiana zastosowana po późniejszej zapłacie. NAJPIERW
    // harmonogram i data końca u operatora (żywy stan - niezależnie od
    // werdyktu strażnika, bo spóźniona migawka nie czyni sprzecznego
    // harmonogramu ani opłaconej rezygnacji mniej żywymi), potem lustro tym
    // samym strażnikiem co każda aktualizacja. Błąd operatora zostawia
    // znacznik nietknięty, więc ponowienie zdarzenia przejdzie strażnika
    // i rozstrzygnie wszystkie kroki od nowa.
    case "subscription.pending_update_applied": {
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
      const mirrored = await runGuardedSubscriptionEvent(
        endGone ? { ...sub, scheduledChange: null } : sub,
        env,
        eventStamp(occurredAt),
        "updated",
      );
      return settled || cancelDate === "cleared" ? "processed" : mirrored;
    }
    // Nieudane obciążenie: operator sygnalizuje je dwoma zdarzeniami
    // (`payment_failed` przy odrzuceniu, `past_due` przy wejściu transakcji w
    // zaległość). Obsługa jest ta sama, a warstwa windykacji odsiewa duplikat
    // po identyfikatorze transakcji, więc mail idzie dokładnie raz.
    case "transaction.payment_failed":
    case "transaction.past_due":
      await handleTransaction(input.data as TransactionData, env, occurredAt, "failed");
      return "processed";
    // Najpierw skutki płatności, potem dokument: awaria rejestru dokumentów
    // (ponowienie zdarzenia) nie może wstrzymać odblokowania konta po
    // zapłacie. Skutki są idempotentne po identyfikatorze transakcji.
    case "transaction.completed":
      await handleTransaction(input.data as TransactionData, env, occurredAt, "paid");
      await recordDocument(input.data, env);
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
