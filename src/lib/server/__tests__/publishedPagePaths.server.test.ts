// Które strony CMS w ogóle MAJĄ publiczny adres - łańcuch przodków po stronie TS.
//
// PO CO OSOBNY PLIK (2026-10 audyt GSC). `sitemapEntries.server.test.ts` dowodzi
// skutku (adresy `/test/test-*` znikają z `sitemaps/pages.xml`), ale wszystkie
// jego łańcuchy przychodzą z bazy w kolejności „rodzic przed dzieckiem" - więc
// `reachablePageIds` zawsze trafiał tam w zapamiętaną głębokość rodzica, a gałąź
// obcinająca zbyt głęboki marsz (`chain.length >= PAGE_PATH_MAX_DEPTH`) nie
// wykonała się ani razu. Kolejność wierszy wyznacza `order("id")`, czyli UUID -
// w produkcji dziecko równie często przychodzi PRZED rodzicem. Wynik nie może od
// tej kolejności zależeć i to jest główna teza tego pliku.
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PAGE_PATH_MAX_DEPTH,
  reachablePageIds,
  readPublishedPagePaths,
} from "../publishedPagePaths.server";

type Rodzice = ReadonlyArray<readonly [string, string | null]>;

/** Łańcuch `p-1` (korzeń) ... `p-<dlugosc>` - każdy poziom to dziecko poprzedniego. */
function lancuch(prefiks: string, dlugosc: number): Rodzice {
  return Array.from({ length: dlugosc }, (_, i): readonly [string, string | null] => [
    `${prefiks}-${i + 1}`,
    i === 0 ? null : `${prefiks}-${i}`,
  ]);
}

/** Cykl `<prefiks>-1 -> <prefiks>-2 -> ... -> <prefiks>-1` (baza go nie blokuje). */
function cykl(prefiks: string, dlugosc: number): Rodzice {
  return Array.from({ length: dlugosc }, (_, i): readonly [string, string | null] => [
    `${prefiks}-${i + 1}`,
    `${prefiks}-${((i + 1) % dlugosc) + 1}`,
  ]);
}

/**
 * Deterministyczne tasowanie (LCG + Fisher-Yates). Bez `Math.random`: wynik
 * testu, który zależałby od losowania, byłby niepowtarzalny w CI.
 */
