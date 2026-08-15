// Rozgrzewka checkoutu na INTENCJĘ zakupu (pointerenter/focus przycisku na
// paywallu, bilecie, darowiźnie). Suita leniwej granicy dowodzi, że kasa nie
// wjeżdża czytelnikowi bez sesji - ta dowodzi drugiej połowy kontraktu:
// kupujący dostaje chunk ramki i SDK operatora ZANIM kliknie, dokładnie raz,
// a chwilowa awaria sieci przy samym najechaniu nie zamyka ścieżki na stałe
// (warmed cofa się po odrzuconym imporcie) i nigdy nie rzuca w stronę strony.
//
// `warmed` to stan modułu, a wynik fabryki `vi.mock` jest cache'owany na cały
// plik - dlatego ramkę rejestruje `vi.doMock` per test (świeża ewaluacja,
// w tym ścieżka rzucająca), a `vi.resetModules()` daje każdemu testowi świeży
// egzemplarz modułu rozgrzewki.
import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ frameImports: 0, preloadSdk: vi.fn() }));

vi.mock("@/lib/stripe", () => ({ preloadStripeSdk: () => h.preloadSdk() }));

/** Rejestruje moduł ramki na nowo: licznik ewaluacji + sterowana awaria pobrania. */
function mockFrame(fail: boolean): void {
  vi.doMock("@/components/checkout/StripeEmbeddedFrame", () => {
    h.frameImports += 1;
    if (fail) throw new Error("chunk fetch failed");
    return { StripeEmbeddedFrame: () => null };
  });
}

type CheckoutIntentModule = typeof import("@/components/checkout/checkoutIntent");

/** Świeży moduł pod test (zresetowany stan `warmed`). */
async function freshIntent(): Promise<CheckoutIntentModule> {
  return import("@/components/checkout/checkoutIntent");
}

/** Domknięcie mikro- i makrotasków odrzuconego/rozwiązanego importu chunku. */
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  h.frameImports = 0;
  h.preloadSdk.mockClear();
});

describe("preloadEmbeddedCheckout", () => {
  it("jest idempotentna: wiele intencji to jedno pobranie chunku i jedna rozgrzewka SDK", async () => {
    mockFrame(false);
    const intent = await freshIntent();
    intent.preloadEmbeddedCheckout();
    intent.preloadEmbeddedCheckout();
    intent.preloadEmbeddedCheckout();
    await settled();
    expect(h.preloadSdk).toHaveBeenCalledTimes(1);
    expect(h.frameImports).toBe(1);
  });

  it("odrzucony import chunku otwiera ponowną próbę, a sukces domyka rozgrzewkę", async () => {
    // Sieć padła przy samym najechaniu kursorem - gdyby `warmed` został
    // ustawiony na stałe, kupujący do końca sesji klikałby w zimny przycisk.
    mockFrame(true);
    const intent = await freshIntent();
    intent.preloadEmbeddedCheckout();
    await settled();
    intent.preloadEmbeddedCheckout();
    await settled();
    expect(h.preloadSdk).toHaveBeenCalledTimes(2);

    // Sieć wróciła: kolejna intencja pobiera chunk i od tej pory jest cicho.
    mockFrame(false);
    intent.preloadEmbeddedCheckout();
    await settled();
    expect(h.preloadSdk).toHaveBeenCalledTimes(3);
    intent.preloadEmbeddedCheckout();
    await settled();
    expect(h.preloadSdk).toHaveBeenCalledTimes(3);
  });

  it("jest całkowicie best-effort: awaria pobrania nie rzuca w stronę strony", async () => {
    mockFrame(true);
    const intent = await freshIntent();
    expect(() => intent.preloadEmbeddedCheckout()).not.toThrow();
    // Odrzucenie jest połknięte wewnętrznie - nieobsłużona promesa obaliłaby test.
    await settled();
  });
});

describe("checkoutIntentHandlers", () => {
  it("hover i fokus grzeją tą samą funkcją (parytet myszy i klawiatury)", async () => {
    mockFrame(false);
    const intent = await freshIntent();
    expect(intent.checkoutIntentHandlers.onPointerEnter).toBe(intent.preloadEmbeddedCheckout);
    expect(intent.checkoutIntentHandlers.onFocus).toBe(intent.preloadEmbeddedCheckout);
  });
});

describe("loadStripeFrame", () => {
  it("to jedyna referencja importu ramki - wspólna dla React.lazy i rozgrzewki", async () => {
    mockFrame(false);
    const intent = await freshIntent();
    await expect(intent.loadStripeFrame()).resolves.toHaveProperty("StripeEmbeddedFrame");
    expect(h.frameImports).toBe(1);
  });
});
