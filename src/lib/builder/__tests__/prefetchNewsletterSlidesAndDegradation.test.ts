// REJESTR PREFETCHU SSR: newsletter, identyfikatory slajdow i sygnal degradacji.
//
// Trzy wejscia `lib/builder/prefetch.ts`, ktorych nie dotykal zaden test:
//
// 1. NEWSLETTER. Tylko warianty z PRAWDZIWYM formularzem (`inline`, `card`
//    i legacy bez wariantu) czytaja ustawienia inline - bez rozgrzania kolumna
//    zapisu wychodzi z SSR pusta. Warianty-wyzwalacze (popup, przycisk) nie
//    renderuja pol, wiec ich rozgrzanie byloby zapytaniem o nic.
// 2. SLAJDY RECZNE Z ID Z BIALYMI ZNAKAMI. Rejestr i hook `useResolvedPostRefs`
//    musza znormalizowac id TA SAMA funkcja (`uniquePostRefIds`): inaczej
//    serwer grzeje klucz `" p1 "`, a klient czyta `"p1"` - SSR zostaje pusty
//    i slajd dociaga sie drugi raz po hydratacji.
// 3. SYGNAL `degraded`. Widget, ktorego budowniczy opcji RZUCA, jest pomijany
//    przez rozgrzewke - wiec nie moze tez zapalic degradacji (nic z niego nie
//    mialo dojechac), a reszta strony ma sie rozgrzac normalnie.
// Plus kontrakt rejestru celow cache: `widgetCacheTargets` jest wyprowadzany
// z `widgetQueryOptionsList`, wiec klucze i czasy swiezosci zgadzaja sie
// pozycja w pozycje dla kazdego typu widgetu z danymi.
//
// GRANICA: `queryClient.prefetchQuery` jest podmieniany (zadnej sieci);
// sprawdzamy KTORE klucze rejestr zamawia i jak rozstrzyga sygnal.
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import type { BuilderDocument, SectionNode, WidgetContent, WidgetNode } from "@/lib/builder/types";
import {
  prefetchAboveFoldQueries,
  widgetCacheTargets,
  widgetQueryOptionsList,
} from "@/lib/builder/prefetch";
import { newsletterInlineSettingsQueryOptions } from "@/hooks/useNewsletterSettings";
import { postRefQueryOptions } from "@/lib/builder/contentRefs";
import { sliderFallbackImagesQueryOptions } from "@/lib/builder/sliderFallbackQuery";
import { categoriesQueryOptions } from "@/lib/builder/taxonomyQuery";

function widget(
  type: WidgetNode["type"],
  content: WidgetContent = {},
  id = `w-${type}`,
): WidgetNode {
  return { kind: "widget", id, type, content, style: {}, advanced: {} } as WidgetNode;
}

function docOf(widgets: WidgetNode[]): BuilderDocument {
  const section = {
    id: "s1",
    kind: "section",
    children: [{ kind: "column", id: "s1-c", span: { desktop: 12 }, children: widgets }],
  } as unknown as SectionNode;
  return { version: 1, sections: [section] } as BuilderDocument;
}

const keysOf = (w: WidgetNode) => widgetQueryOptionsList(w, "pl").map((o) => o.queryKey);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("newsletter: rozgrzewa ustawienia tylko wariant z formularzem", () => {
  const ustawienia = newsletterInlineSettingsQueryOptions().queryKey;

  it.each([
    ["bez wariantu (legacy)", {}],
    ["inline", { variant: "inline" }],
    ["card", { variant: "card" }],
  ])("%s grzeje projekcje inline - w obu rejestrach", (_opis, content) => {
    const w = widget("newsletter", content as WidgetContent);

    expect(keysOf(w)).toEqual([ustawienia]);
    expect(widgetCacheTargets(w, "pl").map((t) => t.key)).toEqual([ustawienia]);
  });

  it.each([["popup"], ["button"], ["nieznany-wariant"]])(
    "wariant-wyzwalacz %s nie zamawia zadnego zapytania",
    (variant) => {
      const w = widget("newsletter", { variant });

      expect(keysOf(w)).toEqual([]);
      expect(widgetCacheTargets(w, "pl")).toEqual([]);
    },
  );
});

