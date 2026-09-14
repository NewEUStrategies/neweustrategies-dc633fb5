import { describe, it, expect } from "vitest";
import {
  CTR_GAP_RATIO,
  MIN_IMPRESSIONS_FOR_VERDICT,
  ctrVerdict,
  expectedCtr,
  flattenQueries,
  groupByPage,
  missedClicks,
  missingQueryTerms,
  pathFromPageUrl,
  rankOpportunities,
  slugFromPath,
  summarizeRegistry,
  type GscPageQueryRow,
} from "@/lib/seo/queryRegistry";

const row = (
  page: string,
  query: string,
  over: Partial<Omit<GscPageQueryRow, "keys">> = {},
): GscPageQueryRow => ({
  keys: [page, query],
  clicks: over.clicks ?? 0,
  impressions: over.impressions ?? 0,
  ctr: over.ctr ?? 0,
  position: over.position ?? 10,
});

describe("expectedCtr - krzywa odniesienia", () => {
  it("poza tabelą nie ekstrapoluje, tylko trzyma skrajne wartości", () => {
    expect(expectedCtr(1)).toBeCloseTo(0.255, 5);
    expect(expectedCtr(0)).toBeCloseTo(0.255, 5);
    expect(expectedCtr(-4)).toBeCloseTo(0.255, 5);
    expect(expectedCtr(20)).toBeCloseTo(0.006, 5);
    expect(expectedCtr(90)).toBeCloseTo(0.006, 5);
  });

  it("między punktami interpoluje liniowo", () => {
    // Między 1 (0,255) a 2 (0,152) połowa drogi to średnia obu.
    expect(expectedCtr(1.5)).toBeCloseTo((0.255 + 0.152) / 2, 5);
    // Między 10 (0,017) a 15 (0,01) - jedna piąta drogi.
    expect(expectedCtr(11)).toBeCloseTo(0.017 + (0.01 - 0.017) / 5, 5);
  });

  it("trafia w punkty tabeli dokładnie", () => {
    expect(expectedCtr(3)).toBeCloseTo(0.102, 5);
    expect(expectedCtr(10)).toBeCloseTo(0.017, 5);
  });

  it("wartość nie-liczbowa daje zero, a nie NaN", () => {
    expect(expectedCtr(Number.NaN)).toBe(0);
    expect(expectedCtr(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("krzywa jest malejąca - dalsza pozycja nigdy nie klika się lepiej", () => {
    for (let position = 1; position < 20; position += 0.5) {
      expect(expectedCtr(position + 0.5)).toBeLessThanOrEqual(expectedCtr(position));
    }
  });
});

describe("ctrVerdict - kiedy wolno orzekać", () => {
  it("poniżej progu wyświetleń ODMAWIA orzeczenia zamiast zgadywać", () => {
    expect(ctrVerdict({ ctr: 0, position: 1, impressions: MIN_IMPRESSIONS_FOR_VERDICT - 1 })).toBe(
      "tooFew",
    );
  });

  it("dokładnie na progu już orzeka", () => {
    expect(ctrVerdict({ ctr: 0, position: 1, impressions: MIN_IMPRESSIONS_FOR_VERDICT })).toBe(
      "below",
    );
  });

  it("CTR tuż poniżej połowy odniesienia to sygnał, tuż powyżej - nie", () => {
    const reference = expectedCtr(5);
    expect(
      ctrVerdict({ ctr: reference * CTR_GAP_RATIO * 0.99, position: 5, impressions: 500 }),
    ).toBe("below");
    expect(
      ctrVerdict({ ctr: reference * CTR_GAP_RATIO * 1.01, position: 5, impressions: 500 }),
    ).toBe("ok");
  });

  it("CTR powyżej odniesienia jest w porządku", () => {
    expect(ctrVerdict({ ctr: 0.4, position: 3, impressions: 900 })).toBe("ok");
  });

  it("gdy odniesienie wynosi zero, nie oskarża strony", () => {
    // Pozycja nie-liczbowa daje odniesienie 0; brak odniesienia nie może
    // znaczyć „źle", bo nie ma z czym porównać.
    expect(ctrVerdict({ ctr: 0, position: Number.NaN, impressions: 5000 })).toBe("ok");
  });
});

describe("pathFromPageUrl", () => {
  it("zdejmuje origin", () => {
    expect(pathFromPageUrl("https://neweuropeanstrategies.com/blog/wpis")).toBe("/blog/wpis");
  });

  it("goły origin daje korzeń", () => {
    expect(pathFromPageUrl("https://neweuropeanstrategies.com")).toBe("/");
  });

  it("origin z samym ukośnikiem też daje korzeń, a nie pusty łańcuch", () => {
    expect(pathFromPageUrl("https://neweuropeanstrategies.com/")).toBe("/");
  });

  it("obcina zapytanie i kotwicę", () => {
    expect(pathFromPageUrl("https://x.pl/blog/wpis?utm_source=nl")).toBe("/blog/wpis");
    expect(pathFromPageUrl("https://x.pl/blog/wpis#sekcja")).toBe("/blog/wpis");
  });

  it("zdejmuje końcowy ukośnik, bo to ta sama strona", () => {
    expect(pathFromPageUrl("https://x.pl/blog/wpis/")).toBe("/blog/wpis");
  });

  it("ścieżka bez originu przechodzi i dostaje wiodący ukośnik", () => {
    expect(pathFromPageUrl("blog/wpis")).toBe("/blog/wpis");
    expect(pathFromPageUrl("/blog/wpis")).toBe("/blog/wpis");
  });

  it("pusty i niezdefiniowany adres dają pusty łańcuch", () => {
    expect(pathFromPageUrl("")).toBe("");
    expect(pathFromPageUrl("   ")).toBe("");
    expect(pathFromPageUrl(undefined as unknown as string)).toBe("");
  });
});

describe("slugFromPath", () => {
  it("bierze ostatni segment", () => {
    expect(slugFromPath("/blog/moj-wpis")).toBe("moj-wpis");
  });

  it("zdejmuje prefiks języka, więc obie wersje trafiają w ten sam slug", () => {
    expect(slugFromPath("/en/blog/moj-wpis")).toBe("moj-wpis");
    expect(slugFromPath("/pl/blog/moj-wpis")).toBe("moj-wpis");
  });

  it("sam prefiks języka to strona główna tej wersji, nie slug", () => {
    expect(slugFromPath("/en")).toBe("");
    expect(slugFromPath("/pl")).toBe("");
  });

  it("korzeń nie ma sluga", () => {
    expect(slugFromPath("/")).toBe("");
  });

  it("segment, który tylko zaczyna się jak prefiks, zostaje nietknięty", () => {
    expect(slugFromPath("/energia/raport")).toBe("raport");
    expect(slugFromPath("/plany")).toBe("plany");
  });
});

describe("groupByPage", () => {
  it("scala frazy jednej strony i liczy CTR z SUM, nie jako średnią CTR-ów", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "fraza droga", { clicks: 1, impressions: 3, ctr: 1 / 3, position: 4 }),
      row("https://x.pl/a", "fraza tania", {
        clicks: 1,
        impressions: 97,
        ctr: 1 / 97,
        position: 8,
      }),
    ]);
    expect(pages).toHaveLength(1);
    // Średnia CTR-ów dałaby ok. 17,2% - nieprawdę. Suma daje 2/100.
    expect(pages[0].ctr).toBeCloseTo(0.02, 6);
    expect(pages[0].clicks).toBe(2);
    expect(pages[0].impressions).toBe(100);
  });

  it("pozycję waży wyświetleniami, więc fraza bez odsłon jej nie przesuwa", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "częsta", { impressions: 999, position: 2 }),
      row("https://x.pl/a", "rzadka", { impressions: 1, position: 90 }),
    ]);
    expect(pages[0].position).toBeCloseTo((2 * 999 + 90) / 1000, 5);
    expect(pages[0].position).toBeLessThan(3);
  });

  it("obie wersje językowe to dwie ścieżki, ale ten sam slug", () => {
    const pages = groupByPage([
      row("https://x.pl/blog/wpis", "polska fraza", { impressions: 10 }),
      row("https://x.pl/en/blog/wpis", "english phrase", { impressions: 5 }),
    ]);
    expect(pages.map((p) => p.path)).toEqual(["/blog/wpis", "/en/blog/wpis"]);
    expect(new Set(pages.map((p) => p.slug))).toEqual(new Set(["wpis"]));
  });

  it("sortuje strony po wyświetleniach malejąco", () => {
    const pages = groupByPage([
      row("https://x.pl/male", "a", { impressions: 5 }),
      row("https://x.pl/duze", "b", { impressions: 500 }),
      row("https://x.pl/srednie", "c", { impressions: 50 }),
    ]);
    expect(pages.map((p) => p.path)).toEqual(["/duze", "/srednie", "/male"]);
  });

  it("frazy wewnątrz strony też idą po wyświetleniach", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "rzadka", { impressions: 2 }),
      row("https://x.pl/a", "częsta", { impressions: 200 }),
    ]);
    expect(pages[0].queries.map((q) => q.query)).toEqual(["częsta", "rzadka"]);
  });

  it("wiersz bez frazy albo bez adresu jest pomijany, a nie psuje grupy", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "prawdziwa", { impressions: 10 }),
      row("", "sierota", { impressions: 10 }),
      row("https://x.pl/a", "   ", { impressions: 10 }),
    ]);
    expect(pages).toHaveLength(1);
    expect(pages[0].queries).toHaveLength(1);
    expect(pages[0].impressions).toBe(10);
  });

  it("brakujące klucze nie wywracają grupowania", () => {
    const pages = groupByPage([{ keys: [], clicks: 0, impressions: 1, ctr: 0, position: 1 }]);
    expect(pages).toEqual([]);
  });

  it("pusta lista daje pustą listę", () => {
    expect(groupByPage([])).toEqual([]);
  });

  it("strona bez wyświetleń nie dzieli przez zero", () => {
    const pages = groupByPage([row("https://x.pl/a", "fraza", { impressions: 0, clicks: 0 })]);
    expect(pages[0].ctr).toBe(0);
    expect(pages[0].position).toBe(0);
  });
});

