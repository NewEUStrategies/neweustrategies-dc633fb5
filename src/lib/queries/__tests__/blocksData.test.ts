// SILNIK BLOKÓW - CIAŁA `queryFn` I ROZGRZEWANIE CACHE'U POD SSR.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/queries/blocks.ts` jest jedynym czytnikiem
// danych dla PUBLICZNYCH widoków bloków (`src/components/blocks/*`) i dla
// trasy łapiącej `/$`. Na 04.09.2026 miał 138/186 linii (74,19%), ale tylko
// 96/223 GAŁĘZI (43,04%) i 32/45 funkcji (71,11%) - klasyczny „test przechodzi
// środkiem". Pokryta była WARSTWA KLUCZY: `blocksData` istniejącego
// `blocks.test.ts` dowodzi, że `blockQueryOptionsList` mapuje `block.data` na
// właściwy `queryKey`. Nie wykonało się natomiast ani jedno CIAŁO `queryFn` -
// czyli każdy zacisk limitu, każde zawężenie filtrem, każde mapowanie wiersza
// na model widoku i KAŻDA ścieżka odmowy bazy. Do tego dwie funkcje eksportu
// SSR (`prefetchBlockDataQuery` :644 i `prefetchBlockQueries` :774) miały ZERO
// wywołań, a to one decydują, czy pierwsze wczytanie strony ma dane, czy
// crawler dostaje szkielet i runda żądań leci dopiero po hydracji.
//
// DLACZEGO OSOBNY PLIK, A NIE DOPISEK DO `blocks.test.ts`. Tam przedmiotem
// dowodu jest KSZTAŁT KLUCZA i tamten plik świadomie NIE podmienia klienta
// Supabase - `blockQueryOptionsList` da się wywołać bez bazy. Tutaj przedmiotem
// dowodu jest to, co robi `queryFn` PRZY bazie, więc klient musi być zaślepiony
// na poziomie modułu (`vi.mock` jest per-plik). Trzymanie obu w jednym pliku
// znaczyłoby atrapę klienta również dla testów kluczy - czyli słabszy dowód
// (klucz miałby prawo zależeć od atrapy) przy zerowym zysku.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   * ZACISK LIMITU JEST DOSŁOWNY. Każde zapytanie listowe ma własny sufit
//     (`latest-posts` 50, `tag-cloud` 200, `query-loop` 24, `related` 12,
//     `more-posts` 12 przy podłodze 2, kalendarz i archiwum 500). Sprawdzamy
//     ARGUMENT ogniwa `.limit()`, nie długość odpowiedzi atrapy: sufit zdjęty
//     w kodzie to nieograniczona lista na publicznej stronie, a atrapa i tak
//     oddałaby tyle wierszy, ile jej podać;
//   * PUSTKA I ODMOWA TO DWA RÓŻNE ŚWIATY. Każde `queryFn` w tym pliku ma
//     `if (error) throw error` i `data ?? []`. Odmowa MUSI rzucić (widok wchodzi
//     w stan błędu i ponawia), a `data === null` MUSI dać pustą listę (widok
//     rysuje „brak wpisów"). Zamiana tych dwóch zachowań miejscami daje
//     najgroźniejszy defekt tej warstwy: awarię bazy nie do odróżnienia od
//     braku treści;
//   * CZEGO KOD NIE PYTA. Kategoria bez wpisów, kategoria nieistniejąca,
//     `more-posts` w trybie „kategoria" bez kategorii w kontekście - wszystkie
//     te ścieżki mają zwrócić `[]` BEZ round-tripu po `posts`. To asercje na
//     BRAK łańcucha i jedyna forma, w jakiej „zero zbędnych żądań na ścieżce
//     TTFB" daje się dowieść;
//   * MAPOWANIE WIERSZA NA MODEL WIDOKU. Etykieta kategorii ma czterostopniowy
//     łańcuch zapaści (`name_<lang>` -> `name_pl` -> `name_en` -> `slug`) i to
//     on decyduje, czy w menu pojawi się puste miejsce; archiwum grupuje
//     wiersze na wiadra `YYYY-MM` z licznikiem; `more-posts` w trybie
//     „trending" przepisuje wynik RPC na `BlockPostRow` z ZEROWANYMI zajawkami;
//     ankieta zawęża `options` do tablicy, bo kolumna jest typu `jsonb`;
//   * PII NIE WYCIEKA PRZEZ author-bio. `AUTHOR_PROFILE_SELECT` świadomie NIE
//     zawiera `contact_email` (migracja odbiera anonowi SELECT na tej
//     kolumnie). Asercja na treść listy kolumn jest tania, a jej brak znaczy,
//     że dopisanie „jednej wygodnej kolumny" przechodzi przegląd;
//   * PREFETCH ROZGRZEWA DOKŁADNIE TEN KLUCZ, O KTÓRY PYTA KLIENT. To sedno
//     `prefetchBlockQueries`. Dowód idzie PRAWDZIWYM `QueryClient`-em: po
//     prefetchu `getQueryData(<klucz z publicznej fabryki>)` musi zwrócić dane.
//     Rozjazd klucza nie wywala niczego na czerwono - daje podwójne żądanie
//     i miganie treści po hydracji, więc bez tej asercji nie ma go czym złapać.
//     Osobno sprawdzamy, że `staleTime` PRZEŻYWA rzutowanie na
//     `FetchQueryOptions` w `prefetchBlockDataQuery` (drugi prefetch nie
//     strzela ponownie) i że jeden padający blok NIE wywraca loadera SSR
//     (`Promise.allSettled`).
//
// JAK. Zaślepiona jest DOKŁADNIE jedna granica: klient Supabase (łańcuch
// PostgREST + rejestrator RPC ze wspólnego harnessu `@/test/supabase`).
// Pokrywany moduł jest PRAWDZIWY - żadnego `vi.mock` na `@/lib/queries/blocks`.
// `queryFn` uruchamiamy prawdziwym `QueryClient.fetchQuery`, więc w pliku nie
// ma ani jednego rzutowania funkcji. Zero sieci, zero sekretów, dane
// syntetyczne.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * mapowania `block.data` -> `queryKey` dla latest-posts, taksonomii, tagów,
//     nawigacji, kalendarza, related/more-posts/neighbor i query-loop oraz
//     `calendarTarget` - to `src/lib/queries/__tests__/blocks.test.ts`. Tutaj
//     dokładam TYLKO te gałęzie planu, których tamten plik nie dotyka (ankieta
//     bez `pollId`, author-bio z wyłączonym licznikiem, liveblog bez wpisu,
//     warianty `strategy` i zapaści `num`/`str`);
//   * renderowania widoków bloków i ich stanów pustych - `src/components/blocks/
//     __tests__/*` (te pliki podmieniają CAŁY ten moduł na atrapę, więc nie
//     widzą ciał `queryFn` - stąd 43% gałęzi na wejściu);
//   * zachowania funkcji SQL (`trending_posts`, `page_full_path`) - jej
//     odpowiedź jest tu WEJŚCIEM, nie tezą; dowód należy do pgTAP;
//   * osobnego pomiaru stref kalendarza. Archiwum grupuje miesiące w UTC;
//     poniższe przypadki graniczne sprawdzają także zgodność emitowanego
//     zakresu z parserem wyszukiwarki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";
import { freezeClock } from "@/test/time";

freezeClock();

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

import { fail, ok, okCount, type RecordedChain } from "@/test/supabaseChain";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import {
  authorPostsCountQueryOptions,
  authorProfileByIdQueryOptions,
  blockArchivesQueryOptions,
  blockCategoriesQueryOptions,
  blockNavigationQueryOptions,
  blockQueryOptionsList,
  blockTagsQueryOptions,
  calendarBlockQueryOptions,
  latestPostsBlockQueryOptions,
  liveBlogEntriesBlockQueryOptions,
  morePostsBlockQueryOptions,
  pollBlockQueryOptions,
  postNeighborQueryOptions,
  prefetchBlockQueries,
  queryLoopBlockQueryOptions,
  relatedPostsBlockQueryOptions,
  type BlockPostRow,
} from "@/lib/queries/blocks";

// ---------------------------------------------------------------------------
// Narzędzia
// ---------------------------------------------------------------------------

/** Atrapa łańcucha PostgREST podpięta przez fabrykę `vi.mock`. */
function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return s;
}

/** Rejestrator wywołań RPC podpięty przez fabrykę `vi.mock`. */
function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return s;
}

/** Ostatni łańcuch dla tabeli. Brak łańcucha to BŁĄD TESTU, nie `undefined`:
 *  asercja „kod nie zapytał o tę tabelę" ma własną, jawną formę (`chainsFor`). */
function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

