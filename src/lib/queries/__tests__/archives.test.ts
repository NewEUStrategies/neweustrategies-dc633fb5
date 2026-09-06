// ARCHIWA I WYSZUKIWARKA - co użytkownik dostaje, gdy baza odpowie inaczej niż
// szczęśliwie.
//
// CO TO DOWODZI. `src/lib/queries/archives.ts` jest JEDYNYM czytnikiem treści
// dla stron /category/$slug, /tag/$slug, /search i /publications. Nie renderuje
// niczego - decyduje, JAKIE zapytanie poleci i CO wróci, gdy nie poleci dobrze.
// Testy są nazwane po skutkach dla czytelnika i dla danych, nie po funkcjach:
//
//   * AWARIA NIE MOŻE WYGLĄDAĆ JAK PUSTKA. Ten plik ma pięć miejsc, w których
//     odmowa bazy jest wyrzucana bez śladu: `const { data }` bez `error`
//     (linie 56, 117, 158, 602, 643) i dwa `catch { return [] }` (612, 660).
//     Każde z nich dostaje tu DWA osobne przypadki - jeden przypina stan
//     faktyczny, drugi (`it.fails`) mówi, jaki skutek ma to dla człowieka.
//     Klasa defektu „awaria wygląda jak brak danych" wystąpiła w tym repo
//     trzykrotnie, więc pustka i błąd są tu rozdzielone WSZĘDZIE, gdzie
//     warstwa danych umie zwrócić jedno i drugie (taksonomia, pivot, wpisy,
//     szablon, trafienia, fasety, podpowiedzi, osoby i organizacje);
//   * KOLEJNOŚĆ SORTOWANIA JEST KONTRAKTEM. `sort=popular` musi dać DWA ogniwa
//     `.order()` (views_count, potem published_at jako rozstrzygnięcie remisów).
//     Jedno ogniwo mniej = losowa kolejność wpisów o równej liczbie odsłon
//     między stronami wyników, czyli wpisy gubione i dublowane w paginacji;
//   * OKNO STRONY JEST DOKŁADNE. `range(from, to)` liczone z `page`/`pageSize`
//     sprawdzamy na pierwszej stronie, w środku i ZA ostatnią stroną - bo
//     `total` pochodzi z `count`, nie z długości wiersza, i strona poza
//     zakresem musi oddać pustą listę z PRAWDZIWYM licznikiem, nie zero;
//   * NAZWY ARGUMENTÓW RPC TO JEDYNY DOWÓD. `page_full_paths` jest wołane przez
//     rzutowanie `unknown` (linie 40-45), które ZDEJMUJE typowanie, a
//     `search_posts` / `search_facets` / `log_search_query` dostają obiekt
//     luźnych kluczy. Literówka w `_page_ids`, `_term_groups` czy `_date_to`
//     przechodzi przez `tsc` i przez przegląd, a serwer po prostu zignoruje
//     zawężenie: użytkownik dostaje wyniki SPOZA swojego filtra. Stąd asercje
//     po NAZWACH argumentów, nie po danych;
//   * FASETY LICZĄ SIĘ Z CAŁEGO ZBIORU, nie z okna - `search_facets` nie może
//     dostać `_limit` ani `_sort`. Inaczej liczniki przy filtrach opisywałyby
//     60 pokazanych wyników, a nie wszystkie trafienia.
//
// JAK. Zaślepione są DOKŁADNIE cztery granice: klient Supabase (łańcuch
// PostgREST + rejestrator RPC ze wspólnego harnessu `@/test/supabase`), cache
// brzegowy (przezroczysty, ale zapisuje klucz i TTL), język runtime i server fn
// warstwy semantycznej. Zero sieci, zero sekretów, zero prawdziwego zegara
// (data bazowa 2026-08-21T10:00). `queryFn` uruchamiamy PRAWDZIWYM
// `QueryClient.fetchQuery`, więc nie ma tu ani jednego rzutowania funkcji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * KLUCZY SSR-PREFETCH BLOGA (`blogArchiveQueryOptions`) dowodzi
//     `blogArchive.test.ts`, a bloków - `blocks.test.ts`. To inne fabryki
//     zapytań w tym samym katalogu i tu nie ma dla nich ani jednej asercji;
//   * MECHANIKI cache'u brzegowego (skopowanie hostem, okno serve-stale,
//     single-flight, wygaśnięcie za 5x TTL) dowodzi
//     `src/lib/__tests__/ssrCacheHostScope.test.ts`. Tutaj `edgeTtlCache` jest
//     przezroczysty; sprawdzam wyłącznie Z CZEGO ZBUDOWANY jest jego klucz, bo
//     zgubiony w kluczu `sort` albo `page` serwowałby stronę 3 pod adresem
//     strony 1 - i to należy do TEGO pliku;
//   * RANKINGU I TREŚCI funkcji SQL (`search_posts`, `search_facets`,
//     `search_autosuggest`, `page_full_paths`, ekspansji hierarchii termów,
//     fallbacku trigramowego) dowodzi pgTAP. Tu dowodzę tylko tego, że kod
//     woła te funkcje z takimi nazwami argumentów i co robi z odpowiedzią;
//   * WARSTWY SEMANTYCZNEJ od strony dostawcy embeddingów
//     (`src/lib/server/__tests__/embeddingsIndex.test.ts`) ani samego server
//     fn-a (`src/lib/search/__tests__/searchFunctions.test.ts`) - tutaj
//     `semanticSearch` jest atrapą i sprawdzam tylko, KIEDY jest wołany i jak
//     jego wynik przestawia kolejność FTS;
//   * RENDERU I ADRESÓW stron wyników - `src/components/archive/__tests__/
//     TaxonomyPage.test.tsx`, `src/routes/__tests__/searchRoute.test.tsx`,
//     `archiveRoutesRender.test.tsx` (wszystkie zaślepiają TEN moduł, więc nie
//     wykonują ani jednej jego linii), a modelu faset - `lib/search/__tests__/
//     facetModel.test.ts`;
//   * ODPORNOŚCI `coerce` ustawień layoutu archiwum -
//     `src/lib/__tests__/archiveLayoutSettings.test.ts`;
//   * IZOLACJI NAJEMCÓW - to RLS i pgTAP; ten moduł nie filtruje po tenancie
//     i nie ma tu ani jednej asercji „czy jest filtr tenanta".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  fail,
  ok,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import type { RecordedRpc, SupabaseRpcStub } from "@/test/supabase/rpc";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
import type { SemanticHit } from "@/lib/search/semantic.functions";

/** Data bazowa całego pliku - żaden przypadek nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  /** Klucze i TTL, z jakimi kod sięgnął po cache brzegowy. */
  cache: [] as Array<{ key: string; ttl: number }>,
  jezyk: "pl",
  semantyka: vi.fn<(input: { data: { q: string } }) => Promise<{ hits: SemanticHit[] }>>(),
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub: rpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = rpcStub();
  h.from = from;
  h.rpc = rpc;
  return { supabase: { from: from.from, rpc: rpc.rpc } };
});

// Cache per-izolat jest tu PRZEZROCZYSTY (mechanikę ma własny plik), ale
// zapisuje klucz i TTL - bo to, co wchodzi do klucza, jest kontraktem TEGO
// modułu: brakujący `sort` w kluczu serwowałby archiwum posortowane inaczej.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> => {
    h.cache.push({ key, ttl });
    return fn();
  },
}));

vi.mock("@/lib/i18n/localeRuntime", () => ({ currentLang: () => h.jezyk }));

vi.mock("@/lib/search/semantic.functions", () => ({ semanticSearch: h.semantyka }));

import {
  ARCHIVE_PAGE_SIZE,
  SEARCH_LIMIT_MAX,
  SEARCH_PAGE_SIZE,
  TAXONOMY_DIMS,
  searchAutosuggestQueryOptions,
  searchEnabled,
  searchPeopleOrgsQueryOptions,
  searchQueryOptions,
  taxonomyArchiveQueryOptions,
  type SearchFilters,
} from "@/lib/queries/archives";

// ---------- strażniki zawężające (zamiast rzutowań) ------------------------

/** Atrapa łańcucha PostgREST podpięta przez fabrykę `vi.mock`. */
function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("atrapa łańcucha Supabase nie została podpięta");
  return s;
}

/** Rejestrator wywołań RPC podpięty przez fabrykę `vi.mock`. */
function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("atrapa RPC Supabase nie została podpięta");
  return s;
}

/** Ostatni łańcuch dla tabeli. Brak łańcucha to BŁĄD TESTU, nie `undefined`:
 *  asercja „kod nie zapytał o tę tabelę" ma własną, jawną formę niżej. */
