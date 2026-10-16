import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getStripeErrorMessage, resolveEnvironment, type StripeEnv } from "@/lib/stripe.server";

const envSchema = z.enum(["sandbox", "live"]);

// OPERACJE NA SUBSKRYPCJI (zmiana planu, miejsca, anulowanie, wznowienie)
// to tutaj CIENKIE ADAPTERY: wejście z karty operatora (lookup_key +
// środowisko), wiersz subskrypcji pod RLS wołającego, a cała decyzja - cel
// w ofercie najemcy (`planSwitch.server.ts`) i operacja na żywym stanie
// (`subscriptionProvider.server.ts`) - w tych samych modułach, z których
// korzysta karta lokalna (`checkout.functions.ts`). Dwie ścieżki UI, jedna
// warstwa serwerowa (SUB-14).
//
// Środowisko rozstrzyga serwer (`resolveEnvironment`: produkcja = live), tak
// jak przy zakładaniu zamówienia - parametr klienta jest tylko podpowiedzią
// dla buildów deweloperskich. Bez tego produkcyjna sesja mogła operować na
// wierszach sandboxa (izolacja środowisk).

/** Zamiana czytelnego identyfikatora ceny (`lookup_key`) na `price_...` u Stripe. */
export const resolveStripePrice = createServerFn({ method: "GET" })
  .validator((data: { priceId: string; environment: StripeEnv }) =>
    z.object({ priceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data }) => {
    // Restart integracji (nowe konto operatora, rotacja klucza) unieważnia
    // wewnętrzne identyfikatory cen. Sprawdzenie odcisku jest tanie
    // (debounce w izolacie), a pozwala odtworzyć katalog zanim ktoś kliknie
    // "Kup" i zobaczy błąd.
    const { ensureCatalogSynced } = await import("@/lib/billing/catalogAutoSync.server");
    await ensureCatalogSynced(data.environment).catch((e: unknown) => {
      console.error("[payments] auto-sync check failed", e);
    });

    const { resolveProviderPriceId } = await import("@/lib/billing/subscriptionProvider.server");
    const id = await resolveProviderPriceId(data.environment, data.priceId);
    if (!id) throw new Error("price_not_found");
    return id;
  });

/**
 * Cel zmiany planu w ofercie najemcy wołającego - ta sama bramka co karta
 * lokalna. Odmowa RZUCA (jak brak subskrypcji): to błąd wejścia, nie decyzja
 * operatora, a UI i tak nie pokazuje celów, których bramka nie przyjmie.
 */
async function assertOfferedTarget(
  userId: string,
  sub: { tenant_id?: string | null; price_id: string | null },
  lookupKey: string,
): Promise<string> {
  const { resolveOfferedSwitchTarget } = await import("@/lib/billing/planSwitch.server");
  const offered = await resolveOfferedSwitchTarget({
    userId,
    subscriptionTenantId: sub.tenant_id ?? null,
    currentLookupKey: sub.price_id,
    target: { lookupKey },
  });
  if (!offered.ok) throw new Error(offered.error);
  return offered.target.lookupKey;
}

/**
 * Zmiana planu istniejącej subskrypcji.
 * - upgrade  -> natychmiast, z rozliczeniem proporcjonalnym, ale DOPIERO po
 *   opłaceniu dopłaty; odmowa karty zwraca `payment_failed` /
 *   `payment_requires_action` z adresem faktury i plan zostaje bez zmian,
 * - downgrade -> zaplanowane na koniec opłaconego okresu (bez proraty).
 */