/** Świeży klient bez współdzielonego cache'u - `fetchQuery` naprawdę woła
 *  `queryFn`, a odmowa bazy nie jest ponawiana (inaczej test czeka na backoff). */
function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Wiersz `posts` w kształcie, w jakim czyta go warstwa bloków. */
function wpis(id: string, nad: Partial<BlockPostRow> = {}): BlockPostRow {
  return {
    id,
    slug: `wpis-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: `Zajawka ${id}`,
    excerpt_en: `Excerpt ${id}`,
    cover_image_url: `https://cdn.example.com/${id}.webp`,
    published_at: "2026-06-15T09:00:00.000Z",
    parent_page_id: null,
    ...nad,
  };
}

function dokument(bloki: Block[]): BlocksDoc {
  return { version: 1, blocks: bloki };
}

beforeEach(() => {
  baza().reset();
  funkcje().reset();
});

// ---------------------------------------------------------------------------
// postIdsForCategorySlug - prywatna, ale to ONA decyduje o zawężeniu trzech
// bloków listowych; wchodzimy w nią przez `latest-posts`.
// ---------------------------------------------------------------------------

describe("zawężenie kategorią (postIdsForCategorySlug)", () => {
  it("bez kategorii nie pyta o taksonomię i nie zawęża listy", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    const wynik = await klient().fetchQuery(
      latestPostsBlockQueryOptions({ count: 5, category: "" }),
    );
    expect(wynik).toHaveLength(1);
    // Pusty slug to BRAK filtra, nie „filtr po pustym slugu": jedno zapytanie.
    expect(baza().chainsFor("categories")).toEqual([]);
    expect(baza().chainsFor("post_categories")).toEqual([]);
    expect(lancuch("posts").has("in")).toBe(false);
  });

  it("kategoria przechodzi w listę id wpisów, bez duplikatów", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    // Ten sam wpis w dwóch wierszach (wpis w podkategorii i w kategorii) MUSI
    // wejść do `.in()` raz - inaczej PostgREST dostaje rosnącą listę duplikatów.
    baza().setResponse(
      "post_categories",
      ok([{ post_id: "p-1" }, { post_id: "p-2" }, { post_id: "p-1" }]),
    );
    baza().setResponse("posts", ok([wpis("p-1")]));
    await klient().fetchQuery(latestPostsBlockQueryOptions({ count: 5, category: "europa" }));
    expect(lancuch("categories").argsOf("eq")).toEqual(["slug", "europa"]);
    expect(lancuch("categories").has("maybeSingle")).toBe(true);
    expect(lancuch("post_categories").argsOf("eq")).toEqual(["category_id", "kat-1"]);
    expect(lancuch("posts").argsOf("in")).toEqual(["id", ["p-1", "p-2"]]);
  });

  it("kategoria, której nie ma w bazie, daje pustkę BEZ zapytania o wpisy", async () => {
    baza().setResponse("categories", ok(null));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 5, category: "widmo" })),
    ).resolves.toEqual([]);
    expect(baza().chainsFor("post_categories")).toEqual([]);
    expect(baza().chainsFor("posts")).toEqual([]);
  });

  it("kategoria bez przypisanych wpisów daje pustkę BEZ zapytania o wpisy", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    // `data: null` z PostgREST-a (nie pusta tablica) - i to też jest „zero wpisów".
    baza().setResponse("post_categories", ok(null));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 5, category: "pusta" })),
    ).resolves.toEqual([]);
    expect(baza().chainsFor("posts")).toEqual([]);
  });

  it("odmowa odczytu kategorii rzuca (widok wchodzi w błąd, nie w pustkę)", async () => {
    baza().setResponse("categories", fail("odmowa categories", "42501"));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 5, category: "europa" })),
    ).rejects.toThrow("odmowa categories");
  });

  it("odmowa odczytu przypisań kategorii rzuca", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    baza().setResponse("post_categories", fail("odmowa post_categories"));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 5, category: "europa" })),
    ).rejects.toThrow("odmowa post_categories");
  });
});

// ---------------------------------------------------------------------------
// latest-posts
// ---------------------------------------------------------------------------

describe("latestPostsBlockQueryOptions", () => {
  it("zaciska licznik do zakresu 1..50 po stronie ZAPYTANIA", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(latestPostsBlockQueryOptions({ count: 999, category: "" }));
    expect(lancuch("posts").argsOf("limit")).toEqual([50]);
    baza().reset();
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(latestPostsBlockQueryOptions({ count: 0, category: "" }));
    expect(lancuch("posts").argsOf("limit")).toEqual([1]);
  });

  it("pyta tylko o opublikowane, nieusunięte, od najnowszych - i o kolumny ujawnienia", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(latestPostsBlockQueryOptions({ count: 3, category: "" }));
    const c = lancuch("posts");
    expect(c.argsOf("eq")).toEqual(["status", "published"]);
    expect(c.argsOf("is")).toEqual(["deleted_at", null]);
    expect(c.argsOf("order")).toEqual(["published_at", { ascending: false }]);
    // Bez tych kolumn karta wpisu nie wie, że jest sponsorowana - a ujawnienie
    // materiału sponsorowanego jest wymogiem prawnym, nie ozdobą.
    expect(String(c.argsOf("select")?.[0])).toContain(SPONSORED_LIST_COLS);
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą listę", async () => {
    baza().setResponse("posts", fail("odmowa posts"));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 3, category: "" })),
    ).rejects.toThrow("odmowa posts");
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(latestPostsBlockQueryOptions({ count: 3, category: "" })),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// poll
// ---------------------------------------------------------------------------

describe("pollBlockQueryOptions", () => {
  it("czyta tylko ankiety open/closed i zwraca definicję z tablicą opcji", async () => {
    baza().setResponse(
      "polls",
      ok({
        id: "ank-1",
        question_pl: "Pytanie",
        question_en: "Question",
        options: [{ pl: "Tak", en: "Yes" }],
        status: "open",
        ends_at: null,
      }),
    );
    const wynik = await klient().fetchQuery(pollBlockQueryOptions("ank-1"));
    expect(wynik?.options).toEqual([{ pl: "Tak", en: "Yes" }]);
    const c = lancuch("polls");
    expect(c.argsOf("eq")).toEqual(["id", "ank-1"]);
    // Szkic NIE MOŻE wyciec do treści publicznej - to jest cała rola tego ogniwa.
    expect(c.argsOf("in")).toEqual(["status", ["open", "closed"]]);
    expect(c.has("maybeSingle")).toBe(true);
  });

  it("kolumna jsonb inna niż tablica daje puste opcje, nie wysypkę widoku", async () => {
    baza().setResponse(
      "polls",
      ok({
        id: "ank-2",
        question_pl: "P",
        question_en: "Q",
        options: { zle: "kształt" },
        status: "closed",
        ends_at: "2026-07-01T00:00:00.000Z",
      }),
    );
    const wynik = await klient().fetchQuery(pollBlockQueryOptions("ank-2"));
    expect(wynik?.options).toEqual([]);
  });

  it("brak ankiety daje null, a odmowa bazy rzuca", async () => {
    baza().setResponse("polls", ok(null));
    await expect(klient().fetchQuery(pollBlockQueryOptions("ank-3"))).resolves.toBeNull();
    baza().setResponse("polls", fail("odmowa polls"));
    await expect(klient().fetchQuery(pollBlockQueryOptions("ank-3"))).rejects.toThrow(
      "odmowa polls",
    );
  });
});

// ---------------------------------------------------------------------------
// taksonomie: categories / archives / tags / navigation
// ---------------------------------------------------------------------------

describe("blockCategoriesQueryOptions", () => {
  it("sortuje i etykietuje po języku strony (pl)", async () => {
    baza().setResponse(
      "categories",
      ok([{ slug: "europa", name_pl: "Europa", name_en: "Europe" }]),
    );
    const wynik = await klient().fetchQuery(blockCategoriesQueryOptions("pl"));
    expect(wynik).toEqual([{ label: "Europa", href: "/category/europa", count: 0 }]);
    expect(lancuch("categories").argsOf("order")).toEqual(["name_pl"]);
  });

  it("sortuje i etykietuje po języku strony (en)", async () => {
    baza().setResponse(
      "categories",
      ok([{ slug: "europa", name_pl: "Europa", name_en: "Europe" }]),
    );
    const wynik = await klient().fetchQuery(blockCategoriesQueryOptions("en"));
    expect(wynik[0]?.label).toBe("Europe");
    expect(lancuch("categories").argsOf("order")).toEqual(["name_en"]);
  });

  it("zapada się name_en -> name_pl -> slug, żeby menu nie miało pustych pozycji", async () => {
    baza().setResponse(
      "categories",
      ok([
        { slug: "bez-en", name_pl: "Tylko polska", name_en: null },
        { slug: "bez-pl", name_pl: null, name_en: "Only english" },
        { slug: "bez-nazwy", name_pl: null, name_en: null },
      ]),
    );
    const wynik = await klient().fetchQuery(blockCategoriesQueryOptions("en"));
    expect(wynik.map((r) => r.label)).toEqual(["Tylko polska", "Only english", "bez-nazwy"]);
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą listę", async () => {
    baza().setResponse("categories", fail("odmowa categories"));
    await expect(klient().fetchQuery(blockCategoriesQueryOptions("pl"))).rejects.toThrow(
      "odmowa categories",
    );
    baza().setResponse("categories", ok(null));
    await expect(klient().fetchQuery(blockCategoriesQueryOptions("pl"))).resolves.toEqual([]);
  });
});