function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

/** Ostatnie wywołanie RPC o danej nazwie (brak = błąd testu, jak wyżej). */
function wywolanie(nazwa: string): RecordedRpc {
  const c = funkcje().lastCall(nazwa);
  if (!c) throw new Error(`test: kod nie wywołał RPC "${nazwa}"`);
  return c;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - `argsOf` oddaje tylko pierwsze,
 *  a `.order()` bywa w tym pliku wywołane dwa razy i to jest cała rzecz. */
function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

/**
 * Odpowiedź zapytania LISTUJĄCEGO z licznikiem `{ count: "exact" }`.
 * `ok()` nie ustawia `count`, a archiwum czyta `count`, nie `data.length` -
 * bez tego pola `total` byłby zawsze zerem i paginacja by nie istniała.
 */
function okZLicznikiem<T>(rows: readonly T[], count: number): SupabaseResult<readonly T[]> {
  return { data: rows, error: null, count };
}

/** Świeży klient na każde uruchomienie: bez ponowień i bez współdzielonego
 *  cache, więc `fetchQuery` naprawdę woła `queryFn` i oddaje jej wynik
 *  (albo odrzuca obietnicę jej wyjątkiem) - bez rzutowania `queryFn`. */
function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// ---------- fabryki danych -------------------------------------------------

const STRONA_RODZIC = "str-analizy";
const SCIEZKA_RODZICA = "analizy/prawo";

const WIERSZ_KATEGORII = {
  id: "kat-1",
  slug: "analizy",
  name_pl: "Analizy",
  name_en: "Analyses",
  description_pl: "opis pl",
  description_en: "opis en",
  featured_template_id: null,
};

const WIERSZ_TAGU = {
  id: "tag-1",
  slug: "nato",
  name: "NATO",
  featured_template_id: null,
};

function wpis(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T00:00:00.000Z",
    parent_page_id: STRONA_RODZIC,
    author_id: "aut-1",
    is_sponsored: null,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...over,
  };
}

function trafienie(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T00:00:00.000Z",
    parent_page_id: STRONA_RODZIC,
    author_id: "aut-1",
    headline_pl: null,
    headline_en: null,
    post_format: "standard",
    access_mode: "public",
    rank: 1,
    total_count: 1,
    fuzzy: false,
    ...over,
  };
}

const SCIEZKI_OK = ok([{ page_id: STRONA_RODZIC, full_path: SCIEZKA_RODZICA }]);

interface PlanArchiwum {
  kind: "category" | "tag";
  taksonomia?: SupabaseResult;
  pivot?: SupabaseResult;
  wpisy?: SupabaseResult;
  szablon?: SupabaseResult;
  sciezki?: SupabaseResult;
}

function planujArchiwum(p: PlanArchiwum): void {
  const s = baza();
  const kategoria = p.kind === "category";
  s.setResponse(
    kategoria ? "categories" : "tags",
    p.taksonomia ?? ok(kategoria ? WIERSZ_KATEGORII : WIERSZ_TAGU),
  );
  s.setResponse(kategoria ? "post_categories" : "post_tags", p.pivot ?? ok([{ post_id: "p1" }]));
  s.setResponse("posts", p.wpisy ?? okZLicznikiem([wpis("p1")], 1));
  s.setResponse("builder_templates", p.szablon ?? ok(null));
  funkcje().setResponse("page_full_paths", p.sciezki ?? SCIEZKI_OK);
}

interface PlanWyszukiwania {
  trafienia?: SupabaseResult;
  fasety?: SupabaseResult;
  oznaczenia?: SupabaseResult;
  sciezki?: SupabaseResult;
  log?: SupabaseResult;
  hits?: SemanticHit[];
}

function planujWyszukiwanie(p: PlanWyszukiwania = {}): void {
  funkcje().setResponse("search_posts", p.trafienia ?? ok([]));
  funkcje().setResponse("search_facets", p.fasety ?? ok([]));
  funkcje().setResponse("page_full_paths", p.sciezki ?? SCIEZKI_OK);
  funkcje().setResponse("log_search_query", p.log ?? ok(null));
  baza().setResponse("posts", p.oznaczenia ?? ok([]));
  h.semantyka.mockResolvedValue({ hits: p.hits ?? [] });
}

const PUSTE_FILTRY: SearchFilters = { q: "" };

// ---------- cykl życia -----------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  funkcje().reset();
  h.cache.length = 0;
  h.jezyk = "pl";
  h.semantyka.mockReset();
  h.semantyka.mockResolvedValue({ hits: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

// ==========================================================================
// ARCHIWUM TAKSONOMII - klucz cache i normalizacja parametryzacji
// ==========================================================================

describe("archiwum taksonomii: co trafia do klucza zapytania i cache'u", () => {
  it("domyślnie pyta o pierwszą stronę rozmiaru archiwum, sortowaną od najnowszych", () => {
    expect(taxonomyArchiveQueryOptions("category", "analizy").queryKey).toEqual([
      "public",
      "archive",
      "category",
      "analizy",
      { page: 1, pageSize: ARCHIVE_PAGE_SIZE, sort: "newest" },
    ]);
  });

  it("rodzaj taksonomii rozdziela klucze: kategoria i tag o tym samym slugu to dwa zbiory", () => {
    const kat = taxonomyArchiveQueryOptions("category", "nato").queryKey;
    const tag = taxonomyArchiveQueryOptions("tag", "nato").queryKey;
    expect(kat).not.toEqual(tag);
  });

  it("dolne widełki: strona 0 i rozmiar 0 nie mogą zejść poniżej jedynki", () => {
    expect(
      taxonomyArchiveQueryOptions("category", "analizy", { page: 0, pageSize: 0 }).queryKey[4],
    ).toEqual({ page: 1, pageSize: 1, sort: "newest" });
  });

  it("górne widełki rozmiaru strony to 200 - większe żądanie jest ścinane", () => {
    expect(
      taxonomyArchiveQueryOptions("category", "analizy", { page: 2, pageSize: 5000 }).queryKey[4],
    ).toEqual({ page: 2, pageSize: 200, sort: "newest" });
  });

  it("każde sortowanie ma własny wpis cache (inaczej strona 1 „newest” serwowałaby „popular”)", async () => {
    for (const sort of ["newest", "oldest", "popular"] as const) {
      planujArchiwum({ kind: "category" });
      await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy", { sort }));
    }
    expect(h.cache.map((c) => c.key)).toEqual([
      "public:archive:category:analizy:1:60:newest",
      "public:archive:category:analizy:1:60:oldest",
      "public:archive:category:analizy:1:60:popular",
    ]);
  });

  it("klucz cache niesie pełną parametryzację strony wyników, a TTL to jedna minuta", async () => {
    planujArchiwum({ kind: "tag" });
    await klient().fetchQuery(
      taxonomyArchiveQueryOptions("tag", "nato", { page: 3, pageSize: 20, sort: "oldest" }),
    );
    expect(h.cache).toEqual([{ key: "public:archive:tag:nato:3:20:oldest", ttl: 60_000 }]);
  });

  it("dane archiwum uznajemy za świeże przez dwie minuty", () => {
    expect(taxonomyArchiveQueryOptions("category", "analizy").staleTime).toBe(2 * 60_000);
  });

  it("STAN FAKTYCZNY: strona ułamkowa NIE jest zaokrąglana - clamp to tylko Math.max(1, …)", () => {
    // Trasy `/category/$slug` i `/tag/$slug` robią `Math.floor` w `validateSearch`,
    // więc do fabryki ułamek nie dojdzie z adresu. Przypinam fakt, bo `pageSize`
    // pochodzi z ustawień czytania (`posts_per_page`) i tej bariery już nie ma.
    expect(taxonomyArchiveQueryOptions("category", "analizy", { page: 2.5 }).queryKey[4]).toEqual({
      page: 2.5,
      pageSize: ARCHIVE_PAGE_SIZE,
      sort: "newest",
    });
  });
});

// ==========================================================================
// ARCHIWUM TAKSONOMII - kształt łańcucha
// ==========================================================================

describe("archiwum kategorii: kształt zapytań", () => {
  it("kategorię rozpoznaje po slugu i czyta z niej opis w obu językach", async () => {
    planujArchiwum({ kind: "category" });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const kat = lancuch("categories");
    expect(kat.argsOf("select")?.[0]).toBe(
      "id, slug, name_pl, name_en, description_pl, description_en, featured_template_id",
    );
    expect(kat.argsOf("eq")).toEqual(["slug", "analizy"]);
    expect(kat.has("maybeSingle")).toBe(true);
    expect(wynik?.taxonomy.name_pl).toBe("Analizy");
    expect(wynik?.taxonomy.name_en).toBe("Analyses");
    expect(wynik?.taxonomy.description_en).toBe("opis en");
  });

  it("pivot kategorii filtruje po category_id i oddaje same identyfikatory wpisów", async () => {
    planujArchiwum({ kind: "category" });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const pivot = lancuch("post_categories");
    expect(pivot.argsOf("select")?.[0]).toBe("post_id");
    expect(pivot.argsOf("eq")).toEqual(["category_id", WIERSZ_KATEGORII.id]);
  });

  it("lista wpisów bierze tylko opublikowane i nieusunięte, z dokładnym licznikiem", async () => {
    planujArchiwum({ kind: "category", wpisy: okZLicznikiem([wpis("p1")], 137) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const posty = lancuch("posts");
    expect(posty.argsOf("in")).toEqual(["id", ["p1"]]);
    expect(posty.argsOf("eq")).toEqual(["status", "published"]);
    expect(posty.argsOf("is")).toEqual(["deleted_at", null]);
    expect(posty.argsOf("select")?.[1]).toEqual({ count: "exact" });
    expect(wynik?.total).toBe(137);
  });

  it("kolumny listy niosą oznaczenie komercyjne - bez nich archiwum ukrywa reklamę", async () => {
    planujArchiwum({ kind: "category" });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const kolumny = lancuch("posts").argsOf("select")?.[0];
    expect(typeof kolumny).toBe("string");
    expect(String(kolumny)).toContain(SPONSORED_LIST_COLS);
    expect(String(kolumny)).toContain("parent_page_id");
    expect(String(kolumny)).toContain("published_at");
  });

  it("brak licznika z bazy daje zero, a nie długość pobranej strony", async () => {
    planujArchiwum({ kind: "category", wpisy: { data: [wpis("p1")], error: null, count: null } });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.total).toBe(0);
    expect(wynik?.posts).toHaveLength(1);
  });

  it("null w miejscu wierszy daje pustą listę, nie wyjątek", async () => {
    planujArchiwum({ kind: "category", wpisy: { data: null, error: null, count: 5 } });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts).toEqual([]);
    expect(wynik?.total).toBe(5);
  });
});

describe("archiwum tagu: kształt zapytań i jedna nazwa na oba języki", () => {
  it("tag ma jedną nazwę, więc trafia do obu wariantów językowych i nie ma opisu", async () => {
    planujArchiwum({ kind: "tag" });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("tag", "nato"));
    expect(lancuch("tags").argsOf("select")?.[0]).toBe("id, slug, name, featured_template_id");
    expect(wynik?.taxonomy.name_pl).toBe("NATO");
    expect(wynik?.taxonomy.name_en).toBe("NATO");
    expect(wynik?.taxonomy.description_pl).toBeNull();
    expect(wynik?.taxonomy.description_en).toBeNull();
  });

  it("pivot tagu filtruje po tag_id, a nie po category_id", async () => {
    planujArchiwum({ kind: "tag" });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("tag", "nato"));
    expect(lancuch("post_tags").argsOf("eq")).toEqual(["tag_id", WIERSZ_TAGU.id]);
    expect(baza().chainsFor("post_categories")).toHaveLength(0);
  });
});

