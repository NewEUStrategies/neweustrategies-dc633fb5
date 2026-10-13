// Zamknięcie konta od strony rozliczeń.
//
// Usunięcie konta musi zatrzymać pieniądze PRZED skasowaniem danych: po
// `deleteUser` nie ma już z czym powiązać subskrypcji, a operator dalej
// obciążałby kartę w kolejnych okresach. Dlatego anulujemy natychmiast
// (nie na koniec okresu) i dopiero wtedy wolno usuwać użytkownika.
//
// TRZY ŹRÓDŁA subskrypcji do anulowania (audyt SUB-11) - wcześniej było tylko
// pierwsze, więc karta darczyńcy była obciążana co miesiąc po usunięciu konta,
// a rezygnacja szła wyłącznie „przez redakcję":
//   (a) plany - otwarte wiersze `subscriptions` (środowisko bramki wdrożenia),
//   (b) darowizny cykliczne - `donations.provider_subscription_id` konta,
//       w środowisku WIERSZA (subskrypcja darowizny nie ma wiersza
//       w `subscriptions`: `webhookDispatch.server` celowo omija tam plany),
//   (c) subskrypcje znalezione u operatora po `metadata.userId` (Search, to
//       samo zapytanie co samoobsługowa synchronizacja) - także te, których
//       webhook nigdy nie dotarł i baza o nich nie wie.
// Zbiór jest deduplikowany po (środowisko, subskrypcja), każde anulowanie ma
// deterministyczny klucz idempotencji, a subskrypcja już zamknięta u operatora
// nie jest błędem. Każda inna porażka (odmowa, niedostępny Search) ZATRZYMUJE
// kasowanie konta - tak samo głośno jak dotąd odmowa przy planie.
//
// Na końcu dziennik webhooków traci dane osobowe zamykanego konta
// (`payment_webhook_events_redact_for_user`) - pełne ładunki operatora
// (e-mail, adres, dane karty) nie mają podstawy, by przeżyć konto.
//
// Moduł server-only (klucze bramki + service role).
import type Stripe from "stripe";
import type { StripeEnv } from "@/lib/stripe.server";

export interface AccountClosureResult {
  /** Ile otwartych subskrypcji (planów i darowizn cyklicznych) anulowano u operatora. */
  canceled: number;
  /** Identyfikatory, których operator nie pozwolił anulować (albo nie dało się ich ustalić). */
  failed: string[];
}

const OPEN_STATUSES = ["active", "trialing", "past_due", "paused"];

/** Subskrypcja w tym stanie już nigdy nie obciąży karty. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["canceled", "incomplete_expired"]);

/** Sufit wyników Search na środowisko (100 x 5 stron) - konto nie ma ich tylu. */
const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 5;

interface ClosureTarget {
  environment: StripeEnv;
  subscriptionId: string;
  kind: "plan" | "donation";
  /** Cena planu z lokalnego wiersza - wyłącznie do treści maila potwierdzającego. */
  priceId: string | null;
  /** Mail potwierdzający idzie tylko dla planu znanego z NASZEGO wiersza. */
  notify: boolean;
}

type CancelOutcome = { ok: true; alreadyCanceled: boolean } | { ok: false; error: string };

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Środowiska, w których szukamy darowizn i subskrypcji bez wiersza. Produkcja
 * obsługuje wyłącznie `live` (`resolveEnvironment`) - obiekt z piaskownicy nie
 * pobiera realnych pieniędzy, więc nie wstrzymuje usunięcia konta.
 */
function closureEnvironments(): StripeEnv[] {
  return isProduction() ? ["live"] : ["sandbox", "live"];
}

/**
 * Czy bramka operatora ma poświadczenia dla środowiska. Wyszukiwanie (c) nie ma
 * lokalnego dowodu, że cokolwiek istnieje - w instalacji bez operatora (tryb
 * mock) nie może więc blokować usuwania kont.
 */
async function operatorConfigured(env: StripeEnv): Promise<boolean> {
  const { getConnectionApiKey } = await import("@/lib/stripe.server");
  try {
    getConnectionApiKey(env);
  } catch {
    return false;
  }
  return Boolean(process.env.LOVABLE_API_KEY);
}

function isResourceMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; raw?: { code?: unknown } };
  return (e.raw?.code ?? e.code) === "resource_missing";
}