describe("blockArchivesQueryOptions", () => {
  it("grupuje wpisy na wiadra YYYY-MM z licznikiem i adresem archiwum", async () => {
    baza().setResponse(
      "posts",
      ok([
        { published_at: "2026-06-15T09:00:00.000Z" },
        { published_at: "2026-06-20T09:00:00.000Z" },
        { published_at: "2026-05-10T09:00:00.000Z" },
      ]),
    );
    const wynik = await klient().fetchQuery(blockArchivesQueryOptions("pl"));
    expect(wynik.map((r) => [r.href, r.count])).toEqual([
      ["/search?from=2026-06-01&to=2026-06-30&sort=newest", 2],
      ["/search?from=2026-05-01&to=2026-05-31&sort=newest", 1],
    ]);
    expect(wynik[0]?.label).toBe("czerwiec 2026");
    const c = lancuch("posts");
    expect(c.argsOf("not")).toEqual(["published_at", "is", null]);
    expect(c.argsOf("limit")).toEqual([500]);
  });

  it("formatuje etykietę w języku strony", async () => {
    baza().setResponse("posts", ok([{ published_at: "2026-06-15T09:00:00.000Z" }]));
    const wynik = await klient().fetchQuery(blockArchivesQueryOptions("en"));
    expect(wynik[0]?.label).toBe("June 2026");
  });

  it("pomija wiersze bez daty publikacji", async () => {
    // Filtr `.not("published_at","is",null)` jest po stronie bazy, ale strażnik
    // w pętli musi zostać: bez niego `new Date(null)` daje wiadro „1970-01".
    baza().setResponse(
      "posts",
      ok([{ published_at: null }, { published_at: "2026-06-15T09:00:00.000Z" }]),
    );
    const wynik = await klient().fetchQuery(blockArchivesQueryOptions("pl"));
    expect(wynik).toHaveLength(1);
    expect(wynik[0]?.href).toBe("/search?from=2026-06-01&to=2026-06-30&sort=newest");
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą listę", async () => {
    baza().setResponse("posts", fail("odmowa archiwum"));
    await expect(klient().fetchQuery(blockArchivesQueryOptions("pl"))).rejects.toThrow(
      "odmowa archiwum",
    );
    baza().setResponse("posts", ok(null));
    await expect(klient().fetchQuery(blockArchivesQueryOptions("pl"))).resolves.toEqual([]);
  });

  it.each([
    ["2024-03-01T00:30:00+01:00", "2024-02-01", "2024-02-29"],
    ["2026-12-31T23:59:00Z", "2026-12-01", "2026-12-31"],
  ])(
    "adres archiwum %s zachowuje UTC i trafia do filtrów istniejącej wyszukiwarki",
    async (publishedAt, from, to) => {
      baza().setResponse("posts", ok([{ published_at: publishedAt }, { published_at: "invalid" }]));
      const [item] = await klient().fetchQuery(blockArchivesQueryOptions("pl"));
      const url = new URL(item.href, "https://nes.example");
      const { parseSearchParams } = await import("@/lib/search/searchParams");
      const { urlToFilters } = await import("@/lib/search/facetModel");
      const { searchEnabled } = await import("@/lib/queries/archives");
      const filters = urlToFilters(parseSearchParams(Object.fromEntries(url.searchParams)));
      expect(url.pathname).toBe("/search");
      expect(filters).toMatchObject({ dateFrom: from, dateTo: to, sort: "newest" });
      expect(searchEnabled(filters)).toBe(true);
      expect(item.count).toBe(1);
    },
  );
});

describe("blockTagsQueryOptions", () => {
  it("zaciska limit do zakresu 1..200 i sortuje po nazwie", async () => {
    baza().setResponse("tags", ok([{ slug: "ue", name: "UE" }]));
    await klient().fetchQuery(blockTagsQueryOptions(500));
    expect(lancuch("tags").argsOf("limit")).toEqual([200]);
    expect(lancuch("tags").argsOf("order")).toEqual(["name"]);
    baza().reset();
    baza().setResponse("tags", ok([]));
    await klient().fetchQuery(blockTagsQueryOptions(0));
    expect(lancuch("tags").argsOf("limit")).toEqual([1]);
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą listę", async () => {
    baza().setResponse("tags", fail("odmowa tags"));
    await expect(klient().fetchQuery(blockTagsQueryOptions(10))).rejects.toThrow("odmowa tags");
    baza().setResponse("tags", ok(null));
    await expect(klient().fetchQuery(blockTagsQueryOptions(10))).resolves.toEqual([]);
  });
});

