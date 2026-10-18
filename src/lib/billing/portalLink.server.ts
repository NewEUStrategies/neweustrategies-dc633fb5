// Portal operatora płatności: wejście mailem i sesja tworzona na żądanie.
//
// Portal jest jedynym miejscem, w którym kupujący zmienia metodę płatności,
// pobiera faktury i anuluje subskrypcję. Sesja portalu jest jednorazowa
// i żyje kilka minut, dlatego NIE trafia do maila: mail niesie STAŁY adres
// aplikacji (`PROFILE_PORTAL_PATH` na hoście najemcy), a sesja powstaje dopiero
// wtedy, gdy zalogowany właściciel ten adres otworzy (`openMyBillingPortal`).
// Do 12.10.2026 mail niósł adres sesji wprost - po godzinie w skrzynce link
// był martwy, a powrót z portalu szedł na nieistniejące `/profil` (albo, bez
// zmiennej środowiskowej, na `example.com`).
//
// GRANICA NAJEMCY. Moduł pracuje kluczem serwisowym (ponad RLS), więc jedyną
// granicą jest jawny `tenantId` przekazany przez wołającego - zawsze z SESJI
// (profil wołającego), nigdy z ładunku. Konto i subskrypcja spoza tego najemcy
// dostają TEN SAM kod odmowy co konto bez subskrypcji: inaczej panel
// administratora najemcy B potwierdzałby istnienie kont najemcy A.
//
// Moduł jest server-only (klucze bramki + service role).
import type { SupabaseClient } from "@supabase/supabase-js";

import type { StripeEnv } from "@/lib/stripe.server";
import { resolveRecipient } from "@/lib/billing/notifications.server";
import { sendTxEmail } from "@/lib/email/transactional.server";
import { PROFILE_PLAN_PATH, PROFILE_PORTAL_PATH } from "@/lib/profile/routes";

export interface PortalUrls {
  overviewUrl: string;
  updatePaymentMethodUrl: string | null;
  cancelUrl: string | null;
}

export type PortalLinkResult =
  { ok: true; urls: PortalUrls } | { ok: false; error: "no_customer" | "portal_failed" };

/** Zakres operacji na portalu - najemca ZAWSZE z sesji wołającego. */
export interface PortalScope {
  tenantId: string;
}

/**
 * Ścieżka wejścia do portalu zapisywana w mailu. Środowisko jedzie w adresie,
 * bo mail dotyczy konkretnej subskrypcji (panel administratora wysyła link
 * dla wiersza z `sandbox` albo `live`) - strona wejścia nie może go zgadywać
 * z konfiguracji przeglądarki.
 */
export function portalEntryPath(environment: StripeEnv): string {
  return `${PROFILE_PORTAL_PATH}?environment=${environment}`;
}

/**
 * Klient operatora dla `userId` - wyłącznie wtedy, gdy KONTO i SUBSKRYPCJA
 * należą do najemcy `tenantId`. Obie kontrole są potrzebne: profil przesądza
 * o przynależności osoby, `subscriptions.tenant_id` - o tym, czyj jest klient
 * operatora (jedno konto operatora obsługuje wielu najemców). `null` znaczy
 * jedno i to samo dla każdej przyczyny odmowy.
 */
