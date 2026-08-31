// Budżet stref reklamowych w trybie czytania: `src/lib/ads/readingMode.ts`.
//
// PO CO TEN PLIK ISTNIEJE. To jedyny globalny hamulec liczby reklam na stronie
// artykułu (P0 z OCENA_MODULOW_2026-07-20 §1.5). Każda strefa z osobna nadal
// uważa, że wolno jej się pokazać - dopiero `useReadingAdBudget()` mówi
// `$.tsx`, którym wolno naprawdę. Moduł miał ZERO pokrycia, a jego pomyłka jest
// jednostronnie kosztowna: budżet policzony o jeden za dużo znaczy, że PŁACĄCY
// członek dostaje reklamy, za których brak zapłacił. To nie jest usterka
// kosmetyczna, tylko niedotrzymanie warunków subskrypcji - i nie widać jej
// w żadnym logu, bo strona renderuje się poprawnie.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICĘ: klienta Supabase (ustawienia redakcyjne
// `site_settings["reading"]` oraz RPC warstwy członkostwa). `useSiteSetting`,
// `useCurrentTier` i cała arytmetyka budżetu biegną PRAWDZIWE - inaczej test
// mierzyłby własne atrapy zamiast reguły, której pilnuje.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";

const db = vi.hoisted(() => ({
  reading: undefined as unknown,
  tierRank: 0 as number | null,
  tierPendingForever: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: async () => {
        if (table !== "site_settings") return { data: [], error: null };
        return {
          data: db.reading === undefined ? [] : [{ key: "reading", value: db.reading }],
          error: null,
        };
      },
    }),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: async () => {
      // Warstwa, która nigdy nie odpowiada = stan `isPending` utrzymany przez
      // cały test (tak wygląda pierwsza sekunda życia strony u każdego czytelnika).
      if (db.tierPendingForever) return new Promise(() => {});
      if (db.tierRank === null) return { data: [], error: null };
      return {
        data: [
          {
            key: db.tierRank > 0 ? "premium" : "free",
            rank: db.tierRank,
            name_pl: "Warstwa testowa",
            name_en: "Test tier",
            features: {},
          },
        ],
        error: null,
      };
    },
  },
}));

import { clearEdgeTtlCache } from "@/lib/ssrCache";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { useCurrentTier } from "@/lib/billing/tiers";
import { POST_AD_PRIORITY, READING_AD_DEFAULTS, useReadingAdBudget } from "@/lib/ads/readingMode";
import { renderHookWithQueryClient } from "@/test/renderWithQueryClient";
import type { AdPosition } from "@/lib/ads/types";

/** Wszystkie strefy artykułu w kolejności ważności zapisanej w module. */
const ARTICLE_ZONES: AdPosition[] = [
  "top_of_post",
  "mid_post",
  "sidebar",
  "bottom_of_post",
  "footer_slideup",
];

/**
 * Renderuje hak RAZEM z oboma zapytaniami, od których zależy - inaczej test
 * nie ma jak odróżnić „budżet policzony" od „dane jeszcze w locie" i mierzyłby
 * wyłącznie stan przejściowy.
 */
async function budget(): Promise<(position: AdPosition) => boolean> {
  const { result } = renderHookWithQueryClient(() => ({
    allow: useReadingAdBudget(),
    tier: useCurrentTier(),
    settings: useQuery(siteSettingsQueryOptions),
  }));
  await waitFor(() => expect(result.current.settings.isPending).toBe(false));
  if (!db.tierPendingForever) {
    await waitFor(() => expect(result.current.tier.isPending).toBe(false));
  }
  return result.current.allow;
}

/** Zbiór stref, które budżet przepuszcza - czytelniejszy w asercji niż 5 wywołań. */
function allowed(fn: (position: AdPosition) => boolean): AdPosition[] {
  return ARTICLE_ZONES.filter(fn);
}

beforeEach(() => {
  clearEdgeTtlCache();
  db.reading = undefined;
  db.tierRank = 0;
  db.tierPendingForever = false;
});