/**
 * Anulowanie natychmiastowe z kluczem idempotencji. Odmowa operatora nie jest
 * jeszcze porażką: subskrypcja mogła zostać zamknięta wcześniej (rezygnacja,
 * wygaśnięcie, poprzednia próba usunięcia konta) - wtedy `retrieve` to
 * potwierdza i zamykanie idzie dalej. Obiekt nieznany operatorowi w tym
 * środowisku (`resource_missing` także przy odczycie) również nie obciąży
 * karty. Każdy inny wynik to porażka, którą wołający raportuje.
 */
async function cancelForClosure(stripe: Stripe, subscriptionId: string): Promise<CancelOutcome> {
  const { getStripeErrorMessage } = await import("@/lib/stripe.server");
  try {
    await stripe.subscriptions.cancel(
      subscriptionId,
      {},
      { idempotencyKey: `account-closure:${subscriptionId}` },
    );
    return { ok: true, alreadyCanceled: false };
  } catch (cancelError) {
    try {
      const current = await stripe.subscriptions.retrieve(subscriptionId);
      if (TERMINAL_STATUSES.has(current.status)) return { ok: true, alreadyCanceled: true };
    } catch (retrieveError) {
      if (isResourceMissing(retrieveError)) return { ok: true, alreadyCanceled: true };
    }
    return { ok: false, error: getStripeErrorMessage(cancelError) };
  }
}

function targetKey(environment: StripeEnv, subscriptionId: string): string {
  return `${environment}:${subscriptionId}`;
}

/**
 * Anuluje wszystkie otwarte subskrypcje użytkownika ze skutkiem natychmiastowym
 * i potwierdza to mailem. Rzuca, gdy operator odmówi - kasowanie konta nie może
 * zostawić za sobą płatnego abonamentu ani darowizny cyklicznej bez właściciela.
 */
