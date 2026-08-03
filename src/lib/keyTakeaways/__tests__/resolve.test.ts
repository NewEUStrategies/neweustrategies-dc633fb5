import { describe, expect, it } from "vitest";
import { resolveTakeaways } from "@/lib/keyTakeaways/resolve";

/**
 * Kontrakt, którego brak kosztował dwa audyty (07-30 i 08-01zapisały nieprawdę,
 * że dla STRON sekcja nigdy się nie renderuje). Kształt encji jest identyczny
 * dla wpisu i strony, więc test jawnie przechodzi oba.
 */
describe("resolveTakeaways", () => {
  const post = {
    takeaways_pl: ["Wpis PL 1", "Wpis PL 2"],
    takeaways_en: ["Post EN 1"],
  };
  const page = {
    takeaways_pl: ["Strona PL 1"],
    takeaways_en: ["Page EN 1", "Page EN 2"],
  };

  it("rozstrzyga punkty dla WPISU w obu językach", () => {
    expect(resolveTakeaways(post, "pl")).toEqual(["Wpis PL 1", "Wpis PL 2"]);
    expect(resolveTakeaways(post, "en")).toEqual(["Post EN 1"]);
  });

  it("rozstrzyga punkty dla STRONY w obu językach - ten sam kontrakt", () => {
    expect(resolveTakeaways(page, "pl")).toEqual(["Strona PL 1"]);
    expect(resolveTakeaways(page, "en")).toEqual(["Page EN 1", "Page EN 2"]);
  });

  it("NIE podstawia drugiego języka, gdy aktywny jest pusty", () => {
    // Świadoma decyzja: polskie bullety na /en byłyby gorsze niż brak sekcji.
    const onlyPl = { takeaways_pl: ["Tylko PL"], takeaways_en: [] };
    expect(resolveTakeaways(onlyPl, "en")).toEqual([]);
    expect(resolveTakeaways(onlyPl, "pl")).toEqual(["Tylko PL"]);
  });

  it("normalizuje: przycina, usuwa puste, obcina do limitu", () => {
    const messy = {
      takeaways_pl: ["  z białymi  ", "", "   ", "drugi"],
      takeaways_en: null,
    };
    expect(resolveTakeaways(messy, "pl")).toEqual(["z białymi", "drugi"]);
    expect(resolveTakeaways(messy, "en")).toEqual([]);
  });

  it("znosi brak encji i brak kolumn", () => {
    expect(resolveTakeaways(null, "pl")).toEqual([]);
    expect(resolveTakeaways(undefined, "en")).toEqual([]);
    expect(resolveTakeaways({}, "pl")).toEqual([]);
  });
});