function potasuj<T>(wejscie: readonly T[], ziarno: number): T[] {
  const out = [...wejscie];
  let stan = ziarno >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    stan = (Math.imul(stan, 1_664_525) + 1_013_904_223) >>> 0;
    const j = stan % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const posortowane = (zbior: ReadonlySet<string>): string[] => [...zbior].sort();

describe("reachablePageIds - adres tylko przez opublikowanych przodków", () => {
  /**
   * Każda klasa przypadku naraz: zdrowe drzewo, łańcuch 52 poziomów (o dwa za
   * głęboki dla `page_full_paths`), cykl dłuższy niż limit głębokości, cykl
   * dwuelementowy z dzieckiem, pętla własna i gałąź pod nieopublikowanym
   * rodzicem (stan stron `test-*` na produkcji).
   */
  const STAN: Rodzice = [
    ["zdrowa", null],
    ["zdrowe-dziecko", "zdrowa"],
    ["zdrowy-wnuk", "zdrowe-dziecko"],
    ...lancuch("glebia", 52),
    ...cykl("dlugi-cykl", PAGE_PATH_MAX_DEPTH + 10),
    ["cykl-a", "cykl-b"],
    ["cykl-b", "cykl-a"],
    ["pod-cyklem", "cykl-a"],
    ["petla", "petla"],
    ["test-agenda", "test-szkic"],
    ["test-wnuk", "test-agenda"],
  ];
  const OCZEKIWANE = [
    "zdrowa",
    "zdrowe-dziecko",
    "zdrowy-wnuk",
    ...Array.from({ length: PAGE_PATH_MAX_DEPTH }, (_, i) => `glebia-${i + 1}`),
  ].sort();

  it("rodzic przed dzieckiem: osiągalne są wyłącznie strony z całym łańcuchem", () => {
    expect(posortowane(reachablePageIds(new Map(STAN)))).toEqual(OCZEKIWANE);
  });

  it("dziecko przed rodzicem (najgłębsze pierwsze) daje TEN SAM wynik", () => {
    // Tu wykonuje się gałąź obcinająca: marsz od `glebia-52` dochodzi do limitu
    // 50 kroków, zanim zobaczy korzeń, i musi uznać za nieosiągalny WYŁĄCZNIE
    // punkt startu - węzły pośrednie policzą się we własnych marszach.
    expect(posortowane(reachablePageIds(new Map([...STAN].reverse())))).toEqual(OCZEKIWANE);
  });

  it.each([1, 7, 42, 2026, 31_337])(
    "dowolna kolejność wierszy (ziarno %i) daje TEN SAM wynik",
    (ziarno) => {
      expect(posortowane(reachablePageIds(new Map(potasuj(STAN, ziarno))))).toEqual(OCZEKIWANE);
    },
  );

  it("granica głębokości to dokładnie limit `page_full_paths` (c.depth < 50)", () => {
    // 50 segmentów RPC składa w całości; 51. poziom dostałby ścieżkę uciętą od
    // góry - adres, pod którym `resolve_path` niczego nie znajdzie.
    for (const kolejnosc of [lancuch("g", 51), [...lancuch("g", 51)].reverse()]) {
      const osiagalne = reachablePageIds(new Map(kolejnosc));
      expect(osiagalne.has(`g-${PAGE_PATH_MAX_DEPTH}`)).toBe(true);
      expect(osiagalne.has(`g-${PAGE_PATH_MAX_DEPTH + 1}`)).toBe(false);
      expect(osiagalne.size).toBe(PAGE_PATH_MAX_DEPTH);
    }
  });

  it("pusta mapa to pusty zbiór", () => {
    expect(reachablePageIds(new Map()).size).toBe(0);
  });
});

/** Wiersz `pages` w kształcie odczytu `readPublishedPagePaths`. */
interface WierszStrony {
  id: string;
  slug: string;
  parent_id: string | null;
  seo_noindex: boolean;
  updated_at: string | null;
}

/** Licznik atrap - każda dostaje własny klucz magazynu sesji (patrz niżej). */
let licznikAtrap = 0;

/**
 * Prawdziwy klient Supabase z podstawionym `fetch` (ta sama zasada co
 * w `sitemapEntries.server.test.ts`: zero rzutowań typu klienta). RPC oddaje
 * ścieżkę złożoną po `parent_id` BEZ względu na status przodków - jak prawdziwa
 * `page_full_paths`, której ta luka dotyczyła.
 */
function atrapa(strony: readonly WierszStrony[], sciezki: Record<string, string>) {
  const wywolaniaRpc: string[][] = [];
  licznikAtrap += 1;
  const admin = createClient<Database>("https://stub.invalid", "klucz-testowy", {
    // Własny klucz magazynu sesji na atrapę - przy wspólnym kluczu klient
    // ostrzega o wielu instancjach GoTrueClient.
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `atrapa-sciezek-${licznikAtrap}`,
    },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const json = (body: unknown, total?: number) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: {
              "content-type": "application/json",
              ...(total === undefined ? {} : { "content-range": `*/${total}` }),
            },
          });
        if (url.pathname === "/rest/v1/pages") return json(strony, strony.length);
        if (url.pathname === "/rest/v1/rpc/page_full_paths") {
          const body: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
          const ids =
            typeof body === "object" && body !== null && "_page_ids" in body
              ? body._page_ids
              : null;
          const lista = Array.isArray(ids)
            ? ids.filter((id): id is string => typeof id === "string")
            : [];
          wywolaniaRpc.push(lista);
          return json(lista.map((id) => ({ page_id: id, full_path: sciezki[id] ?? null })));
        }
        return new Response("{}", { status: 404 });
      },
    },
  });
  return { admin, wywolaniaRpc };
}

describe("readPublishedPagePaths - ścieżki kontra lista stron", () => {
  const STRONY: WierszStrony[] = [
    // Dziecko PRZED rodzicem - kolejność `order("id")` po UUID.
    { id: "p-zespol", slug: "zespol", parent_id: "p-main", seo_noindex: false, updated_at: null },
    { id: "p-main", slug: "main", parent_id: null, seo_noindex: false, updated_at: null },
    {
      id: "p-agenda",
      slug: "test-agenda",
      parent_id: "p-test-szkic",
      seo_noindex: true,
      updated_at: "2026-09-01T00:00:00Z",
    },
  ];
  const SCIEZKI = { "p-zespol": "main/zespol", "p-main": "main", "p-agenda": "test/test-agenda" };

  it("ścieżkę dostaje tylko strona osiągalna, a RPC nie widzi nieosiągalnej", async () => {
    const { admin, wywolaniaRpc } = atrapa(STRONY, SCIEZKI);
    const { paths } = await readPublishedPagePaths(admin, "t-nes");
    expect(Object.fromEntries(paths)).toEqual({ "p-zespol": "main/zespol", "p-main": "main" });
    expect(wywolaniaRpc).toEqual([["p-zespol", "p-main"]]);
  });

  it("`pages` niesie WSZYSTKIE opublikowane strony - wejście rozstrzygnięcia strony głównej", async () => {
    // Zapytanie `/` wybiera stronę po id spośród opublikowanych, bez łańcucha
    // przodków - lista nie może więc być przycięta do osiągalnych.
    const { admin } = atrapa(STRONY, SCIEZKI);
    const { pages } = await readPublishedPagePaths(admin, "t-nes");
    expect(pages).toEqual([
      { id: "p-zespol", slug: "zespol", parent_id: "p-main" },
      { id: "p-main", slug: "main", parent_id: null },
      { id: "p-agenda", slug: "test-agenda", parent_id: "p-test-szkic" },
    ]);
  });
});
