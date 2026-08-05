// Samoobsługowa synchronizacja subskrypcji użytkownika ze Stripe.
//
// Webhook jest ścieżką podstawową, ale bywa opóźniony albo zgubiony (endpoint
// chwilowo niedostępny, zdarzenie w stanie `failed`). Panel admina ma pełną
// rekoncyliację (`reconcile.server.ts`); ten moduł to jej wąski, bezpieczny
// odpowiednik dla JEDNEGO użytkownika: pobiera jego subskrypcje u operatora i
// przepuszcza je przez dokładnie tę samą ścieżkę co webhook
// (`normalizeStripeEvent` + `dispatchWebhookEvent`), więc jest idempotentny -
// nie duplikuje uprawnień, dokumentów ani maili.
//
// Moduł server-only (klucze bramki płatności).
import type Stripe from "stripe";
import { createStripeClient, type StripeEnv, type VerifiedWebhookEvent } from "@/lib/stripe.server";

export interface SelfSyncResult {
  /** Liczba subskrypcji pobranych od operatora. */
  scanned: number;
  /** Liczba zdarzeń faktycznie przetworzonych (reszta to `skipped`). */
  applied: number;
  /** Statusy subskrypcji po stronie operatora - do podglądu w UI. */
  statuses: string[];
}

/** Identyfikator wygląda jak subskrypcja Stripe. */
function isSubscriptionId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith("sub_");
}

/** Zdarzenie syntetyczne w kształcie webhooka - bez podpisu, tylko lokalnie. */
function syntheticEvent(subscription: Stripe.Subscription): VerifiedWebhookEvent {
  return {
    id: `evt_selfsync_${subscription.id}`,
    type:
      subscription.status === "canceled"
        ? "customer.subscription.deleted"
        : "customer.subscription.updated",
    data: { object: subscription as unknown as Record<string, unknown> },
  } as VerifiedWebhookEvent;
}

/**
 * Zbiera identyfikatory subskrypcji użytkownika: lokalne (tabela
 * `subscriptions`) uzupełnione o wyszukiwanie po `metadata.userId` u operatora,
 * dzięki czemu działa też wtedy, gdy webhook nigdy nie dotarł i baza jest pusta.
 */
async function collectSubscriptionIds(
  stripe: Stripe,
  userId: string,
  localIds: string[],
): Promise<string[]> {
  const ids = new Set<string>(localIds.filter(isSubscriptionId));
  // Zapytanie Search jest interpolowane - wpuszczamy wyłącznie UUID-podobne id.
  if (/^[a-zA-Z0-9_-]+$/.test(userId)) {
    try {
      const found = await stripe.subscriptions.search({
        query: `metadata['userId']:'${userId}'`,
        limit: 20,
      });
      for (const sub of found.data) ids.add(sub.id);
    } catch (error) {
      // Search bywa niedostępny tuż po utworzeniu obiektu (indeks jest
      // asynchroniczny) - lokalne identyfikatory wystarczą do synchronizacji.
      console.error("[selfSync] subscriptions.search failed", error);
    }
  }
  return [...ids];
}

/**
 * Synchronizuje stan subskrypcji jednego użytkownika ze Stripe.
 * `localSubscriptionIds` pochodzi z zapytania wykonanego pod RLS wołającego,
 * więc ten moduł nigdy nie decyduje samodzielnie, czyje dane pobiera.
 */
export async function syncUserSubscriptionsFromProvider(
  environment: StripeEnv,
  userId: string,
  localSubscriptionIds: string[],
): Promise<SelfSyncResult> {
  const stripe = createStripeClient(environment);
  const ids = await collectSubscriptionIds(stripe, userId, localSubscriptionIds);
  if (ids.length === 0) return { scanned: 0, applied: 0, statuses: [] };

  const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
  const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

  let applied = 0;
  const statuses: string[] = [];

  for (const id of ids) {
    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(id, { expand: ["items.data.price"] });
    } catch (error) {
      console.error("[selfSync] subscription retrieve failed", id, error);
      continue;
    }
    // Subskrypcja cudza (np. przeklejony identyfikator) nigdy nie trafia do
    // dyspozytora - metadane operatora są tu jedynym źródłem prawdy.
    const owner = subscription.metadata?.userId;
    if (owner && owner !== userId) continue;

    statuses.push(subscription.status);
    const normalized = normalizeStripeEvent(syntheticEvent(subscription));
    if (!normalized) continue;

    const outcome = await dispatchWebhookEvent({
      eventType: normalized.eventType,
      data: normalized.data,
      environment,
      occurredAt: new Date().toISOString(),
    });
    if (outcome === "processed") applied += 1;
  }

  return { scanned: ids.length, applied, statuses };
}
