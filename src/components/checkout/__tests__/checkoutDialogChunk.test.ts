// Chunk modala kasy - `checkoutDialogChunk.ts`.
//
// RYZYKO. `prefetchEmbeddedCheckoutDialog` jest wołana z formularza darowizny
// na NAJECHANIE kursorem i przy wysłaniu - zanim jeszcze wróci `clientSecret`.
// Na słabym łączu import chunku potrafi się nie udać. Rozgrzewka jest
// best-effort, więc taka awaria:
//   * nie może wyjść jako nieobsłużone odrzucenie obietnicy (w przeglądarce
//     to raport błędu „Unhandled rejection" przy każdym ruchu myszy, a w
//     teście - czerwony przebieg),
//   * nie może rzucić synchronicznie do obsługi zdarzenia formularza.
// Druga połowa kontraktu: `loadCheckoutDialog` oddaje moduł w kształcie, jakiego
// oczekuje `React.lazy` (`{ default: Komponent }`) - inaczej modal kasy po
// pobraniu chunku wywraca się na „Element type is invalid".
//
// GRANICA ATRAP: sieć chunku - fabryka modułu modala rzuca tak, jak rzuca
// nieudany `import()` w przeglądarce. W trybie online moduł biegnie prawdziwy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ offline: false, attempts: 0 }));

vi.mock("@/components/checkout/EmbeddedCheckoutDialog", async (importOriginal) => {
  h.attempts += 1;
  if (h.offline) throw new TypeError("Failed to fetch dynamically imported module");
  return importOriginal();
});

import {
  loadCheckoutDialog,
  prefetchEmbeddedCheckoutDialog,
} from "@/components/checkout/checkoutDialogChunk";

/** Dwa obroty pętli zdarzeń - Node zgłasza nieobsłużone odrzucenie po opróżnieniu mikrozadań. */
async function drainEventLoop(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  // Świeży rejestr modułów: każdy przypadek naprawdę „pobiera" chunk od nowa.
  vi.resetModules();
  h.offline = false;
  h.attempts = 0;
  unhandled.length = 0;
  process.on("unhandledRejection", onUnhandled);
});

afterEach(() => {
  process.off("unhandledRejection", onUnhandled);
});

describe("prefetchEmbeddedCheckoutDialog", () => {
  it("bez sieci połyka nieudany import - bez rzutu i bez nieobsłużonego odrzucenia", async () => {
    h.offline = true;

    expect(prefetchEmbeddedCheckoutDialog()).toBeUndefined();
    await drainEventLoop();

    // Rozgrzewka NAPRAWDĘ próbowała pobrać chunk, a porażka nie wyszła na zewnątrz.
    expect(h.attempts).toBe(1);
    expect(unhandled).toEqual([]);
  });

  it("połknięcie dotyczy tylko rozgrzewki - realne otwarcie kasy widzi błąd importu", async () => {
    h.offline = true;
    prefetchEmbeddedCheckoutDialog();
    await drainEventLoop();

    // `React.lazy` modala musi dostać odrzucenie (granica błędu pokaże stan
    // awarii), a nie cichy sukces bez modułu.
    await expect(loadCheckoutDialog()).rejects.toBeInstanceOf(Error);
  });
});

describe("loadCheckoutDialog", () => {
  it("oddaje modal kasy w kształcie wymaganym przez React.lazy", async () => {
    const chunk = await loadCheckoutDialog();
    const real = await import("@/components/checkout/EmbeddedCheckoutDialog");

    expect(Object.keys(chunk)).toEqual(["default"]);
    expect(chunk.default).toBe(real.EmbeddedCheckoutDialog);
    expect(typeof chunk.default).toBe("function");
  });
});