async function portalCustomer(
  supabase: SupabaseClient,
  userId: string,
  environment: StripeEnv,
  scope: PortalScope,
): Promise<{ customerId: string } | null> {
  if (!scope.tenantId) return null;

  const { data: member, error: memberError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle();
  if (memberError) throw new Error(`odczyt profilu nie powiódł się: ${memberError.message}`);
  if (!member) return null;

  const { data, error } = await supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("user_id", userId)
    .eq("environment", environment)
    .eq("tenant_id", scope.tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Awaria odczytu to awaria (`portal_failed` / `send_failed` u wołających),
  // nie „brak klienta": `no_customer` mówi klientowi, że konta u operatora
  // nie ma, a administratorowi - że subskrypcji nie ma. Odczyt startuje
  // dopiero po kontroli przynależności, więc błąd nie zdradza obcych kont.
  if (error) throw new Error(`odczyt subskrypcji nie powiódł się: ${error.message}`);
  if (!data?.provider_customer_id) return null;
  return { customerId: data.provider_customer_id as string };
}

/**
 * Tworzy sesję portalu klienta dla `userId` w najemcy `scope.tenantId`. Woła ją
 * WYŁĄCZNIE strona wejścia z maila, dla użytkownika z sesji - adres sesji
 * nigdy nie opuszcza odpowiedzi do jego przeglądarki. Nigdy nie rzuca.
 *
 * Adres powrotu idzie przez tę samą bramkę co przycisk portalu w profilu
 * (`absoluteReturnUrl`): host żądania tylko wtedy, gdy należy do serwisu,
 * i ścieżka do istniejącej trasy (`/profile/plan`).
 */
export async function createPortalLinkForUser(
  userId: string,
  environment: StripeEnv,
  scope: PortalScope,
  returnPath: string = PROFILE_PLAN_PATH,
): Promise<PortalLinkResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const customer = await portalCustomer(supabase, userId, environment, scope);
    if (!customer) return { ok: false, error: "no_customer" };

    const { getStripeClient } = await import("@/lib/stripe.server");
    const { absoluteReturnUrl } = await import("@/lib/billing/returnUrl.server");
    const stripe = await getStripeClient(environment);
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.customerId,
      return_url: absoluteReturnUrl(returnPath),
    });
    // Portal Stripe jest jednym ogólnym adresem (bez osobnych podadresów per
    // akcja jak w Paddle) - użytkownik z niego samodzielnie wybiera anulowanie
    // czy zmianę metody płatności.
    return {
      ok: true,
      urls: {
        overviewUrl: session.url,
        updatePaymentMethodUrl: null,
        cancelUrl: null,
      },
    };
  } catch (err) {
    console.error("[billing] portal session failed", err);
    return { ok: false, error: "portal_failed" };
  }
}

export type PortalEmailResult =
  | { ok: true; email: string }
  | { ok: false; error: "no_customer" | "no_recipient" | "send_failed" };

export interface PortalEmailInput {
  userId: string;
  environment: StripeEnv;
  /**
   * Najemca wołającego, rozwiązany z SESJI (profil użytkownika albo profil
   * administratora). Wyznacza granicę odczytu i host adresu w mailu.
   */
  tenantId: string;
  /**
   * Ziarno idempotencji. Administrator wysyłający link ponownie podaje nowe
   * ziarno (znacznik czasu), żeby świadome ponowienie nie zostało odrzucone
   * jako duplikat.
   */
  idempotencySeed: string;
}

/**
 * Wysyła mail ze STAŁYM adresem wejścia do portalu. Nigdy nie rzuca.
 *
 * Kolejność jest wiążąca: najpierw granica najemcy i istnienie klienta
 * operatora, dopiero potem adresat. Odwrotna kolejność oddawałaby
 * administratorowi obcego najemcy rozróżnienie „konto bez adresu" /
 * „brak konta" - czyli wyrocznię istnienia kont.
 */
export async function sendPortalLinkEmail(input: PortalEmailInput): Promise<PortalEmailResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const supabase = supabaseAdmin as unknown as SupabaseClient;

    const customer = await portalCustomer(supabase, input.userId, input.environment, {
      tenantId: input.tenantId,
    });
    if (!customer) return { ok: false, error: "no_customer" };

    const recipient = await resolveRecipient(supabase, input.userId);
    if (!recipient) return { ok: false, error: "no_recipient" };

    // Host najemcy z katalogu (`tenants.domain`), nie stała marki i nie host
    // żądania: administrator bywa na hoście podglądu, a adresat ma wrócić tam,
    // gdzie ma konto. Ścieżki `/profile` nie mają prefiksu języka.
    const { tenantPublicUrl } = await import("@/lib/events/tenantPublicOrigin.server");
    const ctaUrl = await tenantPublicUrl(
      input.tenantId,
      portalEntryPath(input.environment),
      recipient.lang,
    );

    const result = await sendTxEmail({
      type: "customer_portal_link",
      to: recipient.email,
      lang: recipient.lang,
      metaName: recipient.name,
      ctaUrl,
      idempotencyKey: `customer_portal_link:${input.userId}:${input.idempotencySeed}`,
      tenantId: input.tenantId,
    });
    if (!result.ok) return { ok: false, error: "send_failed" };
    return { ok: true, email: recipient.email };
  } catch (err) {
    console.error("[billing] portal link email failed", err);
    return { ok: false, error: "send_failed" };
  }
}