export async function closeBillingForUser(
  userId: string,
  email: string | null,
): Promise<AccountClosureResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { subscriptionEnvironment, isProviderSubscriptionRef } =
    await import("@/lib/billing/subscriptionProvider.server");
  const { getStripeClient } = await import("@/lib/stripe.server");

  const env: StripeEnv = subscriptionEnvironment();
  const { data: rows, error } = await supabaseAdmin
    .from("subscriptions")
    .select("provider_subscription_id, status, price_id")
    .eq("user_id", userId)
    .eq("environment", env)
    .in("status", OPEN_STATUSES);
  if (error) throw new Error(`account closure: subscription lookup failed: ${error.message}`);

  // Bez filtra statusu: wiersz raty bywa zwrócony albo zamknięty, a sama
  // subskrypcja dalej żyje. Zamknięta u operatora nie jest błędem (niżej).
  const allowed = closureEnvironments();
  const { data: donationRows, error: donationError } = await supabaseAdmin
    .from("donations")
    .select("provider_subscription_id, environment")
    .eq("user_id", userId)
    .eq("recurring", true)
    .in("environment", allowed)
    .not("provider_subscription_id", "is", null);
  if (donationError) {
    throw new Error(`account closure: donation lookup failed: ${donationError.message}`);
  }

  const targets = new Map<string, ClosureTarget>();
  for (const row of rows ?? []) {
    const ref = row.provider_subscription_id;
    if (!isProviderSubscriptionRef(ref)) continue;
    targets.set(targetKey(env, ref), {
      environment: env,
      subscriptionId: ref,
      kind: "plan",
      priceId: row.price_id,
      notify: true,
    });
  }
  for (const row of donationRows ?? []) {
    const ref = row.provider_subscription_id;
    const rowEnv = row.environment === "live" ? "live" : "sandbox";
    if (!isProviderSubscriptionRef(ref) || !allowed.includes(rowEnv)) continue;
    const key = targetKey(rowEnv, ref);
    if (targets.has(key)) continue;
    targets.set(key, {
      environment: rowEnv,
      subscriptionId: ref,
      kind: "donation",
      priceId: null,
      notify: false,
    });
  }

  // Jeden klient na środowisko - także dla Search, więc odmowa budowy klienta
  // (brak poświadczeń) obejmuje wszystkie subskrypcje tego środowiska naraz.
  const clients = new Map<StripeEnv, Promise<Stripe>>();
  const clientFor = (environment: StripeEnv): Promise<Stripe> => {
    let client = clients.get(environment);
    if (!client) {
      client = getStripeClient(environment);
      clients.set(environment, client);
    }
    return client;
  };

  const result: AccountClosureResult = { canceled: 0, failed: [] };

  const { searchSubscriptionsByUserId } = await import("@/lib/billing/selfSync.server");
  for (const searchEnv of allowed) {
    if (!(await operatorConfigured(searchEnv))) continue;
    try {
      const found = await searchSubscriptionsByUserId(await clientFor(searchEnv), userId, {
        limit: SEARCH_PAGE_SIZE,
        maxPages: SEARCH_MAX_PAGES,
      });
      for (const sub of found) {
        // Search dopasowuje metadane, ale właściciela potwierdzamy jawnie - tak
        // jak `selfSync.server`: cudza subskrypcja nigdy nie jest anulowana.
        if (sub.metadata?.userId !== userId || TERMINAL_STATUSES.has(sub.status)) continue;
        if (!isProviderSubscriptionRef(sub.id)) continue;
        const key = targetKey(searchEnv, sub.id);
        if (targets.has(key)) continue;
        targets.set(key, {
          environment: searchEnv,
          subscriptionId: sub.id,
          kind: sub.metadata?.purpose === "donation" ? "donation" : "plan",
          priceId: null,
          notify: false,
        });
      }
    } catch (searchError) {
      // Niedostępny Search to niewiadoma, a nie „nic nie ma": subskrypcja bez
      // wiersza (zgubiony webhook) obciążałaby kartę po usunięciu konta.
      console.error("[account] subscription search failed", searchEnv, searchError);
      result.failed.push(`search:${searchEnv}`);
    }
  }

  const nowIso = new Date().toISOString();

  for (const target of targets.values()) {
    const ref = target.subscriptionId;
    let op: CancelOutcome;
    try {
      op = await cancelForClosure(await clientFor(target.environment), ref);
    } catch (clientError) {
      op = { ok: false, error: clientError instanceof Error ? clientError.message : "client" };
    }
    if (!op.ok) {
      // Sprzeczność stanu: operator zna subskrypcję, my jej już nie znajdziemy.
      // Zgłaszamy zamiast po cichu kasować konto.
      console.error("[account] subscription cancel failed", ref, op.error);
      result.failed.push(ref);
      continue;
    }

    if (target.kind === "donation") {
      // Raty już opłacone zostają (to dowody wpłat), zamyka się wyłącznie
      // wiersz oczekujący - ta sama reguła co przy webhooku `deleted`.
      const { syncDonationSubscription } = await import("@/lib/billing/donations.server");
      await syncDonationSubscription({
        subscriptionId: ref,
        status: "canceled",
        environment: target.environment,
      });
    } else {
      const { error: updErr } = await supabaseAdmin
        .from("subscriptions")
        .update({
          status: "canceled",
          cancel_at_period_end: false,
          trial_ends_at: null,
          updated_at: nowIso,
        })
        .eq("provider_subscription_id", ref)
        .eq("environment", target.environment);
      if (updErr) {
        throw new Error(`account closure: subscription update failed: ${updErr.message}`);
      }

      const { revokeSubscriptionEntitlement } = await import("@/lib/billing/grant.server");
      await revokeSubscriptionEntitlement(ref, nowIso);
    }

    if (!op.alreadyCanceled) result.canceled += 1;

    // Potwierdzenie anulowania - jedyny mail, jaki ma jeszcze sens wysłać na
    // adres zamykanego konta.
    if (email && target.notify) {
      try {
        const { resolvePlanForPrice } = await import("@/lib/billing/purchaseEffects.server");
        const plan = target.priceId ? await resolvePlanForPrice(target.priceId, { userId }) : null;
        const { notifySubscriptionEmail } = await import("@/lib/billing/notifications.server");
        await notifySubscriptionEmail({
          kind: "subscription_canceled",
          userId,
          planId: plan?.planId ?? null,
          periodEnd: nowIso,
          idempotencySeed: `account-closure:${ref}`,
        });
      } catch (err) {
        console.error("[account] closure email failed", ref, err);
      }
    }
  }

  if (result.failed.length > 0) {
    throw new Error(
      "Nie udało się anulować aktywnej subskrypcji u operatora płatności. Spróbuj ponownie za chwilę lub napisz do nas - konto nie zostało usunięte.",
    );
  }

  // Dopiero po komplecie anulowań: przerwane zamknięcie zostawia dziennik
  // w całości do diagnozy, a ponowienie (idempotentne) dokończy oba kroki.
  const { error: redactError } = await supabaseAdmin.rpc("payment_webhook_events_redact_for_user", {
    p_user_id: userId,
  });
  if (redactError) {
    throw new Error(`account closure: webhook log pseudonymisation failed: ${redactError.message}`);
  }

  return result;
}