describe("archiwum taksonomii: pustka to nie awaria", () => {
  it("PUSTKA: nieznany slug kategorii oddaje null i NIE pyta o wpisy", async () => {
    planujArchiwum({ kind: "category", taksonomia: ok(null) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "widmo"));
    expect(wynik).toBeNull();
    expect(baza().chainsFor("posts")).toHaveLength(0);
    expect(baza().chainsFor("post_categories")).toHaveLength(0);
  });

  it("BŁĄD: odmowa bazy na kategorii jest wyrzucana w górę, nie zamieniana na null", async () => {
    planujArchiwum({ kind: "category", taksonomia: fail("odmowa odczytu kategorii", "42501") });
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toThrow("odmowa odczytu kategorii");
  });

  it("PUSTKA: nieznany slug tagu oddaje null", async () => {
    planujArchiwum({ kind: "tag", taksonomia: ok(null) });
    expect(await klient().fetchQuery(taxonomyArchiveQueryOptions("tag", "widmo"))).toBeNull();
  });

  it("BŁĄD: odmowa bazy na tagu jest wyrzucana w górę", async () => {
    planujArchiwum({ kind: "tag", taksonomia: fail("odmowa odczytu tagu") });
    await expect(klient().fetchQuery(taxonomyArchiveQueryOptions("tag", "nato"))).rejects.toThrow(
      "odmowa odczytu tagu",
    );
  });

  it("PUSTKA: taksonomia bez ani jednego wpisu oddaje pustą listę i NIE pyta o tabelę wpisów", async () => {
    planujArchiwum({ kind: "category", pivot: ok([]) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts).toEqual([]);
    expect(wynik?.total).toBe(0);
    expect(wynik?.taxonomy.slug).toBe("analizy");
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("PUSTKA: null z pivotu jest traktowany jak brak przypisań", async () => {
    planujArchiwum({ kind: "category", pivot: ok(null) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts).toEqual([]);
    expect(wynik?.total).toBe(0);
  });

  it("BŁĄD: odmowa na pivocie jest wyrzucana, a nie pokazywana jako archiwum bez treści", async () => {
    planujArchiwum({ kind: "category", pivot: fail("odmowa odczytu przypisań") });
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toThrow("odmowa odczytu przypisań");
  });

  it("BŁĄD: odmowa na liście wpisów jest wyrzucana, mimo że taksonomia się rozwiązała", async () => {
    planujArchiwum({ kind: "category", wpisy: fail("odmowa odczytu wpisów") });
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toThrow("odmowa odczytu wpisów");
  });
});

// ==========================================================================
// SORTOWANIE I OKNO STRONY
// ==========================================================================

describe("archiwum taksonomii: kolejność i kierunek ogniw .order()", () => {
  async function ogniwaSortowania(sort: "newest" | "oldest" | "popular") {
    planujArchiwum({ kind: "category" });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy", { sort }));
    return ogniwa(lancuch("posts"), "order");
  }

  it("„najnowsze” to jedno ogniwo: published_at malejąco", async () => {
    expect(await ogniwaSortowania("newest")).toEqual([["published_at", { ascending: false }]]);
  });

  it("„najstarsze” odwraca kierunek tej samej kolumny", async () => {
    expect(await ogniwaSortowania("oldest")).toEqual([["published_at", { ascending: true }]]);
  });

  it("„popularne” MUSI mieć drugie ogniwo rozstrzygające remisy - inaczej paginacja gubi wpisy", async () => {
    expect(await ogniwaSortowania("popular")).toEqual([
      ["views_count", { ascending: false }],
      ["published_at", { ascending: false }],
    ]);
  });
});

describe("archiwum taksonomii: dokładne okno strony", () => {
  async function okno(page: number, pageSize: number, wpisy?: SupabaseResult) {
    planujArchiwum({ kind: "category", wpisy });
    const wynik = await klient().fetchQuery(
      taxonomyArchiveQueryOptions("category", "analizy", { page, pageSize }),
    );
    return { range: lancuch("posts").argsOf("range"), wynik };
  }

  it("pierwsza strona to wiersze 0..pageSize-1", async () => {
    expect((await okno(1, 60)).range).toEqual([0, 59]);
  });

  it("strona w środku przesuwa okno o pełne strony, bez zakładki i bez dziury", async () => {
    expect((await okno(3, 20)).range).toEqual([40, 59]);
  });

  it("ZA OSTATNIĄ STRONĄ: okno wychodzi poza zbiór, lista jest pusta, a licznik PRAWDZIWY", async () => {
    const { range, wynik } = await okno(100, 60, okZLicznikiem([], 3));
    expect(range).toEqual([5940, 5999]);
    expect(wynik?.posts).toEqual([]);
    // Gdyby `total` liczył się z długości strony, interfejs ogłosiłby „brak
    // wyników" dla archiwum, które ma trzy wpisy na stronie pierwszej.
    expect(wynik?.total).toBe(3);
    expect(wynik?.page).toBe(100);
  });

  it("rozmiar strony 1 daje jednoelementowe okno", async () => {
    expect((await okno(5, 1)).range).toEqual([4, 4]);
  });
});

// ==========================================================================
// SEKCJA WYRÓŻNIONA
// ==========================================================================

describe("sekcja wyróżniona archiwum", () => {
  const KATEGORIA_Z_SZABLONEM = { ...WIERSZ_KATEGORII, featured_template_id: "szablon-1" };

  it("brak szablonu w taksonomii oznacza ZERO zapytań o szablony", async () => {
    planujArchiwum({ kind: "category" });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.taxonomy.featured_section).toBeNull();
    expect(baza().chainsFor("builder_templates")).toHaveLength(0);
  });

  it("szablon jest czytany po id i oddaje sekcję do renderu", async () => {
    const sekcja = { kind: "section", id: "s1", children: [] };
    planujArchiwum({
      kind: "category",
      taksonomia: ok(KATEGORIA_Z_SZABLONEM),
      szablon: ok({ data: sekcja }),
    });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const szablon = lancuch("builder_templates");
    expect(szablon.argsOf("select")?.[0]).toBe("data");
    expect(szablon.argsOf("eq")).toEqual(["id", "szablon-1"]);
    expect(szablon.has("maybeSingle")).toBe(true);
    expect(wynik?.taxonomy.featured_section).toEqual(sekcja);
    expect(wynik?.taxonomy.featured_template_id).toBe("szablon-1");
  });

  it("dokument innego rodzaju niż „section” nie jest wpuszczany do renderu archiwum", async () => {
    planujArchiwum({
      kind: "category",
      taksonomia: ok(KATEGORIA_Z_SZABLONEM),
      szablon: ok({ data: { kind: "row", id: "r1" } }),
    });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.taxonomy.featured_section).toBeNull();
  });

  it("dokument, który nie jest obiektem, też jest odrzucany", async () => {
    planujArchiwum({
      kind: "category",
      taksonomia: ok(KATEGORIA_Z_SZABLONEM),
      szablon: ok({ data: "to nie jest sekcja" }),
    });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.taxonomy.featured_section).toBeNull();
  });

  it("PUSTKA: usunięty szablon (brak wiersza) daje archiwum bez sekcji wyróżnionej", async () => {
    planujArchiwum({ kind: "category", taksonomia: ok(KATEGORIA_Z_SZABLONEM), szablon: ok(null) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.taxonomy.featured_section).toBeNull();
  });

  it("błąd odczytu jest zgłaszany: odmowa odczytu builder_templates", async () => {
    planujArchiwum({
      kind: "category",
      taksonomia: ok(KATEGORIA_Z_SZABLONEM),
      szablon: fail("odmowa odczytu builder_templates", "42501"),
    });
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toMatchObject({ message: "odmowa odczytu builder_templates" });
  });

  it("AWARIA szablonu wyróżnionego POWINNA być odróżnialna od „operator nic nie ustawił”", async () => {
    planujArchiwum({
      kind: "category",
      taksonomia: ok(KATEGORIA_Z_SZABLONEM),
      szablon: fail("odmowa odczytu builder_templates", "42501"),
    });
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toThrow("odmowa odczytu builder_templates");
  });
});

// ==========================================================================
// ADRESY WPISÓW - page_full_paths i fallback per-id
// ==========================================================================

describe("adresy wpisów w archiwum: batch page_full_paths", () => {
  it("ścieżki rodziców idą JEDNYM wywołaniem, po nazwie argumentu _page_ids", async () => {
    planujArchiwum({ kind: "category", wpisy: okZLicznikiem([wpis("p1")], 1) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const call = wywolanie("page_full_paths");
    expect(call.keys()).toEqual(["_page_ids"]);
    expect(call.arg("_page_ids")).toEqual([STRONA_RODZIC]);
    expect(wynik?.posts[0]?.href).toBe(`/${SCIEZKA_RODZICA}/slug-p1`);
  });

  it("wpisy pod tym samym rodzicem nie mnożą wywołań - identyfikatory są deduplikowane", async () => {
    planujArchiwum({
      kind: "category",
      pivot: ok([{ post_id: "p1" }, { post_id: "p2" }, { post_id: "p3" }]),
      wpisy: okZLicznikiem([wpis("p1"), wpis("p2"), wpis("p3")], 3),
    });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(funkcje().callsFor("page_full_paths")).toHaveLength(1);
    expect(wywolanie("page_full_paths").arg("_page_ids")).toEqual([STRONA_RODZIC]);
  });

  it("dwóch różnych rodziców trafia do jednego wywołania i do dwóch różnych adresów", async () => {
    planujArchiwum({
      kind: "category",
      pivot: ok([{ post_id: "p1" }, { post_id: "p2" }]),
      wpisy: okZLicznikiem([wpis("p1"), wpis("p2", { parent_page_id: "str-inna" })], 2),
      sciezki: ok([
        { page_id: STRONA_RODZIC, full_path: SCIEZKA_RODZICA },
        { page_id: "str-inna", full_path: "raporty" },
      ]),
    });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts.map((p) => p.href)).toEqual([
      `/${SCIEZKA_RODZICA}/slug-p1`,
      "/raporty/slug-p2",
    ]);
  });

  it("rodzic bez ścieżki w odpowiedzi dostaje historyczny prefiks /blog", async () => {
    planujArchiwum({ kind: "category", sciezki: ok([]) });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts[0]?.href).toBe("/blog/slug-p1");
  });

  it("wiersz o niepoprawnym kształcie jest pomijany, a nie wstawiany do adresu", async () => {
    planujArchiwum({
      kind: "category",
      sciezki: ok([
        { page_id: 42, full_path: SCIEZKA_RODZICA },
        { page_id: STRONA_RODZIC, full_path: null },
      ]),
    });
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts[0]?.href).toBe("/blog/slug-p1");
  });

  it("PUSTA lista wpisów w ogóle nie pyta o ścieżki rodziców", async () => {
    planujArchiwum({ kind: "category", wpisy: okZLicznikiem([], 0) });
    await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(funkcje().names()).toEqual([]);
  });
});

describe("adresy wpisów w archiwum: fallback per-id", () => {
  it("BŁĄD batcha przełącza na page_full_path per identyfikator (nazwa argumentu _page_id)", async () => {
    planujArchiwum({
      kind: "category",
      pivot: ok([{ post_id: "p1" }, { post_id: "p2" }]),
      wpisy: okZLicznikiem([wpis("p1"), wpis("p2", { parent_page_id: "str-inna" })], 2),
      sciezki: fail("function page_full_paths does not exist", "42883"),
    });
    funkcje().setResponse("page_full_path", (call) =>
      ok(call.arg("_page_id") === STRONA_RODZIC ? SCIEZKA_RODZICA : "raporty"),
    );
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    const perId = funkcje().callsFor("page_full_path");
    expect(perId).toHaveLength(2);
    expect(perId.map((c) => c.keys())).toEqual([["_page_id"], ["_page_id"]]);
    expect(wynik?.posts.map((p) => p.href)).toEqual([
      `/${SCIEZKA_RODZICA}/slug-p1`,
      "/raporty/slug-p2",
    ]);
  });

  it("odpowiedź batcha, która nie jest tablicą, też uruchamia fallback per-id", async () => {
    planujArchiwum({ kind: "category", sciezki: ok(null) });
    funkcje().setResponse("page_full_path", ok(SCIEZKA_RODZICA));
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(funkcje().callsFor("page_full_path")).toHaveLength(1);
    expect(wynik?.posts[0]?.href).toBe(`/${SCIEZKA_RODZICA}/slug-p1`);
  });

  it("fallback zwracający coś innego niż napis nie trafia do adresu", async () => {
    planujArchiwum({ kind: "category", sciezki: ok("nie tablica") });
    funkcje().setResponse("page_full_path", ok(null));
    const wynik = await klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy"));
    expect(wynik?.posts[0]?.href).toBe("/blog/slug-p1");
  });

  it("błąd odczytu jest zgłaszany: odmowa page_full_paths", async () => {
    planujArchiwum({ kind: "category", sciezki: fail("odmowa page_full_paths") });
    funkcje().setResponse("page_full_path", fail("odmowa page_full_path"));
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toMatchObject({ message: "odmowa page_full_path" });
  });

  it("AWARIA rezolucji ścieżek POWINNA być odróżnialna od rodzica o ścieżce „blog”", async () => {
    planujArchiwum({ kind: "category", sciezki: fail("odmowa page_full_paths") });
    funkcje().setResponse("page_full_path", fail("odmowa page_full_path"));
    await expect(
      klient().fetchQuery(taxonomyArchiveQueryOptions("category", "analizy")),
    ).rejects.toMatchObject({ message: "odmowa page_full_path" });
  });
});

// ==========================================================================
// BRAMKA WYSZUKIWANIA
// ==========================================================================

describe("searchEnabled: kiedy warto w ogóle uderzyć w bazę", () => {
  it("pusta fraza bez filtrów NIE uruchamia wyszukiwania (inaczej pokazalibyśmy całe archiwum)", () => {
    expect(searchEnabled({ q: "" })).toBe(false);
  });

  it("jeden znak to za mało dla indeksu pełnotekstowego", () => {
    expect(searchEnabled({ q: "a" })).toBe(false);
  });

  it("dwa znaki wystarczają", () => {
    expect(searchEnabled({ q: "ue" })).toBe(true);
  });

  it("same białe znaki nie są frazą", () => {
    expect(searchEnabled({ q: "   " })).toBe(false);
  });

  it("fraza w cudzysłowie po obcięciu białych znaków nadal liczy się jako fraza", () => {
    expect(searchEnabled({ q: "  ue  " })).toBe(true);
  });

  const filtry: ReadonlyArray<{ nazwa: string; filtr: Partial<SearchFilters> }> = [
    { nazwa: "autor", filtr: { authorId: "aut-1" } },
    { nazwa: "data od", filtr: { dateFrom: "2026-01-01" } },
    { nazwa: "data do", filtr: { dateTo: "2026-12-31" } },
    { nazwa: "legacy kategoria", filtr: { categoryId: "kat-1" } },
    { nazwa: "format", filtr: { format: "video" } },
    { nazwa: "język", filtr: { lang: "en" } },
    { nazwa: "dostępność", filtr: { access: "paid" } },
    { nazwa: "legacy termy", filtr: { terms: ["t-1"] } },
    { nazwa: "grupa termów", filtr: { termGroups: { region: ["r-1"] } } },
  ];

  for (const { nazwa, filtr } of filtry) {
    it(`przeglądanie bez frazy działa, gdy aktywny jest filtr: ${nazwa}`, () => {
      expect(searchEnabled({ q: "", ...filtr })).toBe(true);
    });
  }

  it("FALSYWE, ALE NIEZNACZĄCE: puste tablice termów nie są filtrem", () => {
    expect(searchEnabled({ q: "", terms: [] })).toBe(false);
    expect(searchEnabled({ q: "", termGroups: {} })).toBe(false);
    expect(searchEnabled({ q: "", termGroups: { region: [] } })).toBe(false);
  });

  it("FALSYWE I ZJADANE: pusty napis w filtrze pojedynczej wartości też nie otwiera bramki", () => {
    // `!!""` jest fałszem, więc `access: ""` i `format: ""` nie są filtrem.
    // Dla tych kolumn pusty napis nie ma znaczenia domenowego (dozwolone
    // wartości to public/members/paid i standard/video/audio/gallery), więc
    // przypinam to jako fakt kontraktu, nie jako defekt.
    expect(searchEnabled({ q: "", access: "", format: "", categoryId: "" })).toBe(false);
  });
});

// ==========================================================================
// WYSZUKIWANIE - NAZWY ARGUMENTÓW RPC
// ==========================================================================

describe("wyszukiwanie: nazwy argumentów RPC (jedyne miejsce, gdzie literówkę widać)", () => {
  async function uruchom(filters: SearchFilters, limit?: number, browse?: boolean) {
    planujWyszukiwanie();
    const opts =
      limit === undefined
        ? searchQueryOptions(filters, undefined, browse ? { browse: true } : undefined)
        : searchQueryOptions(filters, limit, browse ? { browse: true } : undefined);
    return klient().fetchQuery(opts);
  }

  it("komplet nazw argumentów search_posts jest stały - żaden filtr nie może wypaść", async () => {
    await uruchom({ q: "unia" });
    expect(wywolanie("search_posts").keys().sort()).toEqual(
      [
        "_access",
        "_author",
        "_category",
        "_date_from",
        "_date_to",
        "_format",
        "_in",
        "_lang",
        "_limit",
        "_match",
        "_q",
        "_sort",
        "_term_groups",
        "_terms",
      ].sort(),
    );
  });

  it("FASETY liczą się z CAŁEGO zbioru: search_facets nie dostaje ani _limit, ani _sort", async () => {
    await uruchom({ q: "unia" });
    const fasety = wywolanie("search_facets");
    expect(fasety.has("_limit")).toBe(false);
    expect(fasety.has("_sort")).toBe(false);
    expect(fasety.arg("_q")).toBe("unia");
  });

  it("oba RPC dzielą identyczny zestaw filtrów", async () => {
    await uruchom({
      q: "unia",
      authorId: "aut-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
      categoryId: "kat-1",
      format: "video",
      lang: "en",
      access: "paid",
    });
    const posts = wywolanie("search_posts");
    const facets = wywolanie("search_facets");
    for (const klucz of [
      "_q",
      "_author",
      "_date_from",
      "_date_to",
      "_category",
      "_format",
      "_lang",
      "_access",
    ]) {
      expect(facets.arg(klucz)).toEqual(posts.arg(klucz));
    }
  });

  it("data „do” jest domykana do końca doby - wpis z godziny 18:00 nie wypada z zakresu", async () => {
    await uruchom({ q: "unia", dateTo: "2026-06-30" });
    expect(wywolanie("search_posts").arg("_date_to")).toBe("2026-06-30T23:59:59Z");
  });

  it("brak daty „do” zostawia argument nieustawiony, a nie napis z sufiksem", async () => {
    await uruchom({ q: "unia" });
    expect(wywolanie("search_posts").arg("_date_to")).toBeUndefined();
  });

  it("fraza krótsza niż dwa znaki NIE jedzie do bazy, choć filtr jedzie", async () => {
    await uruchom({ q: "u", authorId: "aut-1" });
    const call = wywolanie("search_posts");
    expect(call.arg("_q")).toBeUndefined();
    expect(call.arg("_author")).toBe("aut-1");
  });

  it("fraza jest obcinana z białych znaków przed wysłaniem", async () => {
    await uruchom({ q: "  unia europejska  " });
    expect(wywolanie("search_posts").arg("_q")).toBe("unia europejska");
  });

  it("legacy termy jadą POSORTOWANE - kolejność zaznaczeń nie może mnożyć wpisów cache", async () => {
    await uruchom({ q: "unia", terms: ["z-term", "a-term", "m-term"] });
    expect(wywolanie("search_posts").arg("_terms")).toEqual(["a-term", "m-term", "z-term"]);
  });

  it("pusta tablica termów daje BRAK argumentu, nie pustą tablicę (inaczej serwer filtrowałby do zera)", async () => {
    await uruchom({ q: "unia", terms: [] });
    expect(wywolanie("search_posts").arg("_terms")).toBeUndefined();
  });

  it("grupy termów jadą jako CSV per wymiar, w stałej kolejności wymiarów", async () => {
    await uruchom({
      q: "unia",
      termGroups: { topic: ["t-2", "t-1"], category: ["c-1"], region: ["r-1"] },
    });
    const grupy = wywolanie("search_posts").arg("_term_groups");
    expect(grupy).toEqual({ category: "c-1", region: "r-1", topic: "t-1,t-2" });
    // Kolejność kluczy idzie z TAXONOMY_DIMS, nie z kolejności zaznaczeń.
    expect(Object.keys(grupy as Record<string, string>)).toEqual(["category", "region", "topic"]);
  });

  it("wszystkie wymiary taksonomii są obsługiwane przez normalizację grup", async () => {
    const wszystkie: SearchFilters["termGroups"] = {};
    for (const dim of TAXONOMY_DIMS) wszystkie[dim] = [`${dim}-1`];
    await uruchom({ q: "unia", termGroups: wszystkie });
    expect(Object.keys(wywolanie("search_posts").arg("_term_groups") as object)).toEqual([
      ...TAXONOMY_DIMS,
    ]);
  });

  it("grupy złożone tylko z pustych tablic dają BRAK argumentu", async () => {
    await uruchom({ q: "unia", termGroups: { topic: [], region: [] } });
    expect(wywolanie("search_posts").arg("_term_groups")).toBeUndefined();
  });

  it("tryb dopasowania „all” jest domyślny, więc nie jedzie do starszego backendu", async () => {
    await uruchom({ q: "unia", match: "all" });
    expect(wywolanie("search_posts").arg("_match")).toBeUndefined();
  });

  it("tryby nie-domyślne dopasowania jadą jawnie", async () => {
    for (const match of ["any", "phrase"] as const) {
      funkcje().reset();
      await uruchom({ q: "unia", match });
      expect(wywolanie("search_posts").arg("_match")).toBe(match);
    }
  });

  it("zakres „all” jest domyślny, „title” jedzie jawnie", async () => {
    await uruchom({ q: "unia", scope: "all" });
    expect(wywolanie("search_posts").arg("_in")).toBeUndefined();
    funkcje().reset();
    await uruchom({ q: "unia", scope: "title" });
    expect(wywolanie("search_posts").arg("_in")).toBe("title");
  });

  it("domyślne sortowanie to trafność", async () => {
    await uruchom({ q: "unia" });
    expect(wywolanie("search_posts").arg("_sort")).toBe("relevance");
  });

  it("wybrane sortowanie jedzie 1:1 do RPC", async () => {
    for (const sort of ["newest", "popular"] as const) {
      funkcje().reset();
      await uruchom({ q: "unia", sort });
      expect(wywolanie("search_posts").arg("_sort")).toBe(sort);
    }
  });

  it("okno „doładuj więcej” rośnie przez _limit, z sufitem SEARCH_LIMIT_MAX", async () => {
    await uruchom({ q: "unia" });
    expect(wywolanie("search_posts").arg("_limit")).toBe(SEARCH_PAGE_SIZE);
    funkcje().reset();
    await uruchom({ q: "unia" }, 5000);
    expect(wywolanie("search_posts").arg("_limit")).toBe(SEARCH_LIMIT_MAX);
  });

  it("STAN FAKTYCZNY: limit 0 nie ma dolnych widełek i zamawia zero wyników", async () => {
    // Przeciwieństwo `taxonomyArchiveQueryOptions`, gdzie `Math.max(1, …)`
    // pilnuje dolnej granicy. Trasy /search i /publications startują od
    // SEARCH_PAGE_SIZE i tylko rosną, więc zera nie da się dziś wywołać
    // z interfejsu - przypinam asymetrię jako fakt, nie jako defekt.
    await uruchom({ q: "unia" }, 0);
    expect(wywolanie("search_posts").arg("_limit")).toBe(0);
  });
});

// ==========================================================================
// WYSZUKIWANIE - KLUCZ, BRAMKA, KOLEJNOŚĆ WYWOŁAŃ
// ==========================================================================

describe("wyszukiwanie: klucz zapytania i bramka", () => {
  it("klucz normalizuje termy i grupy, więc dwie kolejności zaznaczeń dzielą jeden wpis cache", () => {
    const a = searchQueryOptions({
      q: "unia",
      terms: ["b", "a"],
      termGroups: { topic: ["t2", "t1"] },
    }).queryKey;
    const b = searchQueryOptions({
      q: "unia",
      terms: ["a", "b"],
      termGroups: { topic: ["t1", "t2"] },
    }).queryKey;
    expect(a).toEqual(b);
  });

  it("limit jest częścią klucza - większe okno to inny wpis cache", () => {
    const a = searchQueryOptions({ q: "unia" }, SEARCH_PAGE_SIZE).queryKey;
    const b = searchQueryOptions({ q: "unia" }, SEARCH_PAGE_SIZE * 2).queryKey;
    expect(a).not.toEqual(b);
    expect(a[3]).toEqual({ limit: SEARCH_PAGE_SIZE });
  });

  it("tryb biblioteki i tryb /search dzielą klucz dla tych samych filtrów", () => {
    const wSzukajce = searchQueryOptions({ q: "unia" }).queryKey;
    const wBibliotece = searchQueryOptions({ q: "unia" }, SEARCH_PAGE_SIZE, {
      browse: true,
    }).queryKey;
    expect(wSzukajce).toEqual(wBibliotece);
  });

  it("puste wejście na /search nie strzela zapytaniem", () => {
    expect(searchQueryOptions(PUSTE_FILTRY).enabled).toBe(false);
  });

  it("tryb biblioteki listuje najnowsze także bez frazy i bez filtrów", () => {
    expect(searchQueryOptions(PUSTE_FILTRY, SEARCH_PAGE_SIZE, { browse: true }).enabled).toBe(true);
  });

  it("jawne browse:false wraca pod bramkę searchEnabled", () => {
    expect(searchQueryOptions(PUSTE_FILTRY, SEARCH_PAGE_SIZE, { browse: false }).enabled).toBe(
      false,
    );
    expect(searchQueryOptions({ q: "unia" }, SEARCH_PAGE_SIZE, { browse: false }).enabled).toBe(
      true,
    );
  });

  it("wyniki wyszukiwania starzeją się po 30 sekundach", () => {
    expect(searchQueryOptions({ q: "unia" }).staleTime).toBe(30_000);
  });

  it("trafienia i fasety lecą JEDNĄ falą, telemetria dopiero po wynikach", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1")]),
      oznaczenia: ok([
        { id: "p1", is_sponsored: false, sponsored_kind: null, sponsored_affiliate: null },
      ]),
    });
    await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(funkcje().names()).toEqual([
      "search_posts",
      "search_facets",
      "page_full_paths",
      "log_search_query",
    ]);
  });
});