export const changeStripePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId } = await import("@/lib/billing/catalog");
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");
    const environment = resolveEnvironment(data.environment);

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, tenant_id")
      .eq("user_id", context.userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    // Ten sam cel wg lustra: nic do zrobienia (operator i tak odmówiłby
    // `same_plan` na żywym stanie, ale bez ruchu do niego).
    if (sub.price_id === target.priceId) return { ok: true as const, direction: "same" as const };

    const lookupKey = await assertOfferedTarget(context.userId, sub, target.priceId);
    const { changeSubscriptionPrice } = await import("@/lib/billing/subscriptionProvider.server");
    const result = await changeSubscriptionPrice(environment, sub.provider_subscription_id, {
      newPriceExternalId: lookupKey,
    });
    if (!result.ok) {
      console.error("[payments] plan change failed", sub.provider_subscription_id, result.error);
      return { error: result.error, hostedInvoiceUrl: result.hostedInvoiceUrl ?? null };
    }

    // Lustro w bazie domyka webhook - i to dopiero wtedy, gdy pozycje
    // subskrypcji naprawdę niosą nową cenę (po dopłacie / na starcie okresu).
    return { ok: true as const, direction: result.direction, effect: result.effect };
  });

/**
 * Link do portalu klienta (anulowanie, zmiana planu/ceny, metoda płatności,
 * faktury) - przycisk w profilu, karcie operatora i potwierdzeniu zakupu.
 *
 * JEDNA implementacja sesji portalu. Do 12.10.2026 był tu własny odczyt
 * klienta operatora i własne `billingPortal.sessions.create` - równoległa
 * kopia tego, co robi `createPortalLinkForUser` (strona wejścia z maila,
 * `openMyBillingPortal`), ale BEZ granicy najemcy. Teraz adapter woła tę samą
 * funkcję z najemcą z profilu wołającego i ze ścieżką powrotu, z której
 * użytkownik wszedł (sanityzowaną tą samą bramką `absoluteReturnUrl`; brak
 * ścieżki = `/profile/plan`, jak dotąd). Kształt odpowiedzi zostaje -
 * wołające komponenty czytają `overviewUrl` i kod `no_customer`.
 */
export const createStripePortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv; returnPath?: string }) =>
    z.object({ environment: envSchema, returnPath: z.string().max(300).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const environment = resolveEnvironment(data.environment);
    const { resolveUserTenantId } = await import("@/lib/server/userTenant.server");
    const { createPortalLinkForUser } = await import("@/lib/billing/portalLink.server");
    const tenantId = await resolveUserTenantId(context.supabase, context.userId);
    const result = await createPortalLinkForUser(
      context.userId,
      environment,
      { tenantId },
      data.returnPath,
    );
    if (!result.ok) return { error: result.error };
    // Stripe otwiera jeden ogólny portal (bez osobnych podadresów per akcja
    // jak w Paddle) - użytkownik samodzielnie wybiera anulowanie/płatność.
    return { url: result.urls.overviewUrl, ...result.urls };
  });

/**
 * Anulowanie subskrypcji z zachowaniem opłaconego okresu.
 * Dostawca planuje zmianę na koniec bieżącego cyklu - webhook
 * `customer.subscription.updated` domyka stan w bazie.
 */
export const cancelStripeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const environment = resolveEnvironment(data.environment);
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { cancelSubscriptionAtPeriodEnd } =
      await import("@/lib/billing/subscriptionProvider.server");
    const result = await cancelSubscriptionAtPeriodEnd(environment, sub.provider_subscription_id);
    if (!result.ok) return { error: result.error };
    return { ok: true as const };
  });

/**
 * Wznowienie subskrypcji. Trzy różne stany u operatora, jedna intencja
 * użytkownika - rozstrzyga ŻYWY stan (`resumeProviderSubscription`), nie
 * status z lustra:
 * - status `paused` (koniec triala bez metody płatności) -> `subscriptions.resume`,
 * - wstrzymany pobór (`pause_collection`)               -> zdjęcie pauzy, o ile bieżący
 *   okres jest opłacony (inaczej odmowa - pauzę zdejmuje operator),
 * - zaplanowany koniec (flaga albo data `cancel_at`)    -> cofnięcie, okres biegnie dalej.
 */