describe("missingQueryTerms", () => {
  it("wskazuje słowo zapytania, którego nie ma ani w tytule, ani w opisie", () => {
    expect(missingQueryTerms("raport o dronach", "Raport roczny", "Podsumowanie prac")).toEqual([
      "dronach",
    ]);
  });

  it("nie zgłasza słowa obecnego w opisie, choć nie ma go w tytule", () => {
    expect(missingQueryTerms("raport o dronach", "Raport roczny", "Rzecz o dronach")).toEqual([]);
  });

  it("odmiana nie jest brakiem - porównanie idzie po wspólnym rdzeniu", () => {
    expect(
      missingQueryTerms("bezpieczeństwa energetycznego", "Bezpieczeństwo energetyczne", ""),
    ).toEqual([]);
  });

  it("słowa krótsze niż próg są pomijane po obu stronach", () => {
    expect(missingQueryTerms("o na w", "Cokolwiek", "")).toEqual([]);
  });

  it("nie powtarza tego samego słowa dwa razy", () => {
    expect(missingQueryTerms("drony drony drony", "Raport", "")).toEqual(["drony"]);
  });

  it("wielkość liter nie ma znaczenia", () => {
    expect(missingQueryTerms("DRONY", "drony bojowe", "")).toEqual([]);
  });

  it("interpunkcja nie tworzy sztucznych braków", () => {
    expect(missingQueryTerms("drony, rakiety!", "Drony i rakiety", "")).toEqual([]);
  });

  it("puste wejścia nie rzucają", () => {
    expect(missingQueryTerms("", "", "")).toEqual([]);
    expect(
      missingQueryTerms(
        undefined as unknown as string,
        undefined as unknown as string,
        undefined as unknown as string,
      ),
    ).toEqual([]);
  });
});

