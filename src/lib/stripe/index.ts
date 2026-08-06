// Konfiguracja bramki płatności po stronie przeglądarki - WARSTWA BEZ SDK.
//
// Token publikowalny jest wstrzykiwany per środowisko (.env.development ->
// sandbox, .env.production -> live). Środowisko wyprowadzamy z PREFIKSU
// tokena - nigdy nie zgadujemy "live" przy braku konfiguracji, bo to kończy
// się kryptycznym błędem serwera zamiast czytelnego komunikatu na stronie.
//
// GRANICA BUNDLA (2026-08-06, regres złapany audytem r2): ten moduł nie może
// importować `@stripe/stripe-js`. Siedemnaście miejsc w aplikacji pyta go
// wyłącznie o ŚRODOWISKO (`getStripeEnvironment*`, `isPaymentsConfigured`) -
// m.in. `Paywall`, który wisi na trasie uniwersalnej `$.tsx`, czyli na KAŻDYM
// publicznym wpisie i stronie. Dopóki `loadStripe` był tutaj, jeden import
// stałej środowiskowej ciągnął przeglądarkowe SDK operatora płatności do
// chunku wejściowego - anonimowy czytelnik, który nigdy nie otworzy kasy,
// pobierał adres `js.stripe.com` i kod ramki.
//
// Samo SDK żyje więc w `@/lib/stripe/sdk` i wolno je importować WYŁĄCZNIE z
// leniwych chunków kasy (`components/checkout/StripeEmbeddedFrame.tsx`).
// Inwariant pilnuje `src/lib/ci/paymentSdkGraph.ts` (bramka bez builda) oraz
// budżet publiczny w `scripts/check-bundle-size.ts`.

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

/**
 * Token publikowalny dla loadera SDK. Eksportowany osobno, żeby `sdk.ts` nie
 * musiał drugi raz czytać `import.meta.env` (jedno źródło prawdy) i żeby
 * walidacja prefiksu została w tym module.
 */
export function paymentsClientToken(): string {
  paymentsEnvironment();
  return clientToken as string;
}