export const resumeStripeSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const environment = resolveEnvironment(data.environment);
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { resumeProviderSubscription } =
      await import("@/lib/billing/subscriptionProvider.server");
    const result = await resumeProviderSubscription(environment, sub.provider_subscription_id);
    if (!result.ok) {
      return { error: result.error, hostedInvoiceUrl: result.hostedInvoiceUrl ?? null };
    }
    // Obie pauzy to dla klienta ten sam komunikat („wznowiono dostęp"). Brak
    // czegokolwiek do wznowienia u operatora (`already_active`) = lustro było
    // spóźnione, a subskrypcja naprawdę się odnawia: warstwa operatora liczy
    // zaplanowany koniec w OBU kształtach (flaga i data `cancel_at`), więc
    // `already_active` nie przykrywa już końca, który operator i tak wykona -
    // „wznowiono" opisuje stan prawdziwy. Pauza operatora przy nieopłaconym
    // okresie wraca jako odmowa (`subscription_paused_by_operator`).
    const mode =
      result.mode === "unpaused" || result.mode === "collection_resumed"
        ? ("unpaused" as const)
        : ("cancellation_reverted" as const);
    return { ok: true as const, mode };
  });

/**
 * Podgląd kosztu zmiany planu PRZED potwierdzeniem.
 *
 * Korzystamy z `invoices.createPreview` z tymczasową podmianą
 * pozycji, żeby pokazać dopłatę (upgrade) albo kwotę kolejnego rozliczenia
 * (downgrade) bez faktycznego dotykania subskrypcji.
 */