describe("missedClicks i rankOpportunities", () => {
  it("bez luki nie ma straty", () => {
    expect(missedClicks({ ctr: 0.5, position: 3, impressions: 1000 })).toBe(0);
  });

  it("przy zbyt małej próbce strata to zero, nie domysł", () => {
    expect(missedClicks({ ctr: 0, position: 1, impressions: 5 })).toBe(0);
  });

  it("strata to luka CTR razy wyświetlenia", () => {
    const value = missedClicks({ ctr: 0.01, position: 3, impressions: 1000 });
    expect(value).toBeCloseTo((0.102 - 0.01) * 1000, 5);
  });

  it("lista zadań wyrzuca strony bez czego poprawiać", () => {
    const pages = groupByPage([
      row("https://x.pl/dobra", "a", { clicks: 60, impressions: 200, ctr: 0.3, position: 2 }),
      row("https://x.pl/slaba", "b", { clicks: 2, impressions: 1000, ctr: 0.002, position: 3 }),
    ]);
    const ranked = rankOpportunities(pages);
    expect(ranked.map((p) => p.path)).toEqual(["/slaba"]);
  });

  it("sortuje po odzyskiwalnych kliknięciach, nie po wyświetleniach", () => {
    const pages = groupByPage([
      // Więcej odsłon, ale daleka pozycja - odniesienie jest niskie, luka mała.
      row("https://x.pl/duza-daleka", "a", { clicks: 0, impressions: 4000, ctr: 0, position: 20 }),
      // Mniej odsłon, ale pozycja 2 - luka na jedno wyświetlenie ogromna.
      row("https://x.pl/mala-bliska", "b", { clicks: 0, impressions: 400, ctr: 0, position: 2 }),
    ]);
    const ranked = rankOpportunities(pages);
    expect(ranked[0].path).toBe("/mala-bliska");
    expect(ranked.map((p) => p.path)).toEqual(["/mala-bliska", "/duza-daleka"]);
  });

  it("przy równej stracie rozstrzygają wyświetlenia", () => {
    const pages = groupByPage([
      row("https://x.pl/mniej", "a", { clicks: 0, impressions: 100, ctr: 0, position: 3 }),
      row("https://x.pl/wiecej", "b", { clicks: 0, impressions: 100, ctr: 0, position: 3 }),
    ]);
    const ranked = rankOpportunities(pages);
    expect(ranked).toHaveLength(2);
    expect(missedClicks(ranked[0])).toBeCloseTo(missedClicks(ranked[1]), 9);
  });

  it("pusta lista daje pustą listę", () => {
    expect(rankOpportunities([])).toEqual([]);
  });
});