describe("blockNavigationQueryOptions", () => {
  it("bierze do 20 kategorii w kolejności polskiej nazwy", async () => {
    baza().setResponse(
      "categories",
      ok([{ id: "k-1", slug: "europa", name_pl: "Europa", name_en: "Europe" }]),
    );
    const wynik = await klient().fetchQuery(blockNavigationQueryOptions());
    expect(wynik).toHaveLength(1);
    const c = lancuch("categories");
    expect(c.argsOf("order")).toEqual(["name_pl", { ascending: true }]);
    expect(c.argsOf("limit")).toEqual([20]);
  });

  it("odmowa bazy rzuca, a `data: null` daje puste menu", async () => {
    baza().setResponse("categories", fail("odmowa menu"));
    await expect(klient().fetchQuery(blockNavigationQueryOptions())).rejects.toThrow("odmowa menu");
    baza().setResponse("categories", ok(null));
    await expect(klient().fetchQuery(blockNavigationQueryOptions())).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// post-navigation-link
// ---------------------------------------------------------------------------

describe("postNeighborQueryOptions", () => {
  /** Atrapa `posts` odpowiadająca RÓŻNIE zależnie od kierunku porównania daty:
   *  `.lt` pyta o wpis STARSZY, `.gt` o NOWSZY. Bez tego rozróżnienia atrapa
   *  oddawałaby ten sam wiersz w obie strony i dowód o kierunku byłby fikcją. */
  function sasiedzi(starszy: BlockPostRow, nowszy: BlockPostRow): void {
    baza().setResponse("posts", (c) => (c.has("gt") ? ok([nowszy]) : ok([starszy])));
  }

  it("kierunek `prev` pyta o wpisy sprzed daty bieżącego, od najnowszych", async () => {
    baza().setResponse("posts", ok([wpis("stary", { published_at: "2026-06-01T00:00:00.000Z" })]));
    await klient().fetchQuery(
      postNeighborQueryOptions({
        currentId: "biezacy",
        publishedAt: "2026-06-15T09:00:00.000Z",
        direction: "prev",
      }),
    );
    const c = lancuch("posts");
    expect(c.argsOf("lt")).toEqual(["published_at", "2026-06-15T09:00:00.000Z"]);
    expect(c.has("gt")).toBe(false);
    expect(c.argsOf("order")).toEqual(["published_at", { ascending: false }]);
    // Bieżący wpis nie może być swoim własnym sąsiadem.
    expect(c.argsOf("neq")).toEqual(["id", "biezacy"]);
    expect(c.argsOf("limit")).toEqual([1]);
  });

  it("kierunek `next` pyta o wpisy po dacie bieżącego, od najstarszych", async () => {
    baza().setResponse("posts", ok([wpis("nowy", { published_at: "2026-07-01T00:00:00.000Z" })]));
    await klient().fetchQuery(
      postNeighborQueryOptions({
        currentId: "biezacy",
        publishedAt: "2026-06-15T09:00:00.000Z",
        direction: "next",
      }),
    );
    const c = lancuch("posts");
    expect(c.argsOf("gt")).toEqual(["published_at", "2026-06-15T09:00:00.000Z"]);
    expect(c.has("lt")).toBe(false);
    expect(c.argsOf("order")).toEqual(["published_at", { ascending: true }]);
  });

  it("brak sąsiada daje null - i `data: null` znaczy to samo co pusta lista", async () => {
    baza().setResponse("posts", ok([]));
    await expect(
      klient().fetchQuery(
        postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "next" }),
      ),
    ).resolves.toBeNull();
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(
        postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "prev" }),
      ),
    ).resolves.toBeNull();
  });

  it("wpis bez strony-rodzica dostaje adres /post/<slug> i NIE pyta o ścieżkę", async () => {
    baza().setResponse("posts", ok([wpis("a", { slug: "traktat", parent_page_id: null })]));
    const wynik = await klient().fetchQuery(
      postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "next" }),
    );
    expect(wynik?.href).toBe("/post/traktat");
    // Round-trip po ścieżce ma polecieć TYLKO dla wpisów zagnieżdżonych.
    expect(funkcje().names()).toEqual([]);
  });

  it("wpis zagnieżdżony dostaje adres z pełnej ścieżki strony-rodzica", async () => {
    baza().setResponse("posts", ok([wpis("a", { slug: "traktat", parent_page_id: "str-1" })]));
    funkcje().setData("page_full_path", "analizy/prawo");
    const wynik = await klient().fetchQuery(
      postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "next" }),
    );
    expect(wynik?.href).toBe("/analizy/prawo/traktat");
    expect(funkcje().lastCall("page_full_path")?.arg("_page_id")).toBe("str-1");
  });

  it("pusta, nietekstowa i ODMÓWIONA ścieżka zapadają się na prefiks /blog", async () => {
    baza().setResponse("posts", ok([wpis("a", { slug: "traktat", parent_page_id: "str-1" })]));
    // Trzy różne przyczyny, jeden skutek. To ŚWIADOMA konwencja repo - ten sam
    // fallback `?? "blog"` stoi w `queries/liveBlogs.ts:71` i `queries/series.ts`
    // - więc pinujemy ją jako stan faktyczny, nie zgłaszamy jako defekt.
    funkcje().setData("page_full_path", null);
    const bezSciezki = await klient().fetchQuery(
      postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "next" }),
    );
    expect(bezSciezki?.href).toBe("/blog/traktat");

    funkcje().setData("page_full_path", "");
    const pusta = await klient().fetchQuery(
      postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-16", direction: "next" }),
    );
    expect(pusta?.href).toBe("/blog/traktat");

    // Odmowa RPC nie jest tu w ogóle czytana (`error` nie jest destrukturyzowany),
    // więc awaria funkcji SQL wygląda dla czytelnika jak wpis niezagnieżdżony.
    funkcje().setError("page_full_path", "odmowa page_full_path", "42501");
    await expect(
      klient().fetchQuery(
        postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-17", direction: "next" }),
      ),
    ).rejects.toMatchObject({ message: "odmowa page_full_path" });
  });

  it("odmowa odczytu wpisów rzuca", async () => {
    baza().setResponse("posts", fail("odmowa sasiada"));
    await expect(
      klient().fetchQuery(
        postNeighborQueryOptions({ currentId: "x", publishedAt: "2026-06-15", direction: "next" }),
      ),
    ).rejects.toThrow("odmowa sasiada");
  });

  it("kierunek `next` oddaje wpis NOWSZY od bieżącego", async () => {
    const starszy = wpis("starszy", { published_at: "2026-06-01T00:00:00.000Z" });
    const nowszy = wpis("nowszy", { published_at: "2026-07-01T00:00:00.000Z" });
    sasiedzi(starszy, nowszy);
    const wynik = await klient().fetchQuery(
      postNeighborQueryOptions({
        currentId: "biezacy",
        publishedAt: "2026-06-15T09:00:00.000Z",
        direction: "next",
      }),
    );
    expect(wynik?.post.id).toBe("nowszy");
  });
});

// ---------------------------------------------------------------------------
// query-loop
// ---------------------------------------------------------------------------

describe("queryLoopBlockQueryOptions", () => {
  it("porządek alfabetyczny bierze kolumnę tytułu W JĘZYKU STRONY", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "title", lang: "en" }),
    );
    expect(lancuch("posts").argsOf("order")).toEqual(["title_en", { ascending: true }]);
    baza().reset();
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "title", lang: "pl" }),
    );
    expect(lancuch("posts").argsOf("order")).toEqual(["title_pl", { ascending: true }]);
  });

  it("porządek domyślny to najnowsze wpisy", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "date", lang: "pl" }),
    );
    expect(lancuch("posts").argsOf("order")).toEqual(["published_at", { ascending: false }]);
  });

  it("zaciska limit do zakresu 1..24", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 99, orderBy: "date", lang: "pl" }),
    );
    expect(lancuch("posts").argsOf("limit")).toEqual([24]);
    baza().reset();
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 0, orderBy: "date", lang: "pl" }),
    );
    expect(lancuch("posts").argsOf("limit")).toEqual([1]);
  });

  it("zawęża kategorią, a kategoria bez wpisów kończy się pustką bez zapytania", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    baza().setResponse("post_categories", ok([{ post_id: "p-1" }]));
    baza().setResponse("posts", ok([wpis("p-1")]));
    await klient().fetchQuery(
      queryLoopBlockQueryOptions({ categorySlug: "swiat", limit: 6, orderBy: "date", lang: "pl" }),
    );
    expect(lancuch("posts").argsOf("in")).toEqual(["id", ["p-1"]]);

    baza().reset();
    baza().setResponse("categories", ok({ id: "kat-2" }));
    baza().setResponse("post_categories", ok([]));
    await expect(
      klient().fetchQuery(
        queryLoopBlockQueryOptions({
          categorySlug: "pusta",
          limit: 6,
          orderBy: "date",
          lang: "pl",
        }),
      ),
    ).resolves.toEqual([]);
    expect(baza().chainsFor("posts")).toEqual([]);
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą pętlę", async () => {
    baza().setResponse("posts", fail("odmowa petli"));
    await expect(
      klient().fetchQuery(
        queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "date", lang: "pl" }),
      ),
    ).rejects.toThrow("odmowa petli");
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(
        queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "date", lang: "pl" }),
      ),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// related-posts
// ---------------------------------------------------------------------------