export const previewStripePlanChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { targetPriceId: string; environment: StripeEnv }) =>
    z.object({ targetPriceId: z.string().min(1).max(64), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { catalogEntryByPriceId, planChangeDirection } = await import("@/lib/billing/catalog");
    const target = catalogEntryByPriceId(data.targetPriceId);
    if (!target) throw new Error("unknown_price");
    const environment = resolveEnvironment(data.environment);

    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, quantity, tenant_id")
      .eq("user_id", context.userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const direction = planChangeDirection(sub.price_id, target.priceId);
    if (direction === "same") {
      return {
        ok: true as const,
        direction,
        amountCents: null,
        currency: null,
        nextBilledAt: null,
      };
    }
    // Podgląd tylko dla celu, który zmiana by przyjęła - kwota dla planu spoza
    // oferty byłaby obietnicą, której serwer potem nie dotrzyma.
    await assertOfferedTarget(context.userId, sub, target.priceId);

    try {
      const { resolveProviderPriceId } = await import("@/lib/billing/subscriptionProvider.server");
      const providerPriceId = await resolveProviderPriceId(environment, target.priceId);
      if (!providerPriceId) {
        return {
          ok: false as const,
          direction,
          amountCents: null,
          currency: null,
          nextBilledAt: null,
        };
      }

      const { getStripeClient } = await import("@/lib/stripe.server");
      const stripe = await getStripeClient(environment);
      const current = await stripe.subscriptions.retrieve(sub.provider_subscription_id);
      const itemId = current.items.data[0]?.id;
      const upcoming = await stripe.invoices.createPreview({
        subscription: sub.provider_subscription_id,
        subscription_details: {
          items: itemId
            ? [
                {
                  id: itemId,
                  price: providerPriceId,
                  quantity: Math.max(1, sub.quantity ?? 1),
                },
              ]
            : undefined,
          proration_behavior: direction === "upgrade" ? "always_invoice" : "none",
        },
      });

      return {
        ok: true as const,
        direction,
        amountCents: upcoming.amount_due ?? null,
        currency: upcoming.currency?.toUpperCase() ?? null,
        nextBilledAt: upcoming.next_payment_attempt
          ? new Date(upcoming.next_payment_attempt * 1000).toISOString()
          : null,
      };
    } catch (e) {
      console.error("[payments] plan preview failed", getStripeErrorMessage(e));
      // Brak podglądu nie może blokować zmiany planu - UI pokaże samą regułę.
      return {
        ok: false as const,
        direction,
        amountCents: null,
        currency: null,
        nextBilledAt: null,
      };
    }
  });

/**
 * Samodzielna zmiana liczby miejsc w planie rozliczanym za miejsce.
 * Zwiększenie rozlicza się proporcjonalnie od razu (po opłaceniu dopłaty),
 * zmniejszenie obowiązuje od nowego okresu - opłacony okres należy się
 * klientowi w całości.
 */
export const updateStripeSubscriptionSeats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { quantity: number; environment: StripeEnv }) =>
    z.object({ quantity: z.number().int().min(1).max(500), environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const environment = resolveEnvironment(data.environment);
    const { data: sub, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id, price_id, quantity, status")
      .eq("user_id", context.userId)
      .eq("environment", environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.provider_subscription_id) throw new Error("no_active_subscription");

    const { catalogEntryByPriceId } = await import("@/lib/billing/catalog");
    const entry = catalogEntryByPriceId(sub.price_id);
    if (!entry?.perSeat) throw new Error("not_per_seat_plan");

    const { updateSubscriptionQuantity } =
      await import("@/lib/billing/subscriptionProvider.server");
    const result = await updateSubscriptionQuantity(environment, sub.provider_subscription_id, {
      priceExternalId: entry.priceId,
      quantity: data.quantity,
      previousQuantity: sub.quantity ?? 1,
    });
    if (!result.ok) {
      console.error("[payments] seat change failed", sub.provider_subscription_id, result.error);
      return { error: result.error, hostedInvoiceUrl: result.hostedInvoiceUrl ?? null };
    }
    // Stan w bazie domknie webhook `customer.subscription.updated`; zwracamy
    // wartość docelową i moment wejścia wg OPERATORA (nie wg lustra, które
    // przy spóźnionym webhooku dawało zły kierunek). `effectiveAt` - początek
    // okresu, od którego obowiązuje zaplanowane zmniejszenie.
    return {
      ok: true as const,
      quantity: result.quantity,
      immediate: result.effect === "applied",
      effect: result.effect,
      effectiveAt: result.effectiveAt,
    };
  });

/**
 * Samoobsługowa synchronizacja: pobiera stan subskrypcji wołającego u operatora
 * i przepuszcza go przez tę samą ścieżkę co webhook. Użytkownik używa jej, gdy
 * po zakupie lub zmianie planu panel pokazuje nieaktualny stan (spóźniony
 * webhook). Idempotentna - powtórzenie nie duplikuje uprawnień ani dokumentów.
 */
export const syncMyBillingFromProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Identyfikatory czytamy pod RLS wołającego - warstwa serwerowa nigdy nie
    // decyduje samodzielnie, czyje subskrypcje pobiera od operatora.
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw error;

    const localIds = (rows ?? [])
      .map((row) => row.provider_subscription_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    try {
      const { syncUserSubscriptionsFromProvider } = await import("@/lib/billing/selfSync.server");
      const result = await syncUserSubscriptionsFromProvider(
        data.environment,
        context.userId,
        localIds,
      );
      return { ok: true as const, ...result };
    } catch (e: unknown) {
      console.error("[payments] self sync failed", e);
      return { error: getStripeErrorMessage(e) };
    }
  });

/**
 * Podgląd domyślnej metody płatności wołającego (marka + cztery ostatnie
 * cyfry). Identyfikator klienta czytamy pod RLS wołającego z tabeli
 * `subscriptions` - warstwa serwerowa nigdy nie decyduje samodzielnie, czyją
 * kartę pobiera od operatora.
 */
export const getMyPaymentMethod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: { environment: StripeEnv }) =>
    z.object({ environment: envSchema }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("subscriptions")
      .select("provider_customer_id, provider_subscription_id")
      .eq("user_id", context.userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw error;

    const row = rows?.[0] ?? null;
    const customerId = row?.provider_customer_id ?? null;
    if (!customerId) return { method: null };

    try {
      const { fetchPaymentMethodPreview } = await import("@/lib/billing/paymentMethod.server");
      const method = await fetchPaymentMethodPreview({
        customerId,
        subscriptionId: row?.provider_subscription_id ?? null,
        environment: data.environment,
      });
      return { method };
    } catch (e: unknown) {
      console.error("[payments] payment method preview failed", e);
      return { error: getStripeErrorMessage(e) };
    }
  });
