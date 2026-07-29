// Operacje na istniejącej subskrypcji u dostawcy (anulowanie na koniec okresu,
// wznowienie, zmiana planu). Wydzielone z `checkout.functions`, bo moduł jest
// server-only (klucze bramki) i musi być importowany dynamicznie w handlerach.
//
// Reguła kolejności obowiązująca wszystkich wywołujących: NAJPIERW dostawca,
// potem baza. Jeśli operator odmówi, wiersz w bazie nie może twierdzić, że
// subskrypcja jest anulowana/zmieniona - klient byłby dalej obciążany.
import { PADDLE_CATALOG } from "@/lib/billing/paddleCatalog";
import { gatewayFetch, type PaddleEnv } from "@/lib/paddle.server";

// eslint-disable-next-line @typescript-eslint/ban-types
export type SubscriptionOpResult<T extends object = {}> =
  | ({ ok: true } & T)
  | { ok: false; error: string };




/** Identyfikator subskrypcji u dostawcy (`sub_...`); inne wartości ignorujemy. */
export function isProviderSubscriptionRef(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.startsWith("sub_");
}

/**
 * Środowisko bramki dla operacji serwerowej bez kontekstu klienta.
 * Produkcyjny build obsługuje wyłącznie środowisko live.
 */
export function subscriptionEnvironment(): PaddleEnv {
  return process.env.NODE_ENV === "production" ? "live" : "sandbox";
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status}: ${text.slice(0, 300)}`;
}

/** Anulowanie z zachowaniem opłaconego okresu (`next_billing_period`). */
export async function cancelSubscriptionAtPeriodEnd(
  env: PaddleEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const res = await gatewayFetch(env, `/subscriptions/${subscriptionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ effective_from: "next_billing_period" }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Cofnięcie zaplanowanego anulowania, dopóki opłacony okres trwa. */
export async function resumeScheduledCancellation(
  env: PaddleEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult> {
  try {
    const res = await gatewayFetch(env, `/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_change: null }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Czytelny identyfikator ceny z katalogu dla pary (tier, interwał).
 * Zwraca `null`, gdy plan nie ma odpowiednika w katalogu dostawcy - wtedy
 * zmiana planu jest niemożliwa i musimy odmówić zamiast zgadywać cenę.
 */
export function catalogPriceFor(
  tierKey: string | null | undefined,
  interval: string,
): string | null {
  if (!tierKey) return null;
  return PADDLE_CATALOG.find((e) => e.tierKey === tierKey && e.interval === interval)?.priceId ?? null;
}

/** Wewnętrzny identyfikator ceny dostawcy dla czytelnego `external_id`. */
export async function resolveProviderPriceId(
  env: PaddleEnv,
  externalId: string,
): Promise<string | null> {
  const res = await gatewayFetch(
    env,
    `/prices?external_id=${encodeURIComponent(externalId)}&status=active`,
  );
  if (!res.ok) {
    console.error("[payments] price lookup failed", externalId, res.status);
    return null;
  }
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return json.data?.[0]?.id ?? null;
}

export interface SubscriptionSnapshot {
  /** Czytelny identyfikator aktualnej ceny (z `import_meta.external_id`). */
  priceId: string | null;
  currentPeriodEnd: string | null;
  quantity: number;
}

/** Bieżący stan subskrypcji u dostawcy - potrzebny do kierunku zmiany planu. */
export async function fetchSubscriptionSnapshot(
  env: PaddleEnv,
  subscriptionId: string,
): Promise<SubscriptionOpResult<{ snapshot: SubscriptionSnapshot }>> {
  try {
    const res = await gatewayFetch(env, `/subscriptions/${subscriptionId}`);
    if (!res.ok) return { ok: false, error: await readError(res) };
    const json = (await res.json()) as {
      data?: {
        current_billing_period?: { ends_at?: string | null } | null;
        items?: Array<{
          quantity?: number;
          price?: { import_meta?: { external_id?: string | null } | null } | null;
        }>;
      };
    };
    const item = json.data?.items?.[0];
    return {
      ok: true,
      snapshot: {
        priceId: item?.price?.import_meta?.external_id ?? null,
        currentPeriodEnd: json.data?.current_billing_period?.ends_at ?? null,
        quantity: item?.quantity ?? 1,
      },
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Zmiana planu. Upgrade rozlicza się od razu (`prorated_immediately`),
 * downgrade dopiero od nowego okresu (`do_not_bill` + `next_billing_period`) -
 * zgodnie z regułą biznesową uzgodnioną dla subskrypcji.
 */
export async function changeSubscriptionPrice(
  env: PaddleEnv,
  subscriptionId: string,
  params: { newPriceExternalId: string; quantity: number; direction: "upgrade" | "downgrade" },
): Promise<SubscriptionOpResult<{ currentPeriodEnd: string | null }>> {
  const providerPriceId = await resolveProviderPriceId(env, params.newPriceExternalId);
  if (!providerPriceId) return { ok: false, error: "price_missing" };

  const isUpgrade = params.direction === "upgrade";
  try {
    const res = await gatewayFetch(env, `/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: providerPriceId, quantity: Math.max(1, params.quantity) }],
        proration_billing_mode: isUpgrade ? "prorated_immediately" : "do_not_bill",
        ...(isUpgrade ? {} : { billing_cycle: { effective_from: "next_billing_period" } }),
        // Zmiana planu jest deklaracją pozostania - kasuje zaplanowane anulowanie.
        scheduled_change: null,
        on_payment_failure: "prevent_change",
      }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    const json = (await res.json()) as {
      data?: { current_billing_period?: { ends_at?: string | null } | null };
    };
    return { ok: true, currentPeriodEnd: json.data?.current_billing_period?.ends_at ?? null };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Zmiana LICZBY MIEJSC w planie za miejsce (plan Zespół). Cena zostaje ta sama,
 * zmienia się tylko ilość. Zwiększenie rozliczamy natychmiast proporcjonalnie
 * (klient dostaje miejsca od razu), zmniejszenie dopiero od nowego okresu -
 * opłacony okres należy się klientowi w całości.
 */
export async function updateSubscriptionQuantity(
  env: PaddleEnv,
  subscriptionId: string,
  params: { priceExternalId: string; quantity: number; previousQuantity: number },
): Promise<SubscriptionOpResult<{ quantity: number }>> {
  const quantity = Math.max(1, Math.min(500, Math.trunc(params.quantity)));
  if (quantity === params.previousQuantity) return { ok: true, quantity };

  const providerPriceId = await resolveProviderPriceId(env, params.priceExternalId);
  if (!providerPriceId) return { ok: false, error: "price_missing" };

  const isIncrease = quantity > params.previousQuantity;
  try {
    const res = await gatewayFetch(env, `/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        items: [{ price_id: providerPriceId, quantity }],
        proration_billing_mode: isIncrease ? "prorated_immediately" : "do_not_bill",
        ...(isIncrease ? {} : { billing_cycle: { effective_from: "next_billing_period" } }),
        on_payment_failure: "prevent_change",
      }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true, quantity };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
