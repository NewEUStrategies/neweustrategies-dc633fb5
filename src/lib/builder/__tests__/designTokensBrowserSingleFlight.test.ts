// Odczyt wiersza `site_design_tokens` w PRZEGLĄDARCE: dwa równoległe zapytania
// (tokeny marki + kolory globalne startują razem przy hydratacji) muszą zbiec
// do JEDNEGO żądania, a po jego zakończeniu kolejne zapytanie idzie do bazy
// od nowa - świeżością rządzi react-query per klucz, nie moduł.
//
// Sąsiedni `designTokensHostScope.test.ts` dowodzi tego samego po stronie SSR
// (pojedynczy lot w obrębie hosta najemcy). Tu środowisko ma `window`, więc
// `edgeTtlCache` woła loader wprost i jedyną deduplikacją jest ta z modułu.
//
// Granica: klient Supabase podmieniony na sterowaną obietnicę - test kontroluje,
// kiedy odpowiedź „dojeżdża", i liczy wywołania z nazwą tabeli i kolumnami.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSiteDesignTokensRow } from "../designTokens";

const db = vi.hoisted(() => ({
  calls: [] as { table: string; columns: string }[],
  resolvers: [] as ((value: { data: unknown; error: unknown }) => void)[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        maybeSingle: () => {
          db.calls.push({ table, columns });
          return new Promise((resolve) => db.resolvers.push(resolve));
        },
      }),
    }),
  },
}));

beforeEach(() => {
  db.calls.length = 0;
  db.resolvers.length = 0;
});

const ROW = { colors: [], fonts: { body: "Inter" }, scale: {}, global_colors: {}, font_scale: {} };

describe("fetchSiteDesignTokensRow w przeglądarce - jeden lot", () => {
  it("równoległe odczyty dzielą jedno zapytanie i ten sam wynik", async () => {
    const first = fetchSiteDesignTokensRow();
    const second = fetchSiteDesignTokensRow();
    expect(db.calls).toEqual([
      { table: "site_design_tokens", columns: "colors, fonts, scale, global_colors, font_scale" },
    ]);
    db.resolvers[0]({ data: ROW, error: null });
    await expect(first).resolves.toEqual(ROW);
    await expect(second).resolves.toEqual(ROW);
  });

  it("po zakończeniu lotu następny odczyt pyta bazę od nowa", async () => {
    const first = fetchSiteDesignTokensRow();
    db.resolvers[0]({ data: ROW, error: null });
    await first;
    const next = fetchSiteDesignTokensRow();
    expect(db.calls).toHaveLength(2);
    db.resolvers[1]({ data: null, error: null });
    await expect(next).resolves.toBeNull();
  });

  it("błąd bazy daje obu czekającym null i nie blokuje kolejnego odczytu", async () => {
    const first = fetchSiteDesignTokensRow();
    const second = fetchSiteDesignTokensRow();
    db.resolvers[0]({ data: null, error: new Error("timeout") });
    await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
    const retry = fetchSiteDesignTokensRow();
    db.resolvers[1]({ data: ROW, error: null });
    await expect(retry).resolves.toEqual(ROW);
  });
});
