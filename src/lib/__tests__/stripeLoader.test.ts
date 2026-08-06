// Kontrakt loadera Stripe po rozdzieleniu „helpery środowiskowe" (zerokosztowe,
// 17 importerów) od „SDK operatora" (dynamiczny import, patrz lib/stripe.ts).
//
// W środowisku testowym VITE_PAYMENTS_CLIENT_TOKEN nie istnieje - to jest
// dokładnie ten przypadek, w którym rozgrzewka na hover NIE MOŻE nic zepsuć,
// a jawne żądanie SDK musi dać czytelny błąd zamiast wiszącej obietnicy.
import { describe, expect, it } from "vitest";
import {
  getStripe,
  getStripeEnvironment,
  getStripeEnvironmentSafe,
  isPaymentsConfigured,
  preloadStripeSdk,
} from "@/lib/stripe";

describe("lib/stripe bez skonfigurowanych płatności", () => {
  it("nie zgaduje środowiska", () => {
    expect(isPaymentsConfigured()).toBe(false);
    expect(() => getStripeEnvironment()).toThrow("payments_not_configured");
  });

  it("wariant bezpieczny domyśla się sandboxa (klucze zapytań, filtry)", () => {
    expect(getStripeEnvironmentSafe()).toBe("sandbox");
  });

  it("getStripe rzuca SYNCHRONICZNIE, tak jak przed podziałem", () => {
    // Gdyby błąd wychodził jako odrzucona obietnica, wołający (paywall, bilety,
    // darowizny) łapaliby go poza swoim try/catch - czyli wcale.
    expect(() => getStripe()).toThrow("payments_not_configured");
  });

  it("rozgrzewka na intencję jest bezpieczna i cicha", () => {
    expect(() => preloadStripeSdk()).not.toThrow();
  });
});