// ==========================================================================
// WYSZUKIWANIE - PUSTKA, BŁĄD, KSZTAŁT WYNIKU
// ==========================================================================

describe("wyszukiwanie: pustka to nie awaria", () => {
  it("PUSTKA: brak trafień oddaje zerowy wynik i nie doczytuje niczego więcej", async () => {
    planujWyszukiwanie({ trafienia: ok([]), fasety: ok([]) });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "zzzz" }));
    expect(wynik).toEqual({ posts: [], facets: [], total: 0, fuzzy: false });
    // Bez trafień nie ma czego oznaczać ani czego adresować.
    expect(baza().chainsFor("posts")).toHaveLength(0);
    expect(funkcje().callsFor("page_full_paths")).toHaveLength(0);
  });

  it("PUSTKA: null zamiast tablicy trafień jest traktowany jak brak wyników", async () => {
    planujWyszukiwanie({ trafienia: ok(null), fasety: ok(null) });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "zzzz" }));
    expect(wynik.posts).toEqual([]);
    expect(wynik.facets).toEqual([]);
    expect(wynik.total).toBe(0);
  });

  it("BŁĄD: odmowa search_posts jest wyrzucana, a nie zamieniana na „nic nie znaleziono”", async () => {
    planujWyszukiwanie({ trafienia: fail("odmowa search_posts", "42501") });
    await expect(klient().fetchQuery(searchQueryOptions({ q: "unia" }))).rejects.toThrow(
      "odmowa search_posts",
    );
  });

  it("BŁĄD: odmowa search_facets też wywraca zapytanie, choć trafienia się udały", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1")]),
      fasety: fail("odmowa search_facets"),
    });
    await expect(klient().fetchQuery(searchQueryOptions({ q: "unia" }))).rejects.toThrow(
      "odmowa search_facets",
    );
  });
});