describe("slider reczny: id wpisow normalizowane jak w hooku klienta", () => {
  it("id z bialymi znakami grzeje klucz PRZYCIETY, a duplikat po przycieciu znika", () => {
    const slider = widget("slider", {
      items: [{ postId: " p-1 " }, { postId: "p-1" }, { postId: "   " }, { postId: 7 }],
    } as unknown as WidgetContent);

    expect(keysOf(slider)).toEqual([
      // Ten sam klucz, ktory odczyta `useResolvedPostRefs([" p-1 ", ...])`.
      postRefQueryOptions("p-1", "pl").queryKey,
      sliderFallbackImagesQueryOptions(4).queryKey,
    ]);
  });
});

describe("rejestr celow cache jest lustrem rejestru zapytan", () => {
  // Po jednym skonfigurowanym widgecie z KAZDEJ galezi rejestru.
  const widgety: WidgetNode[] = [
    widget("menu", { menu_key: "stopka" }),
    widget("post-list", { limit: 3 }),
    widget("carousel", {}),
    widget("news-ticker", {}),
    widget("trending-now", {}),
    widget("categories"),
    widget("tags"),
    widget("event-list", { scope: "past" }),
    widget("club-card", { clubSlug: "klub" }),
    widget("club-threads", { sort: "new" }),
    widget("club-hub", { clubSlug: "klub" }),
    widget("podcast-latest", {}),
    widget("web-stories-carousel", {}),
    widget("join-us", {}),
    widget("pricing", { source: "plans" }),
    widget("rated-list", { source: "dynamic" }),
    widget("event-countdown", { mode: "event", eventId: "ev-1" }),
    widget("speakers", { source: "event", eventId: "ev-1" }),
    widget("slider", { source: "posts" }),
    widget("slider", { items: [{ postId: "p-1" }] }, "w-slider-reczny"),
  ];

  it("dla kazdej galezi klucze i czasy swiezosci zgadzaja sie pozycja w pozycje", () => {
    for (const w of widgety) {
      const opcje = widgetQueryOptionsList(w, "pl");
      const cele = widgetCacheTargets(w, "pl");

      expect(
        cele.map((t) => t.key),
        w.id,
      ).toEqual(opcje.map((o) => o.queryKey));
      expect(
        cele.map((t) => t.staleTime),
        w.id,
      ).toEqual(opcje.map((o) => (typeof o.staleTime === "number" ? o.staleTime : 0)));
      // Pusta lista celow bramka SWR czyta jako "swieze" - kazdy widget z
      // danymi MUSI cos zglosic.
      expect(cele.length, w.id).toBeGreaterThan(0);
    }
  });
});

describe("sygnal degradacji rozgrzewki nad zgieciem", () => {
  /** Klient, ktorego prefetch zapisuje dane od reki - zdrowy upstream. */
  function zdrowyKlient(): { qc: QueryClient; zamowione: QueryKey[] } {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const zamowione: QueryKey[] = [];
    vi.spyOn(qc, "prefetchQuery").mockImplementation(async (options) => {
      const key = (options as { queryKey: QueryKey }).queryKey;
      zamowione.push(key);
      qc.setQueryData(key, []);
    });
    return { qc, zamowione };
  }

  function uszkodzonyWidget(): WidgetNode {
    const w = { kind: "widget", id: "w-uszkodzony", type: "post-list" } as unknown as WidgetNode;
    Object.defineProperty(w, "content", {
      get() {
        throw new Error("uszkodzona tresc widgetu");
      },
    });
    return w;
  }

  it("widget z rzucajacym budowniczym NIE zapala degradacji, a reszta sie rozgrzewa", async () => {
    const { qc, zamowione } = zdrowyKlient();

    const wynik = await prefetchAboveFoldQueries(
      qc,
      docOf([uszkodzonyWidget(), widget("categories")]),
      "pl",
      { budgetMs: 0 },
    );

    expect(wynik).toEqual({ degraded: false });
    expect(zamowione).toEqual([categoriesQueryOptions().queryKey]);
  });

  it("zapytanie, ktore nie dojechalo, zapala degradacje (kontrast)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(qc, "prefetchQuery").mockResolvedValue(undefined);

    const wynik = await prefetchAboveFoldQueries(
      qc,
      docOf([uszkodzonyWidget(), widget("categories")]),
      "pl",
      { budgetMs: 0 },
    );

    expect(wynik).toEqual({ degraded: true });
  });
});
