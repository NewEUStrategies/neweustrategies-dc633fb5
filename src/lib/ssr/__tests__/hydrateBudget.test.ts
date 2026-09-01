// BUDŻET HYDRATACJI jako kontrakt, nie jako literał.
//
// Do 2026-09-01 ta mechanika była lokalną stałą wewnątrz
// `router.options.hydrate`, a jedynym śladem przekroczenia był `console.warn`.
// Test mógł wyłącznie POWTÓRZYĆ liczbę 1500 - czyli nie pilnował niczego,
// bo zmiana w źródle nadal przechodziła - i musiał szpiegować globalną konsolę,
// dopasowując tekst. Trzy przypadki w `router.test.tsx` stały z tego powodu jako
// `it.fails`; dwa z nich retiruje ten plik.
import { describe, expect, it, vi } from "vitest";

import {
  HYDRATE_BUDGET_MS,
  warnHydrateBudget,
  withHydrateBudget,
  type HydrateBudgetBreach,
} from "../hydrateBudget";

describe("withHydrateBudget", () => {
  it("domyślny budżet to importowalna stała, a nie liczba wpisana w test", () => {
    expect(HYDRATE_BUDGET_MS).toBe(1500);
  });

  it("praca, która rozstrzyga się w budżecie, NIE raportuje przekroczenia", async () => {
    const breaches: HydrateBudgetBreach[] = [];
    await withHydrateBudget(Promise.resolve("ok"), { report: (b) => breaches.push(b) });
    expect(breaches).toEqual([]);
  });

  it("wisząca praca jest przerywana po budżecie i raportowana RAZ", async () => {
    vi.useFakeTimers();
    const breaches: HydrateBudgetBreach[] = [];
    let settled = false;
    void withHydrateBudget(new Promise<void>(() => {}), {
      budgetMs: 200,
      label: "test-hydrate",
      report: (b) => breaches.push(b),
    }).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);
    expect(breaches).toEqual([]);

    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toBe(true);
    expect(breaches).toEqual([{ budgetMs: 200, label: "test-hydrate" }]);

    // Po przekroczeniu timer jest zużyty - dalszy upływ czasu nie mnoży raportów.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(breaches).toHaveLength(1);
    vi.useRealTimers();
  });

  it("TIMER JEST CZYSZCZONY, nie tylko przegrywa wyścig", async () => {
    // Bez `clearTimeout` w `finally` timer przeżywa rozstrzygnięcie pracy:
    // w przeglądarce to wyciek, a na Workers ostrzeżenie runtime'u i zbędne
    // wybudzenie izolatu po domknięciu odpowiedzi.
    vi.useFakeTimers();
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const breaches: HydrateBudgetBreach[] = [];
    await withHydrateBudget(Promise.resolve(), { budgetMs: 50, report: (b) => breaches.push(b) });
    expect(clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(breaches).toEqual([]);
    clear.mockRestore();
    vi.useRealTimers();
  });

  it("`undefined` jako praca kończy się natychmiast, bez raportu", async () => {
    // Integracja może nie zainstalować własnego `hydrate` - wtedy `router.tsx`
    // przekazuje tu `undefined` i budżet nie ma czego pilnować.
    const breaches: HydrateBudgetBreach[] = [];
    await withHydrateBudget(undefined, { report: (b) => breaches.push(b) });
    expect(breaches).toEqual([]);
  });

  it("odrzucenie pracy PROPAGUJE - budżet nie jest łapaczem wyjątków", async () => {
    // Świadomy kontrakt: budżet ogranicza CZAS, a nie odpowiada za błędy.
    // Cichy `catch` tutaj ukrywałby awarię hydratacji, czyli dokładnie to,
    // czego szuka detektor martwej hydratacji.
    await expect(withHydrateBudget(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("DOMYŚLNY budżet obowiązuje, gdy wołający nie podał swojego", async () => {
    // Ta gałąź (`budgetMs = HYDRATE_BUDGET_MS`) jest nieosiągalna z wywołań,
    // które podają własny budżet - a wszystkie pozostałe przypadki w tym pliku
    // go podają. Ten przypadek USTALA domyślną wartość zachowaniem, nie odczytem
    // stałej.
    vi.useFakeTimers();
    const breaches: HydrateBudgetBreach[] = [];
    void withHydrateBudget(new Promise<void>(() => {}), { report: (b) => breaches.push(b) });
    await vi.advanceTimersByTimeAsync(HYDRATE_BUDGET_MS - 1);
    expect(breaches).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(breaches).toEqual([{ budgetMs: HYDRATE_BUDGET_MS, label: undefined }]);
    vi.useRealTimers();
  });

  it("domyślny reporter pisze DOKŁADNIE dotychczasowy komunikat", () => {
    // Znak w znak: zmiana tego napisu jest zmianą obserwowalnego zachowania
    // produkcji, więc ma zapalić test, a nie przejść po cichu.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnHydrateBudget({ budgetMs: HYDRATE_BUDGET_MS });
    expect(warn).toHaveBeenCalledWith(
      "[ssr-hydrate] hydration stream exceeded budget - continuing",
    );
    warn.mockRestore();
  });
});