describe("wyszukiwanie: kształt wyniku", () => {
  it("liczność zbioru bierze się z okna total_count, nie z długości pobranej strony", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1", { total_count: 412 }), trafienie("p2", { total_count: 412 })]),
      oznaczenia: ok([]),
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.total).toBe(412);
    expect(wynik.posts).toHaveLength(2);
  });

  it("brak total_count w wierszu spada na długość okna", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1", { total_count: null })]),
      oznaczenia: ok([]),
    });
    expect((await klient().fetchQuery(searchQueryOptions({ q: "unia" }))).total).toBe(1);
  });

  it("flaga fallbacku trigramowego jedzie do interfejsu (to komunikat „szukaliśmy inaczej”)", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1", { fuzzy: true })]), oznaczenia: ok([]) });
    expect((await klient().fetchQuery(searchQueryOptions({ q: "uniia" }))).fuzzy).toBe(true);
  });

  it("kolumny techniczne rankingu nie wyciekają do pozycji listy", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    const pozycja = wynik.posts[0];
    expect(pozycja).toBeDefined();
    expect(Object.keys(pozycja ?? {})).not.toContain("rank");
    expect(Object.keys(pozycja ?? {})).not.toContain("total_count");
    expect(Object.keys(pozycja ?? {})).not.toContain("fuzzy");
    // …a pola premium karty wyników zostają.
    expect(pozycja?.post_format).toBe("standard");
    expect(pozycja?.access_mode).toBe("public");
  });

  it("fasety pełne i fasety z nullami mapują się na jeden kształt (etykieta spada na slug)", async () => {
    planujWyszukiwanie({
      trafienia: ok([]),
      fasety: ok([
        {
          dim: "region",
          id: "r-1",
          slug: "polska",
          label_pl: "Polska",
          label_en: "Poland",
          parent_id: "r-0",
          cnt: 12,
        },
        {
          dim: "year",
          id: null,
          slug: "2026",
          label_pl: null,
          label_en: null,
          parent_id: null,
          cnt: null,
        },
      ]),
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.facets).toEqual([
      {
        dim: "region",
        id: "r-1",
        slug: "polska",
        label_pl: "Polska",
        label_en: "Poland",
        parentId: "r-0",
        count: 12,
      },
      {
        dim: "year",
        id: null,
        slug: "2026",
        label_pl: "2026",
        label_en: "2026",
        parentId: null,
        count: 0,
      },
    ]);
  });
});