describe("relatedPostsBlockQueryOptions", () => {
  const bazowe = {
    currentId: "biezacy",
    strategy: "category" as const,
    categorySlugs: ["europa"] as readonly string[],
    tagSlugs: [] as readonly string[],
    authorId: null,
    limit: 3,
  };

  it("strategia kategorii idzie przez slugi -> id kategorii -> id wpisów", async () => {
    baza().setResponse("categories", ok([{ id: "kat-1" }, { id: "kat-2" }]));
    baza().setResponse(
      "post_categories",
      ok([{ post_id: "p-1" }, { post_id: "p-2" }, { post_id: "p-1" }]),
    );
    baza().setResponse("posts", ok([wpis("p-1")]));
    await klient().fetchQuery(relatedPostsBlockQueryOptions(bazowe));
    expect(lancuch("categories").argsOf("in")).toEqual(["slug", ["europa"]]);
    expect(lancuch("post_categories").argsOf("in")).toEqual(["category_id", ["kat-1", "kat-2"]]);
    expect(lancuch("posts").argsOf("in")).toEqual(["id", ["p-1", "p-2"]]);
    expect(lancuch("posts").argsOf("neq")).toEqual(["id", "biezacy"]);
  });

  it("slugi kategorii bez odpowiednika w bazie kończą się pustką, a nie najnowszymi wpisami", async () => {
    baza().setResponse("categories", ok([]));
    // Wiersz-pułapka. `relatedPosts` SKŁADA builder `posts` PRZED sprawdzeniem
    // pustej listy id (w odróżnieniu od latest-posts/query-loop, gdzie zwrot
    // następuje przed `from("posts")`), więc atrapa zapisuje ogniwo - ale
    // żądanie nigdy się nie rozwiązuje, bo builder jest porzucany. Dowodem na
    // brak round-tripu jest więc to, że ZAPLANOWANY wiersz nie wychodzi na
    // wierzch: gdyby zapytanie poleciało, blok „powiązane" pokazałby losowe
    // najnowsze wpisy pod nagłówkiem „w tej kategorii".
    baza().setResponse("posts", ok([wpis("nie-powinien-wyjsc")]));
    await expect(klient().fetchQuery(relatedPostsBlockQueryOptions(bazowe))).resolves.toEqual([]);
    expect(baza().chainsFor("post_categories")).toEqual([]);
    expect(lancuch("posts").has("in")).toBe(false);
  });

  it("PUSTA lista slugów NIE zawęża - blok na stronie bez kategorii pokazuje najnowsze", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(relatedPostsBlockQueryOptions({ ...bazowe, categorySlugs: [] }));
    // Różnica z przypadkiem wyżej jest zasadnicza: „brak wejścia" to brak
    // filtra, „wejście bez trafienia" to pustka.
    expect(baza().chainsFor("categories")).toEqual([]);
    expect(lancuch("posts").has("in")).toBe(false);
  });

  it("odmowa na którymkolwiek kroku taksonomii rzuca", async () => {
    baza().setResponse("categories", fail("odmowa kategorii"));
    await expect(klient().fetchQuery(relatedPostsBlockQueryOptions(bazowe))).rejects.toThrow(
      "odmowa kategorii",
    );
    baza().reset();
    baza().setResponse("categories", ok([{ id: "kat-1" }]));
    baza().setResponse("post_categories", fail("odmowa przypisan"));
    await expect(klient().fetchQuery(relatedPostsBlockQueryOptions(bazowe))).rejects.toThrow(
      "odmowa przypisan",
    );
  });

  it("strategia tagu idzie przez slugi tagów -> id tagów -> id wpisów", async () => {
    baza().setResponse("tags", ok([{ id: "tag-1" }]));
    baza().setResponse("post_tags", ok([{ post_id: "p-9" }]));
    baza().setResponse("posts", ok([wpis("p-9")]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({ ...bazowe, strategy: "tag", tagSlugs: ["ue", "nato"] }),
    );
    expect(lancuch("tags").argsOf("in")).toEqual(["slug", ["ue", "nato"]]);
    expect(lancuch("post_tags").argsOf("in")).toEqual(["tag_id", ["tag-1"]]);
    expect(lancuch("posts").argsOf("in")).toEqual(["id", ["p-9"]]);
    // Ścieżka tagowa NIE MOŻE dotykać tabel kategorii.
    expect(baza().chainsFor("categories")).toEqual([]);
  });

  it("tag bez odpowiednika w bazie kończy się pustką; odmowy rzucają", async () => {
    baza().setResponse("tags", ok([]));
    baza().setResponse("posts", ok([wpis("nie-powinien-wyjsc")]));
    await expect(
      klient().fetchQuery(
        relatedPostsBlockQueryOptions({ ...bazowe, strategy: "tag", tagSlugs: ["widmo"] }),
      ),
    ).resolves.toEqual([]);
    expect(baza().chainsFor("post_tags")).toEqual([]);

    baza().reset();
    baza().setResponse("tags", fail("odmowa tagow"));
    await expect(
      klient().fetchQuery(
        relatedPostsBlockQueryOptions({ ...bazowe, strategy: "tag", tagSlugs: ["ue"] }),
      ),
    ).rejects.toThrow("odmowa tagow");

    baza().reset();
    baza().setResponse("tags", ok([{ id: "tag-1" }]));
    baza().setResponse("post_tags", fail("odmowa post_tags"));
    await expect(
      klient().fetchQuery(
        relatedPostsBlockQueryOptions({ ...bazowe, strategy: "tag", tagSlugs: ["ue"] }),
      ),
    ).rejects.toThrow("odmowa post_tags");
  });

  it("`data: null` na tabelach taksonomii znaczy ZERO trafień, a nie brak zawężenia", async () => {
    // Cztery osobne strażniki `?? []` na ścieżce powiązanych wpisów. PostgREST
    // oddaje `data: null` (a nie `[]`) m.in. przy odfiltrowaniu całego zbioru
    // przez RLS, więc to realne wejście. Bez tych strażników byłby `TypeError`
    // na `.map` - blok „powiązane" wywalałby CAŁY widok wpisu.
    const przypadki: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ["kategorie null", { categories: null }],
      ["przypisania kategorii null", { categories: [{ id: "kat-1" }], post_categories: null }],
      ["tagi null", { tags: null }],
      ["przypisania tagów null", { tags: [{ id: "tag-1" }], post_tags: null }],
    ];
    for (const [nazwa, plan] of przypadki) {
      baza().reset();
      for (const [tabela, dane] of Object.entries(plan)) baza().setResponse(tabela, ok(dane));
      baza().setResponse("posts", ok([wpis("nie-powinien-wyjsc")]));
      const strategia = "tags" in plan || "post_tags" in plan ? "tag" : "category";
      await expect(
        klient().fetchQuery(
          relatedPostsBlockQueryOptions({
            ...bazowe,
            strategy: strategia,
            categorySlugs: ["europa"],
            tagSlugs: ["ue"],
          }),
        ),
        nazwa,
      ).resolves.toEqual([]);
    }
  });

  it("strategia autora zawęża po autorze - a bez autora w kontekście NIE zawęża wcale", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({
        ...bazowe,
        strategy: "author",
        categorySlugs: [],
        authorId: "aut-1",
      }),
    );
    expect(lancuch("posts").calls.filter((c) => c.method === "eq")).toEqual([
      { method: "eq", args: ["status", "published"] },
      { method: "eq", args: ["author_id", "aut-1"] },
    ]);

    baza().reset();
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({
        ...bazowe,
        strategy: "author",
        categorySlugs: [],
        authorId: null,
      }),
    );
    // Bez autora blok degraduje do „najnowsze" - i to jest widoczna decyzja,
    // nie zgubiony filtr: żadnego `eq("author_id", null)`.
    expect(lancuch("posts").calls.filter((c) => c.method === "eq")).toHaveLength(1);
  });

  it("strategia `latest` nie dotyka taksonomii, a brak bieżącego wpisu znosi wykluczenie", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({
        ...bazowe,
        strategy: "latest",
        categorySlugs: ["europa"],
        tagSlugs: ["ue"],
        currentId: null,
      }),
    );
    expect(baza().chainsFor("categories")).toEqual([]);
    expect(baza().chainsFor("tags")).toEqual([]);
    expect(lancuch("posts").has("neq")).toBe(false);
  });

  it("zaciska limit do zakresu 1..12", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({ ...bazowe, strategy: "latest", limit: 99 }),
    );
    expect(lancuch("posts").argsOf("limit")).toEqual([12]);
    baza().reset();
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      relatedPostsBlockQueryOptions({ ...bazowe, strategy: "latest", limit: 0 }),
    );
    expect(lancuch("posts").argsOf("limit")).toEqual([1]);
  });

  it("odmowa odczytu wpisów rzuca, a `data: null` daje pustą listę", async () => {
    baza().setResponse("posts", fail("odmowa powiazanych"));
    await expect(
      klient().fetchQuery(relatedPostsBlockQueryOptions({ ...bazowe, strategy: "latest" })),
    ).rejects.toThrow("odmowa powiazanych");
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(relatedPostsBlockQueryOptions({ ...bazowe, strategy: "latest" })),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// author-bio: licznik wpisów i profil
// ---------------------------------------------------------------------------

describe("authorPostsCountQueryOptions", () => {
  it("czyta SAM LICZNIK zapytaniem bez wierszy", async () => {
    baza().setResponse("posts", okCount(42));
    await expect(klient().fetchQuery(authorPostsCountQueryOptions("aut-1"))).resolves.toBe(42);
    const c = lancuch("posts");
    // `head: true` znaczy „nie przesyłaj wierszy" - to jedyna forma, w jakiej
    // odznaka licznika nie ciągnie całej twórczości autora na klienta.
    expect(c.argsOf("select")).toEqual(["id", { count: "exact", head: true }]);
    expect(c.calls.filter((x) => x.method === "eq")).toEqual([
      { method: "eq", args: ["author_id", "aut-1"] },
      { method: "eq", args: ["status", "published"] },
    ]);
    expect(c.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("brak licznika w odpowiedzi daje zero, a odmowa rzuca", async () => {
    baza().setResponse("posts", { data: null, error: null, count: null });
    await expect(klient().fetchQuery(authorPostsCountQueryOptions("aut-1"))).resolves.toBe(0);
    baza().setResponse("posts", fail("odmowa licznika"));
    await expect(klient().fetchQuery(authorPostsCountQueryOptions("aut-1"))).rejects.toThrow(
      "odmowa licznika",
    );
  });
});

describe("authorProfileByIdQueryOptions", () => {
  it("czyta profil z widoku publicznego i NIE pyta o adres e-mail autora", async () => {
    baza().setResponse("profiles_public", ok({ id: "aut-1", slug: "jan", display_name: "Jan" }));
    const wynik = await klient().fetchQuery(authorProfileByIdQueryOptions("aut-1"));
    expect(wynik?.id).toBe("aut-1");
    const c = lancuch("profiles_public");
    expect(c.argsOf("eq")).toEqual(["id", "aut-1"]);
    expect(c.has("maybeSingle")).toBe(true);
    // PII. Migracja odebrała anonowi SELECT na `contact_email`; dopisanie tej
    // kolumny do listy wywaliłoby publiczne bloki author-bio na 403 ALBO -
    // gorzej - ujawniło adres, gdyby grant kiedyś wrócił.
    expect(String(c.argsOf("select")?.[0])).not.toContain("contact_email");
  });

  it("brak profilu daje null, a odmowa rzuca", async () => {
    baza().setResponse("profiles_public", ok(null));
    await expect(klient().fetchQuery(authorProfileByIdQueryOptions("aut-x"))).resolves.toBeNull();
    baza().setResponse("profiles_public", fail("odmowa profilu"));
    await expect(klient().fetchQuery(authorProfileByIdQueryOptions("aut-x"))).rejects.toThrow(
      "odmowa profilu",
    );
  });
});

// ---------------------------------------------------------------------------
// more-posts
// ---------------------------------------------------------------------------

describe("morePostsBlockQueryOptions", () => {
  it("tryb `trending` woła funkcję SQL z oknem 7 dni i przepisuje wynik na wiersz bloku", async () => {
    funkcje().setData("trending_posts", [
      {
        id: "p-1",
        slug: "goraczka",
        title_pl: "Gorączka",
        title_en: "Fever",
        cover_image_url: "https://cdn.example.com/p1.webp",
        published_at: "2026-06-15T09:00:00.000Z",
        parent_page_id: null,
      },
    ]);
    const wynik = await klient().fetchQuery(
      morePostsBlockQueryOptions({ strategy: "trending", limit: 4, categorySlug: null }),
    );
    const wywolanie = funkcje().lastCall("trending_posts");
    expect(wywolanie?.arg("_days")).toBe(7);
    // `+1` to zapas na odrzucenie bieżącego wpisu w widoku.
    expect(wywolanie?.arg("_limit")).toBe(5);
    // Funkcja SQL nie zwraca zajawek - i to jest ŚWIADOMIE zapisane zerem,
    // a nie `undefined`: karta ma wtedy jednolity kształt i nie renderuje
    // „undefined" w miejscu skrótu.
    expect(wynik).toEqual([
      {
        id: "p-1",
        slug: "goraczka",
        title_pl: "Gorączka",
        title_en: "Fever",
        excerpt_pl: null,
        excerpt_en: null,
        cover_image_url: "https://cdn.example.com/p1.webp",
        published_at: "2026-06-15T09:00:00.000Z",
        parent_page_id: null,
      },
    ]);
    // Tryb popularności NIE MOŻE dotykać tabeli `posts` - całe zawężenie
    // (okno czasu, ranking) siedzi w funkcji SECURITY DEFINER.
    expect(baza().chains).toEqual([]);
  });

  it("odmowa funkcji SQL rzuca, a `data: null` daje pustą listę", async () => {
    funkcje().setError("trending_posts", "odmowa trending", "42501");
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "trending", limit: 4, categorySlug: null }),
      ),
    ).rejects.toThrow("odmowa trending");
    funkcje().setData("trending_posts", null);
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "trending", limit: 4, categorySlug: null }),
      ),
    ).resolves.toEqual([]);
  });

  it("zaciska limit do zakresu 2..12 (podłoga 2, nie 1) po obu stronach", async () => {
    funkcje().setData("trending_posts", []);
    await klient().fetchQuery(
      morePostsBlockQueryOptions({ strategy: "trending", limit: 1, categorySlug: null }),
    );
    expect(funkcje().lastCall("trending_posts")?.arg("_limit")).toBe(3);

    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(
      morePostsBlockQueryOptions({ strategy: "latest", limit: 99, categorySlug: null }),
    );
    expect(lancuch("posts").argsOf("limit")).toEqual([13]);
  });

  it("tryb `category` zawęża kategorią z kontekstu wpisu", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    baza().setResponse("post_categories", ok([{ post_id: "p-1" }]));
    baza().setResponse("posts", ok([wpis("p-1")]));
    await klient().fetchQuery(
      morePostsBlockQueryOptions({ strategy: "category", limit: 4, categorySlug: "europa" }),
    );
    expect(lancuch("posts").argsOf("in")).toEqual(["id", ["p-1"]]);
  });

  it("tryb `category` BEZ kategorii w kontekście nie wykonuje żadnego zapytania", async () => {
    // Wpis bez kategorii: blok ma zniknąć, a nie podmienić się na „najnowsze".
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "category", limit: 4, categorySlug: null }),
      ),
    ).resolves.toEqual([]);
    expect(baza().chains).toEqual([]);
    expect(funkcje().names()).toEqual([]);
  });

  it("tryb `category` z kategorią bez wpisów też kończy się pustką", async () => {
    baza().setResponse("categories", ok({ id: "kat-1" }));
    baza().setResponse("post_categories", ok([]));
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "category", limit: 4, categorySlug: "pusta" }),
      ),
    ).resolves.toEqual([]);
    expect(baza().chainsFor("posts")).toEqual([]);
  });

  it("tryb `latest` nie zawęża, a odmowa bazy rzuca", async () => {
    baza().setResponse("posts", ok([wpis("1")]));
    await klient().fetchQuery(
      morePostsBlockQueryOptions({ strategy: "latest", limit: 4, categorySlug: "europa" }),
    );
    // `categorySlug` jest ignorowany poza trybem kategorii - żadnego round-tripu
    // po taksonomię „na wszelki wypadek".
    expect(baza().chainsFor("categories")).toEqual([]);
    expect(lancuch("posts").has("in")).toBe(false);

    baza().setResponse("posts", fail("odmowa wiecej"));
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "latest", limit: 4, categorySlug: null }),
      ),
    ).rejects.toThrow("odmowa wiecej");
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(
        morePostsBlockQueryOptions({ strategy: "latest", limit: 4, categorySlug: null }),
      ),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calendar
