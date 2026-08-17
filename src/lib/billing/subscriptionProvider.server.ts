// Operacje na istniejącej subskrypcji u dostawcy (anulowanie, wznowienie,
// zmiana planu, zmiana liczby miejsc) - odpowiednik dawnego pliku Paddle,
// przepięty na Stripe. Wydzielone z `checkout.functions`, bo moduł jest
// server-only (klucz API przez bramkę) i musi być importowany dynamicznie
// w handlerach.
//
// Reguła kolejności obowiązująca wszystkich wywołujących: NAJPIERW dostawca,
// potem baza. Jeśli operator odmówi, wiersz w bazie nie może twierdzić, że
// subskrypcja jest anulowana/zmieniona - klient byłby dalej obciążany.
import type Stripe from "stripe";
import { BILLING_CATALOG } from "@/lib/billing/catalog";
import { createStripeClient, getStripeErrorMessage, type StripeEnv } from "@/lib/stripe.server";

// `{}` jest tu celowe: domyślny wariant NIE dokłada żadnych pól do `{ok:true}`.
// (Reguła ban-types została zastąpiona przez no-empty-object-type - stara nazwa
// w dyrektywie sama w sobie była błędem "rule not found".)
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type SubscriptionOpResult<T extends object = {}> =
  ({ ok: true } & T) | { ok: false; error: string };

/** Identyfikator subskrypcji u dostawcy (`sub_...`); inne wartości ignorujemy. */
export function isProviderSubscriptionRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("sub_");
}

/**
 * Środowisko bramki dla operacji serwerowej bez kontekstu klienta.
 * Produkcyjny build obsługuje wyłącznie środowisko live.
 */
export function subscriptionEnvironment(): StripeEnv {
  return process.env.NODE_ENV === "production" ? "live" : "sandbox";
}

/** Czytelny identyfikator ceny (`lookup_key`) z katalogu dla pary (tier, interwał). */
export function catalogPriceFor(
  tierKey: string | null | undefined,
  interval: string,
): string | null {
  if (!tierKey) return null;
  return (
    BILLING_CATALOG.find((e) => e.tierKey === tierKey && e.interval === interval)?.priceId ?? null
  );
}

/** Identyfikator ceny Stripe (`price_...`) dla czytelnego `lookup_key` z katalogu. */
export async function resolveProviderPriceId(
  env: StripeEnv,
  lookupKey: string,
): Promise<string | null> {
  try {
    const stripe = createStripeClient(env);
    const result = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
    return result.data[0]?.id ?? null;
  } catch (e) {
    console.error("[payments] price lookup failed", lookupKey, getStripeErrorMessage(e));
    return null;
  }
}