// ==========================================================================
// WYSZUKIWANIE - WARSTWA SEMANTYCZNA
// ==========================================================================

describe("wyszukiwanie: kiedy dokładamy sygnał semantyczny", () => {
  it("fraza krótsza niż cztery znaki nie budzi warstwy semantycznej", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    await klient().fetchQuery(searchQueryOptions({ q: "uni" }));
    expect(h.semantyka).not.toHaveBeenCalled();
  });

  it("sortowanie inne niż trafność nie budzi warstwy semantycznej", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    await klient().fetchQuery(searchQueryOptions({ q: "unia", sort: "newest" }));
    expect(h.semantyka).not.toHaveBeenCalled();
  });

  it("dłuższa fraza w trybie trafności jedzie do server fn-a z obciętą frazą", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    await klient().fetchQuery(searchQueryOptions({ q: "  unia europejska  " }));
    expect(h.semantyka).toHaveBeenCalledWith({ data: { q: "unia europejska" } });
  });

  it("BŁĄD warstwy semantycznej degraduje do czystego FTS, a nie wywraca wyszukiwania", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1", { rank: 9 }), trafienie("p2", { rank: 1 })]),
      oznaczenia: ok([]),
    });
    h.semantyka.mockRejectedValue(new Error("bramka embeddingów niedostępna"));
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("blend przestawia kolejność, gdy podobieństwo semantyczne przewyższa różnicę rankingu", async () => {
    planujWyszukiwanie({
      trafienia: ok([
        trafienie("p1", { rank: 10, total_count: 2 }),
        trafienie("p2", { rank: 8, total_count: 2 }),
      ]),
      oznaczenia: ok([]),
      hits: [{ post_id: "p2", similarity: 1 }],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    // 0,75*1,0 + 0 = 0,75  <  0,75*0,8 + 0,25*1,0 = 0,85
    expect(wynik.posts.map((p) => p.id)).toEqual(["p2", "p1"]);
    // Blend zmienia TYLKO porządek - zbiór i liczność zostają.
    expect(wynik.total).toBe(2);
  });

  it("blend nie przestawia, gdy przewaga rankingu FTS jest większa niż sygnał semantyczny", async () => {
    planujWyszukiwanie({
      trafienia: ok([
        trafienie("p1", { rank: 10, total_count: 2 }),
        trafienie("p2", { rank: 5, total_count: 2 }),
      ]),
      oznaczenia: ok([]),
      hits: [{ post_id: "p2", similarity: 1 }],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("zerowe rankingi FTS oddają porządek wyłącznie podobieństwu semantycznemu", async () => {
    planujWyszukiwanie({
      trafienia: ok([
        trafienie("p1", { rank: null, total_count: 2 }),
        trafienie("p2", { rank: 0, total_count: 2 }),
      ]),
      oznaczenia: ok([]),
      hits: [{ post_id: "p2", similarity: 0.9 }],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("fallback trigramowy zostaje NIETKNIĘTY - tam ranking ma inną skalę", async () => {
    planujWyszukiwanie({
      trafienia: ok([
        trafienie("p1", { rank: 10, fuzzy: true, total_count: 2 }),
        trafienie("p2", { rank: 8, fuzzy: true, total_count: 2 }),
      ]),
      oznaczenia: ok([]),
      hits: [{ post_id: "p2", similarity: 1 }],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "uniia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("jedno trafienie nie ma czego przestawiać", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1", { rank: 1 })]),
      oznaczenia: ok([]),
      hits: [{ post_id: "p1", similarity: 1 }],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p1"]);
  });

  it("brak trafień semantycznych zostawia porządek FTS", async () => {
    planujWyszukiwanie({
      trafienia: ok([
        trafienie("p1", { rank: 1, total_count: 2 }),
        trafienie("p2", { rank: 9, total_count: 2 }),
      ]),
      oznaczenia: ok([]),
      hits: [],
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

// ==========================================================================
// WYSZUKIWANIE - OZNACZENIE KOMERCYJNE
// ==========================================================================

describe("wyszukiwanie: oznaczenie komercyjne pozycji listy", () => {
  it("flagi są doczytywane z tabeli wpisów po identyfikatorach z RPC", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1"), trafienie("p2")]),
      oznaczenia: ok([
        { id: "p1", is_sponsored: true, sponsored_kind: "advertorial", sponsored_affiliate: false },
      ]),
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    const chain = lancuch("posts");
    expect(chain.argsOf("select")?.[0]).toBe(`id, ${SPONSORED_LIST_COLS}`);
    expect(chain.argsOf("in")).toEqual(["id", ["p1", "p2"]]);
    expect(wynik.posts[0]?.is_sponsored).toBe(true);
    expect(wynik.posts[0]?.sponsored_kind).toBe("advertorial");
    expect(wynik.posts[0]?.sponsored_affiliate).toBe(false);
  });

  it("wpis, który zniknął między zapytaniami, dostaje null - nie ma go na liście czytelnika", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts[0]?.is_sponsored).toBeNull();
    expect(wynik.posts[0]?.sponsored_kind).toBeNull();
    expect(wynik.posts[0]?.sponsored_affiliate).toBeNull();
  });

  it("null zamiast tablicy flag też daje same nulle, bez wyjątku", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok(null) });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts[0]?.is_sponsored).toBeNull();
  });

  it("błąd odczytu jest zgłaszany: odmowa odczytu posts", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1")]),
      oznaczenia: fail("odmowa odczytu posts", "42501"),
    });
    await expect(klient().fetchQuery(searchQueryOptions({ q: "unia" }))).rejects.toMatchObject({
      message: "odmowa odczytu posts",
    });
  });

  it("AWARIA doczytania oznaczenia komercyjnego POWINNA być odróżnialna od materiału niesponsorowanego", async () => {
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1")]),
      oznaczenia: fail("odmowa odczytu posts", "42501"),
    });
    await expect(klient().fetchQuery(searchQueryOptions({ q: "unia" }))).rejects.toThrow(
      "odmowa odczytu posts",
    );
  });
});

// ==========================================================================
// WYSZUKIWANIE - TELEMETRIA
// ==========================================================================

describe("wyszukiwanie: telemetria fraz", () => {
  it("realna fraza jest logowana z nazwami argumentów, językiem runtime i licznością", async () => {
    h.jezyk = "en";
    planujWyszukiwanie({
      trafienia: ok([trafienie("p1", { total_count: 77 })]),
      oznaczenia: ok([]),
    });
    await klient().fetchQuery(searchQueryOptions({ q: "  unia  " }));
    const log = wywolanie("log_search_query");
    expect(log.keys().sort()).toEqual(["_lang", "_q", "_results"]);
    expect(log.arg("_q")).toBe("unia");
    expect(log.arg("_lang")).toBe("en");
    expect(log.arg("_results")).toBe(77);
  });

  it("czyste przeglądanie po filtrach NIE trafia do telemetrii fraz", async () => {
    planujWyszukiwanie({ trafienia: ok([]) });
    await klient().fetchQuery(
      searchQueryOptions({ q: "", authorId: "aut-1" }, SEARCH_PAGE_SIZE, { browse: true }),
    );
    expect(funkcje().callsFor("log_search_query")).toHaveLength(0);
  });

  it("jednoznakowa fraza też nie jest logowana", async () => {
    planujWyszukiwanie({ trafienia: ok([]) });
    await klient().fetchQuery(searchQueryOptions({ q: "u", authorId: "aut-1" }));
    expect(funkcje().callsFor("log_search_query")).toHaveLength(0);
  });

  it("awaria telemetrii nie może zabrać użytkownikowi wyników", async () => {
    planujWyszukiwanie({ trafienia: ok([trafienie("p1")]), oznaczenia: ok([]) });
    funkcje().setResponse("log_search_query", () => {
      throw new Error("funkcja log_search_query nie istnieje");
    });
    const wynik = await klient().fetchQuery(searchQueryOptions({ q: "unia" }));
    expect(wynik.posts).toHaveLength(1);
  });
});

// ==========================================================================
// PODPOWIEDZI
// ==========================================================================

describe("podpowiedzi pod polem frazy", () => {
  function podpowiedzi(q: string, limit?: number) {
    return limit === undefined
      ? searchAutosuggestQueryOptions(q)
      : searchAutosuggestQueryOptions(q, limit);
  }

  it("klucz niesie obciętą frazę i limit, a dane starzeją się po 30 sekundach", () => {
    const opts = podpowiedzi("  unia  ");
    expect(opts.queryKey).toEqual(["public", "search-autosuggest", "unia", { limit: 8 }]);
    expect(opts.staleTime).toBe(30_000);
  });

  it("bramka: jeden znak nie odpytuje bazy, dwa już tak", () => {
    expect(podpowiedzi("u").enabled).toBe(false);
    expect(podpowiedzi("  u  ").enabled).toBe(false);
    expect(podpowiedzi("ue").enabled).toBe(true);
  });

  it("RPC dostaje obciętą frazę i limit pod nazwami _q i _limit", async () => {
    funkcje().setResponse("search_autosuggest", ok([]));
    await klient().fetchQuery(podpowiedzi("  unia  ", 5));
    const call = wywolanie("search_autosuggest");
    expect(call.keys().sort()).toEqual(["_limit", "_q"]);
    expect(call.arg("_q")).toBe("unia");
    expect(call.arg("_limit")).toBe(5);
  });

  it("pełny wiersz i wiersz z nullami mapują się na jeden kształt pozycji", async () => {
    funkcje().setResponse(
      "search_autosuggest",
      ok([
        {
          kind: "post",
          id: "p-1",
          slug: "akt-o-uslugach",
          label_pl: "Akt o usługach",
          label_en: "Services Act",
          parent_page_id: STRONA_RODZIC,
          score: 0.87,
        },
        {
          kind: "author",
          id: null,
          slug: null,
          label_pl: null,
          label_en: null,
          parent_page_id: null,
          score: null,
        },
      ]),
    );
    const wynik = await klient().fetchQuery(podpowiedzi("unia"));
    expect(wynik).toEqual([
      {
        kind: "post",
        id: "p-1",
        slug: "akt-o-uslugach",
        label_pl: "Akt o usługach",
        label_en: "Services Act",
        parentPageId: STRONA_RODZIC,
        score: 0.87,
      },
      {
        kind: "author",
        id: null,
        slug: null,
        label_pl: "",
        label_en: "",
        parentPageId: null,
        score: 0,
      },
    ]);
  });

  it("PUSTKA: brak podpowiedzi dla frazy oddaje pustą listę", async () => {
    funkcje().setResponse("search_autosuggest", ok([]));
    expect(await klient().fetchQuery(podpowiedzi("zzzz"))).toEqual([]);
  });

  it("PUSTKA: null zamiast tablicy też jest pustą listą", async () => {
    funkcje().setResponse("search_autosuggest", ok(null));
    expect(await klient().fetchQuery(podpowiedzi("zzzz"))).toEqual([]);
  });

  it("błąd odczytu jest zgłaszany: function search_autosuggest does not exist", async () => {
    funkcje().setResponse("search_autosuggest", () => {
      throw new Error("function search_autosuggest does not exist");
    });
    await expect(klient().fetchQuery(podpowiedzi("unia"))).rejects.toMatchObject({
      message: "function search_autosuggest does not exist",
    });
  });

  it("błąd odczytu jest zgłaszany: odmowa search_autosuggest", async () => {
    funkcje().setResponse("search_autosuggest", fail("odmowa search_autosuggest", "42501"));
    await expect(klient().fetchQuery(podpowiedzi("unia"))).rejects.toMatchObject({
      message: "odmowa search_autosuggest",
    });
  });

  it("AWARIA podpowiedzi POWINNA być odróżnialna od „nic nie pasuje”", async () => {
    funkcje().setResponse("search_autosuggest", fail("odmowa search_autosuggest", "42501"));
    await expect(klient().fetchQuery(podpowiedzi("unia"))).rejects.toThrow(
      "odmowa search_autosuggest",
    );
  });
});

// ==========================================================================
// OSOBY I ORGANIZACJE
// ==========================================================================

describe("sekcja „osoby i organizacje”", () => {
  function osoby(q: string, limit?: number) {
    return limit === undefined
      ? searchPeopleOrgsQueryOptions(q)
      : searchPeopleOrgsQueryOptions(q, limit);
  }

  it("klucz niesie obciętą frazę i limit, a dane starzeją się po minucie", () => {
    const opts = osoby("  nato  ", 10);
    expect(opts.queryKey).toEqual(["public", "search-people-orgs", "nato", { limit: 10 }]);
    expect(opts.staleTime).toBe(60_000);
  });

  it("domyślny limit sekcji to 40", () => {
    expect(osoby("nato").queryKey[3]).toEqual({ limit: 40 });
  });

  it("sekcja NIE MA bramki na długość frazy - w przeciwieństwie do podpowiedzi", () => {
    // Dzięki temu /search bez frazy pokazuje przegląd osób i organizacji.
    expect(osoby("").enabled).toBeUndefined();
  });

  it("FALSYWE, ALE ZNACZĄCE: pusta fraza jedzie jako BRAK argumentu (przeglądanie), nie jako pusty napis", async () => {
    funkcje().setResponse("search_people_orgs", ok([]));
    await klient().fetchQuery(osoby("   "));
    const call = wywolanie("search_people_orgs");
    // `q.trim() || undefined` - pusty napis zamieniony na undefined, żeby
    // serwerowy DEFAULT NULL nie filtrował do zera.
    expect(call.arg("_q")).toBeUndefined();
    expect(call.arg("_limit")).toBe(40);
  });

  it("niepusta fraza jedzie obcięta", async () => {
    funkcje().setResponse("search_people_orgs", ok([]));
    await klient().fetchQuery(osoby("  nato  "));
    expect(wywolanie("search_people_orgs").arg("_q")).toBe("nato");
  });

  it("pełny wiersz i wiersz z nullami mapują się na jeden kształt karty", async () => {
    funkcje().setResponse(
      "search_people_orgs",
      ok([
        {
          kind: "organization",
          id: "o-1",
          slug: "nato",
          label_pl: "NATO",
          label_en: "NATO",
          sublabel_pl: "Sojusz",
          sublabel_en: "Alliance",
          avatar_url: null,
          logo_url: "https://cdn/nato.png",
          verified: true,
          post_count: 31,
        },
        {
          kind: null,
          id: "os-1",
          slug: null,
          label_pl: null,
          label_en: null,
          sublabel_pl: null,
          sublabel_en: null,
          avatar_url: null,
          logo_url: null,
          verified: null,
          post_count: null,
        },
      ]),
    );
    const wynik = await klient().fetchQuery(osoby("nato"));
    expect(wynik[0]).toEqual({
      kind: "organization",
      id: "o-1",
      slug: "nato",
      label_pl: "NATO",
      label_en: "NATO",
      sublabel_pl: "Sojusz",
      sublabel_en: "Alliance",
      avatarUrl: null,
      logoUrl: "https://cdn/nato.png",
      verified: true,
      postCount: 31,
    });
    // Brak rodzaju spada na osobę, brak licznika na zero, brak flagi na fałsz.
    expect(wynik[1]?.kind).toBe("person");
    expect(wynik[1]?.postCount).toBe(0);
    expect(wynik[1]?.verified).toBe(false);
    expect(wynik[1]?.label_pl).toBe("");
  });

  it("PUSTKA: brak osób i organizacji dla frazy oddaje pustą sekcję", async () => {
    funkcje().setResponse("search_people_orgs", ok([]));
    expect(await klient().fetchQuery(osoby("zzzz"))).toEqual([]);
  });

  it("PUSTKA: null zamiast tablicy też jest pustą sekcją", async () => {
    funkcje().setResponse("search_people_orgs", ok(null));
    expect(await klient().fetchQuery(osoby("zzzz"))).toEqual([]);
  });

  it("błąd odczytu jest zgłaszany: function search_people_orgs does not exist", async () => {
    funkcje().setResponse("search_people_orgs", () => {
      throw new Error("function search_people_orgs does not exist");
    });
    await expect(klient().fetchQuery(osoby("nato"))).rejects.toMatchObject({
      message: "function search_people_orgs does not exist",
    });
  });

  it("błąd odczytu jest zgłaszany: odmowa search_people_orgs", async () => {
    funkcje().setResponse("search_people_orgs", fail("odmowa search_people_orgs", "42501"));
    await expect(klient().fetchQuery(osoby("nato"))).rejects.toMatchObject({
      message: "odmowa search_people_orgs",
    });
  });

  it("AWARIA sekcji osób i organizacji POWINNA być odróżnialna od „nikogo takiego nie mamy”", async () => {
    funkcje().setResponse("search_people_orgs", fail("odmowa search_people_orgs", "42501"));
    await expect(klient().fetchQuery(osoby("nato"))).rejects.toThrow("odmowa search_people_orgs");
  });
});