// ---------------------------------------------------------------------------

describe("calendarBlockQueryOptions", () => {
  /** Granica okna odczytana z ogniwa filtra. */
  function granica(c: RecordedChain, ogniwo: "gte" | "lt"): Date {
    return new Date(String(c.argsOf(ogniwo)?.[1]));
  }

  it("pyta o okno DOKŁADNIE jednego miesiąca, rosnąco, z sufitem 500", async () => {
    baza().setResponse("posts", ok([{ slug: "a", published_at: "2026-06-15T09:00:00.000Z" }]));
    await klient().fetchQuery(calendarBlockQueryOptions({ year: 2026, month: 6 }));
    const c = lancuch("posts");
    const start = granica(c, "gte");
    const koniec = granica(c, "lt");
    // Granice liczone są tą samą arytmetyką lokalną, co w kodzie (`new Date(y,
    // m-1, 1)`), więc asercja czyta składowe lokalne - inaczej wynik zależałby
    // od `TZ` przebiegu i test byłby kruchy, a nie dowodowy.
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 5, 1]);
    expect([koniec.getFullYear(), koniec.getMonth(), koniec.getDate()]).toEqual([2026, 6, 1]);
    expect(c.argsOf("order")).toEqual(["published_at", { ascending: true }]);
    expect(c.argsOf("limit")).toEqual([500]);
  });

  it("grudzień przewija okno na styczeń następnego roku", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(calendarBlockQueryOptions({ year: 2026, month: 12 }));
    const koniec = granica(lancuch("posts"), "lt");
    // Bez przewinięcia roku kalendarz grudniowy pytałby o okno puste (miesiąc
    // 13 tego samego roku) i pokazywał grudzień bez ani jednego wpisu.
    expect([koniec.getFullYear(), koniec.getMonth()]).toEqual([2027, 0]);
  });

  it("odfiltrowuje wiersze bez daty publikacji", async () => {
    baza().setResponse(
      "posts",
      ok([
        { slug: "bez-daty", published_at: null },
        { slug: "z-data", published_at: "2026-06-15T09:00:00.000Z" },
      ]),
    );
    const wynik = await klient().fetchQuery(calendarBlockQueryOptions({ year: 2026, month: 6 }));
    // Kalendarz indeksuje dni po dacie - wiersz bez daty zapaliłby dzień „NaN".
    expect(wynik).toEqual([{ slug: "z-data", published_at: "2026-06-15T09:00:00.000Z" }]);
  });

  it("odmowa bazy rzuca, a `data: null` daje pusty miesiąc", async () => {
    baza().setResponse("posts", fail("odmowa kalendarza"));
    await expect(
      klient().fetchQuery(calendarBlockQueryOptions({ year: 2026, month: 6 })),
    ).rejects.toThrow("odmowa kalendarza");
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(calendarBlockQueryOptions({ year: 2026, month: 6 })),
    ).resolves.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// liveblog
// ---------------------------------------------------------------------------

describe("liveBlogEntriesBlockQueryOptions", () => {
  const wejscie = {
    postId: "p-1",
    blockId: "b-1",
    lang: "pl" as const,
    reverseChronological: true,
  };

  it("zawęża do wpisu, bloku i języka - i ma WŁASNE, krótsze okno świeżości", async () => {
    baza().setResponse(
      "live_blog_entries",
      ok([
        {
          id: "e-1",
          post_id: "p-1",
          block_id: "b-1",
          lang: "pl",
          title: "Wpis",
          body_html: "<p>treść</p>",
          pinned: false,
          occurred_at: "2026-06-15T09:00:00.000Z",
        },
      ]),
    );
    const wynik = await klient().fetchQuery(liveBlogEntriesBlockQueryOptions(wejscie));
    expect(wynik).toHaveLength(1);
    const c = lancuch("live_blog_entries");
    // Dwa bloki relacji na jednym wpisie to dwa niezależne strumienie: bez
    // `block_id` w filtrze wpisy z jednej relacji wsypałyby się do drugiej.
    expect(c.calls.filter((x) => x.method === "eq")).toEqual([
      { method: "eq", args: ["post_id", "p-1"] },
      { method: "eq", args: ["block_id", "b-1"] },
      { method: "eq", args: ["lang", "pl"] },
    ]);
    expect(c.argsOf("limit")).toEqual([200]);
    // 30 s, nie 2 min jak reszta bloków - relacja na żywo ma inny kontrakt
    // świeżości i to on musi dojechać do `useQuery` ORAZ do prefetchu SSR.
    expect(liveBlogEntriesBlockQueryOptions(wejscie).staleTime).toBe(30_000);
    expect(latestPostsBlockQueryOptions({ count: 5, category: "" }).staleTime).toBe(120_000);
  });

  it("kolejność wpisów wynika z ustawienia bloku", async () => {
    baza().setResponse("live_blog_entries", ok([]));
    await klient().fetchQuery(liveBlogEntriesBlockQueryOptions(wejscie));
    expect(lancuch("live_blog_entries").argsOf("order")).toEqual([
      "occurred_at",
      { ascending: false },
    ]);
    baza().reset();
    baza().setResponse("live_blog_entries", ok([]));
    await klient().fetchQuery(
      liveBlogEntriesBlockQueryOptions({ ...wejscie, reverseChronological: false }),
    );
    expect(lancuch("live_blog_entries").argsOf("order")).toEqual([
      "occurred_at",
      { ascending: true },
    ]);
  });

  it("odmowa bazy rzuca, a `data: null` daje pustą relację", async () => {
    baza().setResponse("live_blog_entries", fail("odmowa relacji"));
    await expect(klient().fetchQuery(liveBlogEntriesBlockQueryOptions(wejscie))).rejects.toThrow(
      "odmowa relacji",
    );
    baza().setResponse("live_blog_entries", ok(null));
    await expect(klient().fetchQuery(liveBlogEntriesBlockQueryOptions(wejscie))).resolves.toEqual(
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// blockQueryOptionsList - gałęzie planu, których NIE dotyka `blocks.test.ts`
// ---------------------------------------------------------------------------

describe("blockQueryOptionsList - warunki włączenia bloku do planu", () => {
  it("ankieta bez wskazanego id nie trafia do planu", () => {
    const plan = blockQueryOptionsList(
      dokument([
        { id: "a", type: "poll", data: {} },
        { id: "b", type: "poll", data: { pollId: "ank-1" } },
      ]),
      "pl",
    );
    // Blok świeżo wstawiony w edytorze nie ma jeszcze `pollId`; rozgrzewanie
    // klucza `["public","blocks","poll",""]` zaśmiecałoby cache wpisem, o który
    // nikt nie zapyta.
    expect(plan.map((o) => o.queryKey)).toEqual([pollBlockQueryOptions("ank-1").queryKey]);
  });

  it("author-bio pyta o licznik tylko przy autorze w kontekście i włączonej odznace", () => {
    const doc = dokument([{ id: "a", type: "author-bio", data: {} }]);
    expect(blockQueryOptionsList(doc, "pl", { authorId: "aut-1" }).map((o) => o.queryKey)).toEqual([
      authorPostsCountQueryOptions("aut-1").queryKey,
    ]);
    expect(blockQueryOptionsList(doc, "pl", {})).toHaveLength(0);
    const bezOdznaki = dokument([{ id: "a", type: "author-bio", data: { showPostsCount: false } }]);
    expect(blockQueryOptionsList(bezOdznaki, "pl", { authorId: "aut-1" })).toHaveLength(0);
    // `showPostsCount: true` i BRAK klucza mają znaczyć to samo (domyślnie włączone).
    const jawnie = dokument([{ id: "a", type: "author-bio", data: { showPostsCount: true } }]);
    expect(blockQueryOptionsList(jawnie, "pl", { authorId: "aut-1" })).toHaveLength(1);
  });

  it("liveblog wchodzi do planu tylko wewnątrz wpisu i niesie WŁASNE id bloku", () => {
    const doc = dokument([{ id: "blok-relacji", type: "liveblog", data: {} }]);
    expect(blockQueryOptionsList(doc, "pl", {})).toHaveLength(0);
    const [opts] = blockQueryOptionsList(doc, "en", { postId: "p-1" });
    expect(opts?.queryKey).toEqual(
      liveBlogEntriesBlockQueryOptions({
        postId: "p-1",
        blockId: "blok-relacji",
        lang: "en",
        reverseChronological: true,
      }).queryKey,
    );
    const odwrotnie = dokument([
      { id: "blok-relacji", type: "liveblog", data: { reverseChronological: false } },
    ]);
    const [odwrocony] = blockQueryOptionsList(odwrotnie, "en", { postId: "p-1" });
    expect(odwrocony?.queryKey).toEqual(
      liveBlogEntriesBlockQueryOptions({
        postId: "p-1",
        blockId: "blok-relacji",
        lang: "en",
        reverseChronological: false,
      }).queryKey,
    );
  });

  it("more-posts: każda strategia daje inny klucz, a nieznana zapada się na `latest`", () => {
    const klucz = (dane: Record<string, string | number>, kategorie?: readonly string[]) =>
      blockQueryOptionsList(dokument([{ id: "a", type: "more-posts", data: dane }]), "pl", {
        categorySlugs: kategorie,
      })[0]?.queryKey;

    expect(klucz({ strategy: "trending", limit: 6 })).toEqual(
      morePostsBlockQueryOptions({ strategy: "trending", limit: 6, categorySlug: null }).queryKey,
    );
    expect(klucz({ strategy: "category", limit: 6 }, ["europa"])).toEqual(
      morePostsBlockQueryOptions({ strategy: "category", limit: 6, categorySlug: "europa" })
        .queryKey,
    );
    // Strategia „kategoria" na stronie bez kategorii: klucz z `null`, nie brak
    // klucza - widok sam pokaże pustkę, a prefetch nie zgadnie innej kategorii.
    expect(klucz({ strategy: "category", limit: 6 })).toEqual(
      morePostsBlockQueryOptions({ strategy: "category", limit: 6, categorySlug: null }).queryKey,
    );
    expect(klucz({ strategy: "cokolwiek", limit: 6 })).toEqual(
      morePostsBlockQueryOptions({ strategy: "latest", limit: 6, categorySlug: null }).queryKey,
    );
  });

  it("related-posts: strategie `author`/`latest`/nieznana i zapaści kontekstu", () => {
    const klucz = (strategia: string) =>
      blockQueryOptionsList(
        dokument([{ id: "a", type: "related-posts", data: { strategy: strategia } }]),
        "pl",
      )[0]?.queryKey;
    const pusty = {
      currentId: null,
      categorySlugs: [] as readonly string[],
      tagSlugs: [] as readonly string[],
      authorId: null,
      limit: 3,
    };
    expect(klucz("author")).toEqual(
      relatedPostsBlockQueryOptions({ ...pusty, strategy: "author" }).queryKey,
    );
    expect(klucz("latest")).toEqual(
      relatedPostsBlockQueryOptions({ ...pusty, strategy: "latest" }).queryKey,
    );
    // Nieznana wartość z importu WordPressa nie może wywalić planu ani wpaść
    // do klucza „jak jest" - zapada się na kategorię.
    expect(klucz("bzdura")).toEqual(
      relatedPostsBlockQueryOptions({ ...pusty, strategy: "category" }).queryKey,
    );
  });

  it("query-loop i post-navigation-link zapadają się na wartości domyślne", () => {
    const [petla] = blockQueryOptionsList(
      dokument([{ id: "a", type: "query-loop", data: { orderBy: "losowo" } }]),
      "pl",
    );
    expect(petla?.queryKey).toEqual(
      queryLoopBlockQueryOptions({ categorySlug: "", limit: 6, orderBy: "date", lang: "pl" })
        .queryKey,
    );
    const [sasiad] = blockQueryOptionsList(
      dokument([{ id: "a", type: "post-navigation-link", data: { direction: "wszedzie" } }]),
      "pl",
      { postId: "p-1", publishedAt: "2026-06-15T09:00:00.000Z" },
    );
    expect(sasiad?.queryKey).toEqual(
      postNeighborQueryOptions({
        currentId: "p-1",
        publishedAt: "2026-06-15T09:00:00.000Z",
        direction: "next",
      }).queryKey,
    );
  });

  it("wartości `block.data` innego typu niż oczekiwany zapadają się na domyślne", () => {
    // `block.data` jest `Record<string, Json>` - do bazy trafia to, co zapisał
    // edytor ALBO importer WordPressa, więc liczba w miejscu slugu i tekst
    // w miejscu licznika to realne wejścia, nie hipoteza.
    const [najnowsze] = blockQueryOptionsList(
      dokument([{ id: "a", type: "latest-posts", data: { count: "duzo", category: 42 } }]),
      "pl",
    );
    expect(najnowsze?.queryKey).toEqual(
      latestPostsBlockQueryOptions({ count: 5, category: "" }).queryKey,
    );
    // `null` przechodzi przez `Number(null) === 0` (wartość SKOŃCZONA), więc
    // zapaść na 30 NIE następuje - klucz niesie zero, a sufit/podłoga zaciska
    // się dopiero w `queryFn`. To stan faktyczny, nie postulat.
    const [tagi] = blockQueryOptionsList(
      dokument([{ id: "a", type: "tag-cloud", data: { count: null } }]),
      "pl",
    );
    expect(tagi?.queryKey).toEqual(blockTagsQueryOptions(0).queryKey);
    const [tagiDomyslne] = blockQueryOptionsList(
      dokument([{ id: "a", type: "tag-cloud", data: { count: "trzydzieści" } }]),
      "pl",
    );
    expect(tagiDomyslne?.queryKey).toEqual(blockTagsQueryOptions(30).queryKey);
  });

  it("kalendarz bez miesiąca celuje w miesiąc bieżący", () => {
    const [teraz] = blockQueryOptionsList(
      dokument([{ id: "a", type: "calendar", data: { month: "nie-data" } }]),
      "pl",
    );
    const d = new Date();
    expect(teraz?.queryKey).toEqual(
      calendarBlockQueryOptions({ year: d.getFullYear(), month: d.getMonth() + 1 }).queryKey,
    );
  });
});

// ---------------------------------------------------------------------------
// PREFETCH SSR - `prefetchBlockQueries` + `prefetchBlockDataQuery`
// ---------------------------------------------------------------------------

describe("prefetchBlockQueries", () => {
  it("dokument bez bloków danych nie wykonuje ANI JEDNEGO zapytania", async () => {
    const qc = klient();
    await prefetchBlockQueries(
      qc,
      dokument([
        { id: "a", type: "paragraph", data: { text: "tekst" } },
        { id: "b", type: "separator", data: {} },
      ]),
      "pl",
    );
    // Wyjście na skróty przy pustym planie to nie mikrooptymalizacja: loader
    // trasy `/$` woła tę funkcję dla KAŻDEJ strony, także czysto tekstowej.
    expect(baza().chains).toEqual([]);
    expect(funkcje().names()).toEqual([]);
    expect(qc.getQueryCache().getAll()).toEqual([]);
  });

  it("rozgrzewa DOKŁADNIE te klucze, o które potem pyta klient", async () => {
    baza().setResponse("posts", ok([wpis("p-1")]));
    baza().setResponse("categories", (c) =>
      // Ta sama tabela obsługuje tu dwa różne zapytania (menu/lista taksonomii
      // czyta wiersze, zawężenie kategorią woła `maybeSingle`).
      c.has("maybeSingle")
        ? ok({ id: "kat-1" })
        : ok([{ slug: "europa", name_pl: "Europa", name_en: "Europe" }]),
    );
    baza().setResponse("tags", ok([{ slug: "ue", name: "UE" }]));

    const qc = klient();
    await prefetchBlockQueries(
      qc,
      dokument([
        { id: "a", type: "latest-posts", data: { count: 3, category: "" } },
        { id: "b", type: "categories-list", data: {} },
        { id: "c", type: "tag-cloud", data: { count: 12 } },
      ]),
      "pl",
    );

    // SEDNO CAŁEJ FUNKCJI. Klucz odczytujemy z PUBLICZNYCH fabryk - z tych
    // samych, których używają widoki (`LatestPostsView`, `TaxonomyListView`,
    // `TagCloudView`). Gdyby prefetch rozgrzewał choćby o jeden znak inny
    // klucz, nic nie zapaliłoby się na czerwono: strona po prostu strzeliłaby
    // po hydracji drugi raz i mrugnęła treścią.
    expect(
      qc.getQueryData(latestPostsBlockQueryOptions({ count: 3, category: "" }).queryKey),
    ).toEqual([wpis("p-1")]);
    expect(qc.getQueryData(blockCategoriesQueryOptions("pl").queryKey)).toEqual([
      { label: "Europa", href: "/category/europa", count: 0 },
    ]);
    expect(qc.getQueryData(blockTagsQueryOptions(12).queryKey)).toEqual([
      { slug: "ue", name: "UE" },
    ]);
  });

  it("przenosi kontekst wpisu do kluczy zależnych od bieżącej treści", async () => {
    baza().setResponse("posts", ok([wpis("sasiad", { slug: "sasiad" })]));
    baza().setResponse("live_blog_entries", ok([]));
    const qc = klient();
    const ctx = {
      postId: "p-1",
      publishedAt: "2026-06-15T09:00:00.000Z",
      authorId: "aut-1",
      categorySlugs: ["europa"] as readonly string[],
      tagSlugs: ["ue"] as readonly string[],
    };
    await prefetchBlockQueries(
      qc,
      dokument([
        { id: "n", type: "post-navigation-link", data: { direction: "next" } },
        { id: "r", type: "liveblog", data: {} },
      ]),
      "pl",
      ctx,
    );
    expect(
      qc.getQueryData(
        postNeighborQueryOptions({
          currentId: "p-1",
          publishedAt: "2026-06-15T09:00:00.000Z",
          direction: "next",
        }).queryKey,
      ),
    ).toEqual({ post: wpis("sasiad", { slug: "sasiad" }), href: "/post/sasiad" });
    expect(
      qc.getQueryData(
        liveBlogEntriesBlockQueryOptions({
          postId: "p-1",
          blockId: "r",
          lang: "pl",
          reverseChronological: true,
        }).queryKey,
      ),
    ).toEqual([]);
  });

  it("jeden padający blok NIE wywraca loadera SSR i nie truje pozostałych", async () => {
    // `Promise.allSettled`: gdyby to był `Promise.all`, odmowa na jednej tabeli
    // (np. RLS na `tags`) wywaliłaby CAŁE renderowanie serwerowe strony -
    // czytelnik dostałby 500 zamiast strony z jednym pustym widgetem.
    baza().setResponse("tags", fail("odmowa tags", "42501"));
    baza().setResponse("categories", ok([{ slug: "europa", name_pl: "Europa", name_en: null }]));
    const qc = klient();
    await expect(
      prefetchBlockQueries(
        qc,
        dokument([
          { id: "a", type: "tag-cloud", data: { count: 5 } },
          { id: "b", type: "categories-list", data: {} },
        ]),
        "pl",
      ),
    ).resolves.toBeUndefined();
    expect(qc.getQueryData(blockTagsQueryOptions(5).queryKey)).toBeUndefined();
    expect(qc.getQueryData(blockCategoriesQueryOptions("pl").queryKey)).toHaveLength(1);
  });

  it("okno świeżości PRZEŻYWA rzutowanie w prefetchBlockDataQuery", async () => {
    // `prefetchBlockDataQuery` rzutuje unię opcji na bazowy `FetchQueryOptions`
    // (unia nie ma jednej instancjacji generyka). Rzutowanie ma być SZEROKIE,
    // ale nie może zgubić `staleTime` - inaczej każdy blok byłby pobierany
    // dwa razy: raz przez loader, raz przez `useQuery` po hydracji.
    baza().setResponse("posts", ok([wpis("p-1")]));
    const qc = klient();
    const doc = dokument([{ id: "a", type: "latest-posts", data: { count: 3 } }]);
    await prefetchBlockQueries(qc, doc, "pl");
    expect(baza().chainsFor("posts")).toHaveLength(1);
    await prefetchBlockQueries(qc, doc, "pl");
    expect(baza().chainsFor("posts")).toHaveLength(1);
  });
});
