// Konfiguracja bramki płatności po stronie przeglądarki.
// Token publikowalny jest wstrzykiwany per środowisko (.env.development ->
// sandbox, .env.production -> live). Środowisko wyprowadzamy z PREFIKSU
// tokena - nigdy nie zgadujemy "live" przy braku konfiguracji, bo to kończy
// się kryptycznym błędem serwera zamiast czytelnego komunikatu na stronie.
//
// TEN MODUŁ NIE MOŻE STATYCZNIE IMPORTOWAĆ `@stripe/stripe-js` (2026-08-06).
// Sięga po niego 17 miejsc, w tym powierzchnie czysto informacyjne (klucze
// zapytań `getStripeEnvironmentSafe`, baner trybu testowego, karta subskrypcji).
// Statyczny `import { loadStripe }` sprawiał, że loader SDK operatora płatności
// był WSPÓLNYM przodkiem wszystkich tych modułów i Rollup hoistował go do
// chunku ENTRY - czyli każdy anonimowy czytelnik dowolnego artykułu pobierał i
// parsował kod bramki płatniczej (marker `js.stripe.com` siedział w entry).
// Sam `loadStripe` jest więc importowany DYNAMICZNIE, w `getStripe()`. Dzięki
// temu helpery środowiskowe poniżej są zerokosztowe (czysty parsing prefiksu
// tokena), a SDK schodzi z sieci dopiero przy realnej intencji zakupu.
// Inwariant pilnuje `scripts/check-entry-purity.ts` (blokujący krok CI).
import type { Stripe } from "@stripe/stripe-js";

export type StripeEnv = "sandbox" | "live";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

export function isPaymentsConfigured(): boolean {
  return clientToken?.startsWith("pk_test_") || clientToken?.startsWith("pk_live_") || false;
}

function paymentsEnvironment(): StripeEnv {
  if (clientToken?.startsWith("pk_test_")) return "sandbox";
  if (clientToken?.startsWith("pk_live_")) return "live";
  throw new Error("payments_not_configured");
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

/** Środowisko bez rzucania wyjątku - do zapytań o dane (cache keys, filtry). */
export function getStripeEnvironmentSafe(): StripeEnv {
  if (clientToken?.startsWith("pk_live_")) return "live";
  return "sandbox";
}

let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Instancja Stripe.js - memoizowana, więc `js.stripe.com` schodzi raz na sesję.
 *
 * Rzuca SYNCHRONICZNIE (`payments_not_configured`) przy braku tokena, dokładnie
 * jak poprzednia, statyczna wersja: wołający mają dostać czytelny błąd w swoim
 * try/catch, a nie odrzuconą obietnicę bez obsługi.
 */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    const token = clientToken as string;
    stripePromise = import("@stripe/stripe-js").then(({ loadStripe }) => loadStripe(token));
  }
  return stripePromise;
}

/**
 * Rozgrzewka SDK na INTENCJĘ (hover/focus/pointerdown przycisku zakupu), zanim
 * padnie kliknięcie. Nigdy nie rzuca i nigdy nie raportuje błędu - brak
 * konfiguracji płatności albo offline nie może zaszkodzić stronie, na której
 * czytelnik tylko przesunął kursor nad przyciskiem.
 */
export function preloadStripeSdk(): void {
  if (!isPaymentsConfigured()) return;
  try {
    void getStripe().catch(() => undefined);
  } catch {
    /* payments_not_configured - rozgrzewka jest best-effort */
  }
}