/** Anulowanie z zachowaniem opłaconego okresu (`cancel_at_period_end`). */
export async function cancelSubscriptionAtPeriodEnd(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = createStripeClient(env);
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Anulowanie ze skutkiem natychmiastowym.
 * Używane przy usunięciu konta: po skasowaniu użytkownika nie ma komu wysłać
 * przypomnienia ani obsłużyć końca okresu, więc cykliczne obciążenia muszą
 * ustać od razu - inaczej klient płaciłby za konto, którego już nie ma.
 */
export async function cancelSubscriptionImmediately(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = createStripeClient(env);
    await stripe.subscriptions.cancel(subscriptionId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/** Cofnięcie zaplanowanego anulowania, dopóki opłacony okres trwa. */
export async function resumeScheduledCancellation(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = createStripeClient(env);
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: false });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/** Wstrzymanie poboru płatności (subskrypcja pozostaje aktywna, ale nie jest fakturowana). */
export async function pauseSubscriptionCollection(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = createStripeClient(env);
    await stripe.subscriptions.update(subscriptionId, {
      pause_collection: { behavior: "void" },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/** Wznowienie poboru płatności wstrzymanej subskrypcji, od zaraz. */
export async function resumePausedSubscription(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const stripe = createStripeClient(env);
    await stripe.subscriptions.update(subscriptionId, { pause_collection: null });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

export interface SubscriptionSnapshot {
  /** Czytelny identyfikator aktualnej ceny (`lookup_key`). */
  priceId: string | null;
  currentPeriodEnd: string | null;
  quantity: number;
}

/** Bieżący stan subskrypcji u dostawcy - potrzebny do kierunku zmiany planu. */
export async function fetchSubscriptionSnapshot(
  env: StripeEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult<{ snapshot: SubscriptionSnapshot }>> {
  try {
    const stripe = createStripeClient(env);
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    });
    const item = sub.items.data[0];
    const price = item?.price as Stripe.Price | undefined;
    return {
      ok: true,
      snapshot: {
        priceId: price?.lookup_key ?? null,
        currentPeriodEnd: item?.current_period_end
          ? new Date(item.current_period_end * 1000).toISOString()
          : null,
        quantity: item?.quantity ?? 1,
      },
    };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Zmiana planu. Upgrade rozlicza się od razu (`always_invoice`),
 * downgrade dopiero od nowego okresu (`none` - bez proraty, harmonogram na
 * koniec okresu) - zgodnie z regułą biznesową uzgodnioną dla subskrypcji.
 */
export async function changeSubscriptionPrice(
  env: StripeEnv,
  subscriptionId: string,
  params: { newPriceExternalId: string; quantity: number; direction: "upgrade" | "downgrade" },
): Promise<SubscriptionOpResult<{ currentPeriodEnd: string | null }>> {
  const providerPriceId = await resolveProviderPriceId(env, params.newPriceExternalId);
  if (!providerPriceId) return { ok: false, error: "price_missing" };

  const isUpgrade = params.direction === "upgrade";
  try {
    const stripe = createStripeClient(env);
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = current.items.data[0]?.id;
    if (!itemId) return { ok: false, error: "no_subscription_item" };

    if (isUpgrade) {
      // Upgrade: proporcjonalne rozliczenie od razu, kasujemy zaplanowane anulowanie.
      const updated = await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: providerPriceId, quantity: Math.max(1, params.quantity) }],
        proration_behavior: "always_invoice",
        cancel_at_period_end: false,
      });
      return {
        ok: true,
        currentPeriodEnd: updated.items.data[0]?.current_period_end
          ? new Date(updated.items.data[0].current_period_end * 1000).toISOString()
          : null,
      };
    }

    // Downgrade: bez proraty, zmiana obowiązuje dopiero od nowego okresu -
    // harmonogram zamiast natychmiastowej podmiany pozycji.
    await stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });
    const schedule = await stripe.subscriptionSchedules.list({
      customer: typeof current.customer === "string" ? current.customer : current.customer.id,
      limit: 1,
    });
    const scheduleId = schedule.data.find((s) => s.subscription === subscriptionId)?.id;
    if (!scheduleId) return { ok: false, error: "schedule_missing" };
    const currentPhase = current.items.data.map((i) => ({
      price: typeof i.price === "string" ? i.price : i.price.id,
      quantity: i.quantity,
    }));
    const periodStart = current.items.data[0]?.current_period_start ?? 0;
    const periodEnd = current.items.data[0]?.current_period_end ?? 0;
    await stripe.subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      phases: [
        {
          items: currentPhase,
          start_date: periodStart,
          end_date: periodEnd,
        },
        {
          items: [{ price: providerPriceId, quantity: Math.max(1, params.quantity) }],
        },
      ],
    });
    return {
      ok: true,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}

/**
 * Zmiana LICZBY MIEJSC w planie za miejsce (plan Zespół). Cena zostaje ta sama,
 * zmienia się tylko ilość. Zwiększenie rozliczamy natychmiast proporcjonalnie
 * (klient dostaje miejsca od razu), zmniejszenie dopiero od nowego okresu -
 * opłacony okres należy się klientowi w całości.
 */
export async function updateSubscriptionQuantity(
  env: StripeEnv,
  subscriptionId: string,
  params: { priceExternalId: string; quantity: number; previousQuantity: number },
): Promise<SubscriptionOpResult<{ quantity: number }>> {
  const quantity = Math.max(1, Math.min(500, Math.trunc(params.quantity)));
  if (quantity === params.previousQuantity) return { ok: true, quantity };

  const providerPriceId = await resolveProviderPriceId(env, params.priceExternalId);
  if (!providerPriceId) return { ok: false, error: "price_missing" };

  const isIncrease = quantity > params.previousQuantity;
  try {
    const stripe = createStripeClient(env);
    const current = await stripe.subscriptions.retrieve(subscriptionId);
    const itemId = current.items.data[0]?.id;
    if (!itemId) return { ok: false, error: "no_subscription_item" };

    if (isIncrease) {
      await stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: providerPriceId, quantity }],
        proration_behavior: "always_invoice",
      });
      return { ok: true, quantity };
    }

    // Zmniejszenie miejsc: bez proraty, obowiązuje dopiero od nowego okresu -
    // ustawiamy docelową ilość, ale rozliczenie odkładamy na koniec cyklu.
    await stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: providerPriceId, quantity }],
      proration_behavior: "none",
    });
    return { ok: true, quantity };
  } catch (e) {
    return { ok: false, error: getStripeErrorMessage(e) };
  }
}
