// Konfiguracja bramki płatności po stronie przeglądarki.
// Token publikowalny jest wstrzykiwany per środowisko (.env.development ->
// sandbox, .env.production -> live). Środowisko wyprowadzamy z PREFIKSU
// tokena - nigdy nie zgadujemy "live" przy braku konfiguracji, bo to kończy
// się kryptycznym błędem serwera zamiast czytelnego komunikatu na stronie.
import { loadStripe, type Stripe } from "@stripe/stripe-js";

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

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(clientToken as string);
  }
  return stripePromise;
}
