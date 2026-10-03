// LOADER OPERATORA PŁATNOŚCI W PRZEGLĄDARCE - przy SKONFIGUROWANYM tokenie.
//
// Siostrzany `stripeLoader.test.ts` pilnuje stanu „płatności wyłączone". Ten
// plik pilnuje drugiej połowy, w której chodzi o pieniądze:
//   * środowisko wynika WYŁĄCZNIE z prefiksu tokena publikowalnego - `pk_live_`
//     to live, `pk_test_` to sandbox. Pomyłka w drugą stronę ostemplowałaby
//     zamówienie kartą testową jako realne (albo odwrotnie);
//   * cokolwiek innego (np. wklejony klucz TAJNY `sk_live_`) to brak
//     konfiguracji: taki klucz NIE MOŻE trafić do `loadStripe`, czyli do
//     skryptu ładowanego z domeny operatora w przeglądarce czytelnika;
//   * SDK jest ładowane raz na stronę, a rozgrzewka na hover nigdy nie zostawia
//     nieobsłużonego odrzucenia (offline przy najechaniu kursorem).
//
// GRANICA ATRAP: tylko `@stripe/stripe-js` (skrypt z sieci operatora). Token
// wstrzykujemy przez `vi.stubEnv` i świeży import modułu, bo moduł czyta go
// raz, przy ładowaniu - dokładnie tak jak w zbudowanej aplikacji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  loadStripe: vi.fn<(token: string) => Promise<unknown>>(),
}));

vi.mock("@stripe/stripe-js", () => ({ loadStripe: h.loadStripe }));

const TEST_TOKEN = "pk_test_SyntetycznyTokenPublikowalny";
const LIVE_TOKEN = "pk_live_SyntetycznyTokenPublikowalny";
const STRIPE_JS = { elements: () => ({}) };

async function loaderWithToken(token: string) {
  vi.stubEnv("VITE_PAYMENTS_CLIENT_TOKEN", token);
  vi.resetModules();
  return import("@/lib/stripe");
}

beforeEach(() => {
  h.loadStripe.mockReset();
  h.loadStripe.mockResolvedValue(STRIPE_JS);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("lib/stripe ze skonfigurowanym tokenem", () => {
  it("token testowy: sandbox w obu wariantach i płatności włączone", async () => {
    const stripe = await loaderWithToken(TEST_TOKEN);

    expect(stripe.isPaymentsConfigured()).toBe(true);
    expect(stripe.getStripeEnvironment()).toBe("sandbox");
    expect(stripe.getStripeEnvironmentSafe()).toBe("sandbox");
  });

  it("token live: live w obu wariantach - bez zgadywania sandboxa", async () => {
    const stripe = await loaderWithToken(LIVE_TOKEN);

    expect(stripe.isPaymentsConfigured()).toBe(true);
    expect(stripe.getStripeEnvironment()).toBe("live");
    expect(stripe.getStripeEnvironmentSafe()).toBe("live");
  });

  it("klucz o obcym prefiksie (np. tajny) to brak konfiguracji i nie trafia do loadStripe", async () => {
    const stripe = await loaderWithToken("sk_live_SyntetycznyKluczTajny");

    expect(stripe.isPaymentsConfigured()).toBe(false);
    expect(() => stripe.getStripeEnvironment()).toThrow("payments_not_configured");
    // Wariant bezpieczny nie zgaduje live - filtry danych zostają w sandboxie.
    expect(stripe.getStripeEnvironmentSafe()).toBe("sandbox");
    expect(() => stripe.getStripe()).toThrow("payments_not_configured");
    stripe.preloadStripeSdk();

    expect(h.loadStripe).not.toHaveBeenCalled();
  });

  it("SDK ładuje się raz na stronę, dokładnie z tokenem publikowalnym", async () => {
    const stripe = await loaderWithToken(TEST_TOKEN);

    const first = stripe.getStripe();
    const second = stripe.getStripe();

    expect(second).toBe(first);
    await expect(first).resolves.toBe(STRIPE_JS);
    expect(h.loadStripe).toHaveBeenCalledTimes(1);
    expect(h.loadStripe).toHaveBeenCalledWith(TEST_TOKEN);
  });

  it("rozgrzewka na intencję ładuje SDK, a kliknięcie korzysta z tej samej instancji", async () => {
    const stripe = await loaderWithToken(LIVE_TOKEN);

    stripe.preloadStripeSdk();
    stripe.preloadStripeSdk();
    await expect(stripe.getStripe()).resolves.toBe(STRIPE_JS);

    expect(h.loadStripe).toHaveBeenCalledTimes(1);
    expect(h.loadStripe).toHaveBeenCalledWith(LIVE_TOKEN);
  });

  it("rozgrzewka offline połyka odrzucenie - strona nie dostaje nieobsłużonego błędu", async () => {
    const stripe = await loaderWithToken(TEST_TOKEN);
    const offline = new Error("Failed to load Stripe.js");
    h.loadStripe.mockRejectedValue(offline);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    try {
      expect(() => stripe.preloadStripeSdk()).not.toThrow();
      // Odrzucenie dociera do rozgrzewki przez łańcuch obietnic - dajemy mu
      // pełny obrót pętli zdarzeń, zanim sprawdzimy, czy ktoś go nie złapał.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(h.loadStripe).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("nieudane ładowanie (offline przy rozgrzewce) nie jest zapamiętywane - kliknięcie ładuje SDK ponownie", async () => {
    // Chwilowy brak sieci przy najechaniu kursorem nie może zablokować osadzonej
    // kasy do pełnego przeładowania strony: kupujący klika chwilę później, gdy
    // sieć już wróciła, i ramka MUSI dostać działające SDK.
    const stripe = await loaderWithToken(TEST_TOKEN);
    h.loadStripe.mockRejectedValueOnce(new Error("Failed to load Stripe.js"));

    stripe.preloadStripeSdk();
    // Kliknięcie w trakcie rozgrzewki dzieli jej próbę - i jej błąd. Czekamy na
    // to odrzucenie wprost (zamiast obrotu pętli zdarzeń), więc test nie zależy
    // od tego, jak szybko rozwiąże się dynamiczny import.
    await expect(stripe.getStripe()).rejects.toThrow("Failed to load Stripe.js");

    await expect(stripe.getStripe()).resolves.toBe(STRIPE_JS);
    expect(h.loadStripe).toHaveBeenCalledTimes(2);
  });

  it("udane ładowanie po ponowieniu jest znowu współdzielone przez kolejne wywołania", async () => {
    const stripe = await loaderWithToken(LIVE_TOKEN);
    h.loadStripe.mockRejectedValueOnce(new Error("Failed to load Stripe.js"));

    await expect(stripe.getStripe()).rejects.toThrow("Failed to load Stripe.js");
    const retried = stripe.getStripe();

    expect(stripe.getStripe()).toBe(retried);
    await expect(retried).resolves.toBe(STRIPE_JS);
    expect(h.loadStripe).toHaveBeenCalledTimes(2);
  });
});
