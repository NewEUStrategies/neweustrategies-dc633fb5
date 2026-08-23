// Zakres dat filtra realizacji - dwa ogniwa zapytania i jedna cicha strata dnia.
//
// CO TEN PLIK DOWODZI.
//   1. Brak daty oznacza BRAK OGNIWA, a nie granicę domyślną. To rozróżnienie
//      decyduje o tym, czy wyczyszczenie pola „do" pokazuje wszystko, czy nic -
//      a w kodzie jest to zwykły `if`, którego nie widać w recenzji.
//   2. DEFEKT: granica „do" jest brana z kalendarza DOSŁOWNIE, czyli o lokalnej
//      północy, więc `lte` wycina cały wybrany dzień. Operator wybiera „do:
//      22 sierpnia" i nie widzi żadnej realizacji z 22 sierpnia.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Zachowania samego `DatePickerField` (to jest
// osobna molekuła) ani składania zapytania PostgREST (to dowodzi test trasy).
import { describe, expect, it } from "vitest";
import { redemptionsRange } from "@/lib/billing/couponRedemptionsRange";

describe("granice filtra realizacji", () => {
  it("obie daty ustawione dają oba ogniwa w ISO", () => {
    const range = redemptionsRange(
      new Date("2026-08-01T00:00:00.000Z"),
      new Date("2026-08-22T18:30:00.000Z"),
    );
    expect(range).toEqual({
      gte: "2026-08-01T00:00:00.000Z",
      lte: "2026-08-22T18:30:00.000Z",
    });
  });

  it("wyczyszczone pole 'do' USUWA ogniwo lte - raport nie dostaje granicy górnej", () => {
    const range = redemptionsRange(new Date("2026-08-01T00:00:00.000Z"), undefined);
    expect(range.gte).toBe("2026-08-01T00:00:00.000Z");
    expect("lte" in range).toBe(false);
  });

  it("wyczyszczone pole 'od' USUWA ogniwo gte - raport sięga do początku danych", () => {
    const range = redemptionsRange(undefined, new Date("2026-08-22T18:30:00.000Z"));
    expect("gte" in range).toBe(false);
    expect(range.lte).toBe("2026-08-22T18:30:00.000Z");
  });

  it("brak obu dat nie tworzy ani jednego ogniwa filtrującego", () => {
    expect(redemptionsRange(undefined, undefined)).toEqual({});
  });
});

describe("DEFEKT: wybór dnia w kalendarzu gubi cały ten dzień", () => {
  /** Dzień wybrany w kalendarzu bez trybu godziny = LOKALNA północ. */
  const wybranyDzien = new Date(2026, 7, 22, 0, 0, 0, 0);
  /** Realizacja z tego samego dnia, rano czasu lokalnego. */
  const realizacjaTegoDnia = new Date(2026, 7, 22, 9, 0, 0, 0);

  // Para `it.fails` + `it()`: pierwszy opisuje zachowanie OCZEKIWANE, drugi
  // stan faktyczny. Po naprawie (domknięcie granicy do końca wybranego dnia)
  // usuwa się OBA RAZEM.
  it.fails("granica 'do' POWINNA obejmować realizacje z wybranego dnia", () => {
    const range = redemptionsRange(undefined, wybranyDzien);
    expect(range.lte).toBeDefined();
    expect(realizacjaTegoDnia.toISOString() <= (range.lte ?? "")).toBe(true);
  });

  it("STAN FAKTYCZNY: lte to lokalna północ, więc realizacja z 9:00 wypada z raportu", () => {
    const range = redemptionsRange(undefined, wybranyDzien);
    expect(range.lte).toBe(wybranyDzien.toISOString());
    expect(realizacjaTegoDnia.toISOString() > (range.lte ?? "")).toBe(true);
  });
});
