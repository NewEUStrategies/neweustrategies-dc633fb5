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
import { getStripeClient, type StripeEnv, type VerifiedWebhookEvent } from "@/lib/stripe.server";

export interface SelfSyncResult {
  /** Liczba subskrypcji pobranych od operatora. */
  scanned: number;
  /** Liczba zdarzeń faktycznie przetworzonych (reszta to `skipped`). */
  applied: number;
  /** Statusy subskrypcji po stronie operatora - do podglądu w UI. */
  statuses: string[];
}

/**
 * Znacznik i identyfikator zdarzenia syntetycznego (1.1).
 *
 * Stan z `subscriptions.retrieve` jest prawdziwy na chwilę ODCZYTU, więc
 * znacznik bierzemy PRZED odczytem i ucinamy do pełnej sekundy minus jedna.
 * Stripe stempluje zdarzenia z rozdzielczością sekundy: dawny znacznik
 * „teraz" w milisekundach PO odczycie (np. 10:00:00.600) robił z
 * `customer.subscription.updated` wysłanego w tej samej sekundzie (10:00:00)
 * zdarzenie spóźnione - opłacona subskrypcja zostawała `incomplete`, a klient
 * bez dostępu aż do następnego zdarzenia. Teraz każde zdarzenie operatora
 * z sekundy odczytu albo późniejszej jest od synchronizacji ŚWIEŻSZE, a
 * starsze i tak opisuje stan, który odczyt już widział.
 *
 * Identyfikator jest stały w obrębie sekundy: ponowienie tego samego
 * kliknięcia to `replay` (skutki idempotentne), a nie remis z odczytem API.
 */
function selfSyncMark(
  subscriptionId: string,
  readStartedAt: number,
): { occurredAt: string; eventId: string } {
  const second = Math.floor(readStartedAt / 1000);
  return {
    occurredAt: new Date((second - 1) * 1000).toISOString(),
    eventId: `self-sync:${subscriptionId}:${second}`,
  };
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
  const stripe = await getStripeClient(environment);
  const ids = await collectSubscriptionIds(stripe, userId, localSubscriptionIds);
  if (ids.length === 0) return { scanned: 0, applied: 0, statuses: [] };

  const { normalizeStripeEvent } = await import("@/lib/billing/stripeEvents.server");
  const { dispatchWebhookEvent } = await import("@/lib/billing/webhookDispatch.server");

  let applied = 0;
  const statuses: string[] = [];

  for (const id of ids) {
    // Znacznik PRZED odczytem - patrz `selfSyncMark`.
    const mark = selfSyncMark(id, Date.now());
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
      eventId: mark.eventId,
      eventType: normalized.eventType,
      data: normalized.data,
      environment,
      occurredAt: mark.occurredAt,
    });
    if (outcome === "processed") applied += 1;
  }

  return { scanned: ids.length, applied, statuses };
}