// ---------------------------------------------------------------------------
describe("wartości domyślne modułu", () => {
  it("odwzorowują wymaganie P0: dwie strefy dla wolnych, jedna dla płacących", () => {
    // Liczby są kontraktem produktowym z OCENA_MODULOW_2026-07-20 §1.5, a nie
    // dowolną stałą - zmiana ma być świadoma i widoczna w diffie testu.
    expect(READING_AD_DEFAULTS).toEqual({
      reading_mode_ads: true,
      max_ad_zones_free: 2,
      max_ad_zones_paid: 1,
    });
  });

  it("moduł jest DOMYŚLNIE włączony - budżet nie czeka na wpis w panelu", () => {
    expect(READING_AD_DEFAULTS.reading_mode_ads).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("kolejność ważności stref", () => {
  it("priorytety są UNIKALNE i ciągłe od zera - inaczej budżet N nie ma sensu", () => {
    const values = ARTICLE_ZONES.map((zone) => POST_AD_PRIORITY[zone]);
    expect(values).toEqual([0, 1, 2, 3, 4]);
  });

  it("pasek dolny jest NAJMNIEJ ważny - najbardziej inwazyjny w czytaniu", () => {
    const max = Math.max(...ARTICLE_ZONES.map((zone) => POST_AD_PRIORITY[zone] ?? -1));
    expect(POST_AD_PRIORITY.footer_slideup).toBe(max);
  });

  it("strefy spoza artykułu nie mają priorytetu - budżet ich nie dotyczy", () => {
    expect(POST_AD_PRIORITY.header_banner).toBeUndefined();
    expect(POST_AD_PRIORITY.in_feed).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("budżet domyślny (brak wiersza `reading` w site_settings)", () => {
  it("czytelnik BEZ płatnego planu dostaje dokładnie dwie najważniejsze strefy", async () => {
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post"]);
  });

  it("czytelnik PŁACĄCY dostaje wyłącznie strefę na górze artykułu", async () => {
    db.tierRank = 3;

    expect(allowed(await budget())).toEqual(["top_of_post"]);
  });

  it("gość bez warstwy w bazie liczy się jak czytelnik bez planu", async () => {
    db.tierRank = null;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post"]);
  });

  it("ZANIM warstwa się rozstrzygnie obowiązuje budżet PŁACĄCEGO", async () => {
    // Świadoma asymetria z komentarza modułu: lepiej pokazać płacącemu
    // o reklamę za mało przez ułamek sekundy niż mignąć mu pełnym torem
    // przeszkód, którego nie da się „odzobaczyć".
    db.tierPendingForever = true;

    expect(allowed(await budget())).toEqual(["top_of_post"]);
  });

  it("pozycje spoza artykułu przechodzą zawsze, niezależnie od budżetu", async () => {
    db.tierRank = 9;
    const fn = await budget();

    expect(fn("header_banner")).toBe(true);
    expect(fn("in_feed")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("ustawienia redakcyjne site_settings['reading']", () => {
  it("wyłącznik reading_mode_ads=false przywraca stan sprzed budżetu", async () => {
    db.reading = { reading_mode_ads: false };
    db.tierRank = 5;

    // Wyłącznik ma być PEŁNY: nawet płacący widzi wszystkie strefy, bo moduł
    // ma się dać wyłączyć jednym przełącznikiem w razie awarii.
    expect(allowed(await budget())).toEqual(ARTICLE_ZONES);
  });

  it("max_ad_zones_paid=0 daje płacącemu ZERO reklam w artykule", async () => {
    db.reading = { max_ad_zones_paid: 0 };
    db.tierRank = 1;

    expect(allowed(await budget())).toEqual([]);
  });

  it("podniesiony budżet wolnego czytelnika wpuszcza kolejne strefy", async () => {
    db.reading = { max_ad_zones_free: 4 };
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual([
      "top_of_post",
      "mid_post",
      "sidebar",
      "bottom_of_post",
    ]);
  });

  it("częściowy wiersz ustawień NIE gubi pozostałych wartości domyślnych", async () => {
    // Panel zapisuje tylko zmienione pola; bez scalania z domyślnymi
    // `max_ad_zones_paid` byłoby `undefined` i płacący dostałby budżet zerowy
    // albo nieskończony - zależnie od tego, jak upadnie `clampBudget`.
    db.reading = { reading_mode_ads: true };
    db.tierRank = 4;

    expect(allowed(await budget())).toEqual(["top_of_post"]);
  });

  it("wartość ujemna jest przycinana do zera, a nie do budżetu domyślnego", async () => {
    db.reading = { max_ad_zones_free: -5 };
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual([]);
  });

  it("wartość absurdalnie duża jest przycinana do ośmiu stref", async () => {
    db.reading = { max_ad_zones_free: 9999 };
    db.tierRank = 0;

    // Sufit 8 > 5 istniejących stref, więc obserwowalnie: wszystkie przechodzą.
    expect(allowed(await budget())).toEqual(ARTICLE_ZONES);
  });

  it("ułamek jest zaokrąglany do najbliższej liczby stref", async () => {
    db.reading = { max_ad_zones_free: 2.6 };
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post", "sidebar"]);
  });

  it("wartość NIE-liczbowa spada na domyślną, a nie na zero ani na NaN", async () => {
    // jsonb nie wymusza typu: panel albo migracja mogą zapisać "3" jako tekst.
    // `priority < NaN` jest zawsze fałszem, więc bez tej gałęzi jedna literówka
    // w bazie wygasiłaby WSZYSTKIE reklamy w artykułach.
    db.reading = { max_ad_zones_free: "3" };
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post"]);
  });

  it("reading_mode_ads o złym typie spada na domyślne WŁĄCZONE", async () => {
    db.reading = { reading_mode_ads: "tak" };
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post"]);
  });

  it("wiersz `reading` niebędący obiektem nie wywraca haka", async () => {
    db.reading = 42;
    db.tierRank = 0;

    expect(allowed(await budget())).toEqual(["top_of_post", "mid_post"]);
  });
});