describe("summarizeRegistry", () => {
  it("sumuje strony, frazy i metryki", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "q1", { clicks: 5, impressions: 100, ctr: 0.05, position: 3 }),
      row("https://x.pl/a", "q2", { clicks: 5, impressions: 100, ctr: 0.05, position: 5 }),
      row("https://x.pl/b", "q3", { clicks: 0, impressions: 200, ctr: 0, position: 10 }),
    ]);
    const totals = summarizeRegistry(pages);
    expect(totals.pages).toBe(2);
    expect(totals.queries).toBe(3);
    expect(totals.clicks).toBe(10);
    expect(totals.impressions).toBe(400);
    expect(totals.ctr).toBeCloseTo(10 / 400, 6);
    expect(totals.position).toBeCloseTo((4 * 200 + 10 * 200) / 400, 5);
  });

  it("pusty rejestr nie dzieli przez zero", () => {
    const totals = summarizeRegistry([]);
    expect(totals).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      pages: 0,
      queries: 0,
    });
  });
});

describe("flattenQueries", () => {
  it("zwraca frazy ze ścieżką i sortuje po wyświetleniach przez wszystkie strony", () => {
    const pages = groupByPage([
      row("https://x.pl/a", "średnia", { impressions: 50 }),
      row("https://x.pl/b", "największa", { impressions: 500 }),
      row("https://x.pl/a", "najmniejsza", { impressions: 5 }),
    ]);
    const flat = flattenQueries(pages);
    expect(flat.map((q) => q.query)).toEqual(["największa", "średnia", "najmniejsza"]);
    expect(flat[0].path).toBe("/b");
    expect(flat[1].path).toBe("/a");
  });

  it("pusty rejestr daje pustą listę", () => {
    expect(flattenQueries([])).toEqual([]);
  });
});
