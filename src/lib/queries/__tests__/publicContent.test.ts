// TREŚĆ PUBLICZNA POD ADRESEM - co czytelnik dostaje, gdy baza odpowie inaczej
// niż szczęśliwie.
//
// CO TO DOWODZI. `src/lib/queries/public.ts` jest JEDYNYM czytnikiem treści dla
// trasy łapiącej `/$` (strony i wpisy pod dowolną ścieżką), dla strony głównej,
// dla listy i archiwum bloga oraz dla mapy strony. Nie renderuje niczego -
// decyduje, JAKIE zapytanie poleci, CO wróci przy odmowie bazy i CZEGO NIE
// zapyta wcale. Przypadki są nazwane po skutku dla czytelnika i dla danych:
//
//   * AWARIA NIE MOŻE WYGLĄDAĆ JAK PUSTKA. Ten plik ma DZIEWIĘĆ miejsc, w
//     których odmowa bazy nie zostawia śladu, bo destrukturyzacja pomija
//     `error`: reguła dostępu (linia 77), ustawienia czytania w przeglądarce
//     (405), strona główna po id (480) i po slugu (490), tagi/kategorie/
//     współautorzy wpisu (713-715), profile autorów i nakładka (749-756) oraz
//     nagłówek dziedziczony po przodkach strony (792). Każde z nich dostaje tu
//     przypadek PRZYPINAJĄCY stan faktyczny, a pięć najgroźniejszych dodatkowo
//     `it.fails` z konsekwencją dla człowieka. Klasa defektu „awaria wygląda
//     jak brak danych" wystąpiła w tym repo trzykrotnie;
//   * PUSTKA I BŁĄD TO DWA RÓŻNE ŚWIATY. Dla każdego zapytania, które umie
//     zwrócić jedno i drugie (lista bloga, archiwum, drzewo stron, kategorie,
//     wiersz wpisu, wiersz strony, gated body), jest osobny przypadek „nic nie
//     ma" i osobny „baza odmówiła";
//   * OKNO STRONY ARCHIWUM JEST DOKŁADNE. `range(from, to)` sprawdzamy na
//     pierwszej stronie, w środku i ZA ostatnią stroną - `total` pochodzi z
//     `count`, nie z długości wiersza, więc strona poza zakresem musi oddać
//     pustą listę z PRAWDZIWYM licznikiem (inaczej paginacja gubi ostatnią
//     stronę i crawler dostaje pusty, indeksowalny adres bez nawigacji);
//   * FILTR O WARTOŚCI FAŁSZYWEJ, ALE ZNACZĄCEJ. Mapa strony filtruje
//     `eq("seo_noindex", false)` - dosłownie `false`, nie „brak filtra". Zgubiony
//     filtr rozgłasza w widocznej mapie strony adresy, które sitemap.xml ukrywa
//     przed crawlerami; dlatego asercja porównuje CAŁE argumenty ogniwa;
//   * KOLEJNOŚĆ OGNIW JEST KONTRAKTEM. Współautorzy muszą przyjść z
//     `.order("sort_order", { ascending: true })`, kategorie publiczne z
//     `.order("name_pl")` BEZ opcji, lista bloga z `.order("published_at",
//     { ascending: false })`. Zgubione ogniwo `.order()` to kolejność losowa
//     między żądaniami - autorzy w cytowaniu zamieniają się miejscami, a wpisy
//     dublują się i giną w paginacji;
//   * REZOLUCJA ŚCIEŻKI TO GAŁĘZIE TYPESCRIPTU, NIE ROZSTRZYGNIĘCIE SQL.
//     Testuję pięć wyjść `resolveContentForSegments` (677-763): odmowa
//     `resolve_path` rzuca, brak `page_id` daje `null`, `post_id` wchodzi w
//     gałąź wpisu, `page_id` bez `post_id` w gałąź strony, a zniknięcie wiersza
//     między rezolucją a pobraniem daje `null`. CZY DANY ADRES JEST STRONĄ CZY
//     WPISEM rozstrzyga funkcja SQL `resolve_path` i dowód należy do pgTAP -
//     tutaj jej odpowiedź jest WEJŚCIEM, nie tezą;
//   * CZEGO KOD NIE ROBI. Wpis bez autorów nie może w ogóle sięgnąć po
//     `profiles_public`, wpis bez autora głównego nie może pytać o nakładkę
//     `author_profiles_public`, a strona z własnym `header_override` nie może
//     pytać o przodków. To asercje na BRAK łańcucha - jedyna forma, w jakiej
//     „zero zbędnych round-tripów na krytycznej ścieżce TTFB" da się dowieść.
//
// JAK. Zaślepione są DOKŁADNIE dwie granice: klient Supabase (łańcuch PostgREST
// + rejestrator RPC ze wspólnego harnessu `@/test/supabase`) i cache brzegowy
// (przezroczysty, ale zapisuje klucz i TTL). Zero sieci, zero sekretów, zero
// prawdziwego zegara (data bazowa 2026-08-21T10:00). `queryFn` uruchamiamy
// PRAWDZIWYM `QueryClient.fetchQuery`, więc nie ma tu ani jednego rzutowania
// funkcji; zawężanie wyniku do gałęzi „wpis"/„strona" robią strażniki runtime.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `orderAuthorIds` i `buildPostAuthors` (czyste funkcje kolejności i
//     scalania profili) - wyczerpująco pokrywa je
//     `src/lib/queries/__tests__/postAuthors.test.ts` (171 linii). Tutaj celem
//     jest WYWOŁANIE tych funkcji z rezolucji: dokładna lista id w ogniwie
//     `.in()` i to, czy round-trip po profile w ogóle leci;
//   * `normalizeHomepageMode`, tryb „najnowsze wpisy" i ścieżkę strony głównej
//     po SLUGU oraz historyczny fallback `slug = "home"` - to
//     `src/lib/queries/__tests__/homepageMode.test.ts`. Tutaj dokładam TYLKO
//     ścieżkę po `homepage_page_id`, jej przejście do slugu przy pudle, odmowę
//     bazy w fallbacku i stan „nie ma żadnej strony głównej";
//   * `blogArchiveQueryOptions().queryKey` (normalizacja `page`/`pageSize`) -
//     `src/lib/queries/__tests__/blogArchive.test.ts`. Tutaj sprawdzam
//     wyłącznie to, co robi jej `queryFn`: okno `range` i licznik;
//   * strip bramek buildera na serwerze (`stripBuilderAccessForAnonymousRender`)
//     i to, że w przeglądarce body zostaje nietknięte - dowodzi tego
//     `src/lib/builder/__tests__/publicBuilderAccessStrip.test.ts` w
//     środowisku `node`. Ten plik biegnie w happy-dom (window ISTNIEJE), więc
//     ścieżka gościnna nie jest tu w ogóle wykonywana i nie ma na nią asercji;
//   * bulk-odczyt ustawień czytania na SSR (`fetchReadingSettings`, linie
//     393-404) - to osobne środowisko wykonania, więc ma osobny plik:
//     `publicContentSsr.test.ts`;
//   * mechaniki cache'u brzegowego (skopowanie hostem, okno serve-stale,
//     single-flight) - `src/lib/__tests__/ssrCacheHostScope.test.ts`. Tutaj
//     `edgeTtlCache` jest przezroczysty i sprawdzam tylko, Z CZEGO ZBUDOWANY
//     jest klucz i jaki ma TTL, bo zgubiony w kluczu `limit` albo `page`
//     serwowałby stronę 3 pod adresem strony 1;
//   * kontraktu listy kolumn sekcji „dowiesz się, że..." -
//     `src/lib/keyTakeaways/__tests__/selectContract.test.ts`;
//   * rozstrzygnięcia `resolve_path`, treści `get_entity_content`,
//     `page_breadcrumbs`, `page_full_path` i izolacji najemcy (RLS) - to pgTAP.
//     Ten moduł nie filtruje po tenancie i nie ma tu ani jednej asercji „czy
//     jest filtr tenanta";
//   * renderu i adresów tras czytających ten moduł (`src/routes/$.tsx`,
//     `src/routes/index.tsx`, `src/routes/blog*`) - te pliki mają własne testy
//     i ZAŚLEPIAJĄ ten moduł, więc nie wykonują ani jednej jego linii.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  fail,
  ok,
  okCount,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
  type TableResponder,
} from "@/test/supabaseChain";
import type { RecordedRpc, SupabaseRpcStub } from "@/test/supabase/rpc";
import { EMPTY_BODY } from "@/lib/access/gating";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

/** Data bazowa całego pliku - żaden przypadek nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  /** Klucze i TTL, z jakimi kod sięgnął po cache brzegowy. */
  cache: [] as Array<{ key: string; ttl: number }>,
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

// Cache per-izolat jest tu PRZEZROCZYSTY (mechanikę ma własny plik), ale
// zapisuje klucz i TTL - bo to, co wchodzi do klucza, jest kontraktem TEGO
// modułu.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> => {
    h.cache.push({ key, ttl });
    return fn();
  },
}));

import {
  BLOG_PAGE_SIZE,
  ENTITY_SELECT_COLS,
  blogArchiveQueryOptions,
  blogListQueryOptions,
  fetchGatedBody,
  homePageQueryOptions,
  publicCategoriesQueryOptions,
  publicPagesTreeQueryOptions,
  resolvePostsPerPage,
  resolvedContentQueryOptions,
  type ResolvedContent,
} from "@/lib/queries/public";

// ---------- strażniki zawężające (zamiast rzutowań) ------------------------

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

/** Ostatnie wywołanie RPC o danej nazwie (brak = błąd testu, jak wyżej). */
function wywolanie(nazwa: string): RecordedRpc {
  const c = funkcje().lastCall(nazwa);
  if (!c) throw new Error(`test: kod nie wywołał RPC "${nazwa}"`);
  return c;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - `argsOf` oddaje tylko pierwsze,
 *  a `.order()` i `.eq()` bywają w tym pliku wołane wielokrotnie. */
function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

/** Pełne argumenty ogniwa `.eq()` dla wskazanej kolumny. Zwraca `undefined`,
 *  gdy filtra NIE BYŁO - a to inna odpowiedź niż „filtr z wartością pustą". */
function filtrEq(chain: RecordedChain, kolumna: string): ReadonlyArray<unknown> | undefined {
  return ogniwa(chain, "eq").find((a) => a[0] === kolumna);
}

type TrescWpisu = Extract<ResolvedContent, { kind: "post" }>;
type TrescStrony = Extract<ResolvedContent, { kind: "page" }>;

/** Zawężenie wyniku rezolucji do gałęzi wpisu W RUNTIME. Zamiast rzutowania:
 *  gdy kod pójdzie w gałąź strony albo zwróci `null`, test ma paść tutaj z
 *  czytelnym komunikatem, a nie na odczycie nieistniejącego pola. */
function jakoWpis(wynik: ResolvedContent | null): TrescWpisu {
  if (wynik === null) throw new Error("test: rezolucja oddała `null`, oczekiwano wpisu");
  if (wynik.kind !== "post") throw new Error(`test: oczekiwano wpisu, dostano "${wynik.kind}"`);
  return wynik;
}

/** Jak wyżej, dla gałęzi strony. */
function jakoStrona(wynik: ResolvedContent | null): TrescStrony {
  if (wynik === null) throw new Error("test: rezolucja oddała `null`, oczekiwano strony");
  if (wynik.kind !== "page") throw new Error(`test: oczekiwano strony, dostano "${wynik.kind}"`);
  return wynik;
}

/**
 * Odpowiedź zapytania LISTUJĄCEGO z licznikiem `{ count: "exact" }`.
 * `ok()` nie ustawia `count`, a archiwum czyta `count`, nie `data.length` -
 * bez tego pola `total` byłby zawsze zerem i paginacja by nie istniała.
 */
function okZLicznikiem<T>(rows: readonly T[], count: number): SupabaseResult<readonly T[]> {
  return { ...ok(rows), count };
}

/** Świeży klient na każde uruchomienie: bez ponowień i bez współdzielonego
 *  cache, więc `fetchQuery` naprawdę woła `queryFn` i oddaje jej wynik
 *  (albo odrzuca obietnicę jej wyjątkiem) - bez rzutowania `queryFn`. */
function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// ---------- fabryki danych -------------------------------------------------

const ID_STRONY = "str-1";
const ID_WPISU = "wpis-1";
const ID_AUTORA = "aut-1";

function wierszWpisuListy(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: "2026-08-01T00:00:00.000Z",
    parent_page_id: ID_STRONY,
    is_sponsored: null,
    sponsored_kind: null,
    sponsored_affiliate: null,
    ...over,
  };
}

function wierszProfilu(id: string): Record<string, unknown> {
  return {
    id,
    slug: `profil-${id}`,
    display_name: `Autor ${id}`,
    first_name: "Imię",
    last_name: "Nazwisko",
    avatar_url: null,
    bio_pl: null,
    bio_en: null,
  };
}

function okruszek(id: string, depth: number): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Strona ${id}`,
    title_en: `Page ${id}`,
    depth,
    full_path: `sciezka/${id}`,
  };
}

/** Ciało zwracane przez `get_entity_content` (RPC oddaje TABLICĘ wierszy). */
function cialo(over: Record<string, unknown> = {}): Array<Record<string, unknown>> {
  return [
    {
      content_pl: "treść pl",
      content_en: "treść en",
      builder_data: null,
      blocks_data: null,
      ...over,
    },
  ];
}

/** Plan odpowiedzi tabeli `pages` - jedna tabela, CZTERY różne łańcuchy
 *  (po id, po slugu, fallback `slug = "home"`, przodkowie przez `.in()`).
 *  Bez respondera zależnego od łańcucha nie da się ich rozdzielić. */
interface PlanStron {
  poId?: SupabaseResult;
  poSlug?: SupabaseResult;
  home?: SupabaseResult;
  przodkowie?: SupabaseResult;
}

function odpowiedzStron(plan: PlanStron): TableResponder {
  return (chain) => {
    if (chain.has("in")) return plan.przodkowie ?? ok([]);
    const slug = filtrEq(chain, "slug")?.[1];
    if (slug === "home") return plan.home ?? ok(null);
    if (slug !== undefined) return plan.poSlug ?? ok(null);
    return plan.poId ?? ok(null);
  };
}

/** Plan pełnej rezolucji treści. Każda granica ma tu domyślną, UDANĄ
 *  odpowiedź, bo atrapa traktuje niezaplanowaną tabelę jako błąd testu - a
 *  `Promise.all` w rezolucji dotyka siedmiu granic naraz. */
interface PlanRezolucji {
  resolve?: SupabaseResult;
  wpis?: SupabaseResult;
  cialo?: SupabaseResult;
  tagi?: SupabaseResult;
  kategorie?: SupabaseResult;
  wspolautorzy?: SupabaseResult;
  okruszki?: SupabaseResult;
  dostep?: SupabaseResult;
  profile?: SupabaseResult;
  nakladka?: SupabaseResult;
  strony?: PlanStron;
}

function planuj(plan: PlanRezolucji = {}): void {
  funkcje().setResponse(
    "resolve_path",
    plan.resolve ?? ok([{ page_id: ID_STRONY, post_id: null }]),
  );
  funkcje().setResponse("get_entity_content", plan.cialo ?? ok(cialo()));
  funkcje().setResponse("page_breadcrumbs", plan.okruszki ?? ok([okruszek(ID_STRONY, 0)]));
  baza().setResponse("posts", plan.wpis ?? ok(wierszWpisuListy(ID_WPISU)));
  baza().setResponse("post_tags", plan.tagi ?? ok([]));
  baza().setResponse("post_categories", plan.kategorie ?? ok([]));
  baza().setResponse("post_authors", plan.wspolautorzy ?? ok([]));
  baza().setResponse("content_access_public", plan.dostep ?? ok(null));
  baza().setResponse("profiles_public", plan.profile ?? ok([]));
  baza().setResponse("author_profiles_public", plan.nakladka ?? ok(null));
  baza().setResponse("pages", odpowiedzStron(plan.strony ?? {}));
}

// ---------- cykl życia -----------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  funkcje().reset();
  h.cache.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

// ==========================================================================
// GATED BODY - trzy stany serwera treści
// ==========================================================================

describe("body za bramką: pusto, odmowa i treść to trzy różne odpowiedzi", () => {
  it("nazwy argumentów RPC są jedynym dowodem, że serwer dostał to, o co pytamy", async () => {
    funkcje().setResponse("get_entity_content", ok(cialo()));
    await fetchGatedBody("post", ID_WPISU);
    // Obiekt argumentów jest luźny, więc literówka w `_entity_type` przechodzi
    // przez `tsc` i przez przegląd, a serwer po prostu nie znajdzie treści.
    expect(wywolanie("get_entity_content").keys()).toEqual(["_entity_type", "_entity_id"]);
    expect(wywolanie("get_entity_content").arg("_entity_type")).toBe("post");
    expect(wywolanie("get_entity_content").arg("_entity_id")).toBe(ID_WPISU);
  });

  it("czytelnik bez uprawnień dostaje puste body, nie wyjątek", async () => {
    // Serwer oddaje pustą tablicę, gdy `has_content_access` jest fałszywe.
    funkcje().setResponse("get_entity_content", ok([]));
    await expect(fetchGatedBody("page", ID_STRONY)).resolves.toEqual(EMPTY_BODY);
  });

  it("brak tablicy wierszy (null) też jest pustym body, a nie awarią odczytu", async () => {
    funkcje().setResponse("get_entity_content", ok(null));
    await expect(fetchGatedBody("page", ID_STRONY)).resolves.toEqual(EMPTY_BODY);
  });

  it("ODMOWA serwera treści rzuca - i to jest właściwe zachowanie", async () => {
    // Tu połknięcie byłoby najgorsze z możliwych: wpis wyrenderowałby się z
    // pustym ciałem, wyglądając jak wpis bez treści. Kod rzuca, więc trasa
    // pokazuje błąd zamiast udawać puste dzieło.
    funkcje().setResponse("get_entity_content", fail("odmowa RPC", "42501"));
    await expect(fetchGatedBody("post", ID_WPISU)).rejects.toThrow("odmowa RPC");
  });

  it("treść dostępna przechodzi w całości, razem z blokami i dokumentem buildera", async () => {
    const dokument = { version: 1, sections: [] };
    funkcje().setResponse(
      "get_entity_content",
      ok(cialo({ builder_data: dokument, blocks_data: [{ type: "text" }] })),
    );
    const body = await fetchGatedBody("post", ID_WPISU);
    expect(body).toEqual({
      content_pl: "treść pl",
      content_en: "treść en",
      builder_data: dokument,
      blocks_data: [{ type: "text" }],
    });
  });
});

// ==========================================================================
// STRONA GŁÓWNA - wskazanie operatora vs historyczny fallback
// ==========================================================================

describe("strona główna: która strona zostaje stroną główną", () => {
  it("wskazanie po ID pyta o stronę OPUBLIKOWANĄ i NIEUSUNIĘTĄ, bez fallbacku", async () => {
    baza().setResponse(
      "site_settings",
      ok({ value: { homepage_mode: "static_page", homepage_page_id: "wskazana" } }),
    );
    planuj({ strony: { poId: ok({ id: "wskazana", slug: "o-nas" }) } });

    const wynik = await klient().fetchQuery(homePageQueryOptions());
    expect(wynik?.id).toBe("wskazana");
    const c = lancuch("pages");
    expect(filtrEq(c, "id")).toEqual(["id", "wskazana"]);
    // Bez tych dwóch filtrów szkic albo strona w koszu stałaby się stroną główną.
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    // Jedno pytanie o stronę - fallback `slug = "home"` NIE poleciał.
    expect(baza().chainsFor("pages")).toHaveLength(1);
  });

  it("gdy wskazana po ID strona zniknęła, kod schodzi na slug, a potem na „home”", async () => {
    baza().setResponse(
      "site_settings",
      ok({
        value: {
          homepage_mode: "static_page",
          homepage_page_id: "usunieta",
          homepage_page_slug: "tez-usunieta",
        },
      }),
    );
    planuj({ strony: { poId: ok(null), poSlug: ok(null), home: ok({ id: "home-1" }) } });

    const wynik = await klient().fetchQuery(homePageQueryOptions());
    expect(wynik?.id).toBe("home-1");
    // Trzy próby w ustalonej kolejności: id -> slug -> konwencja.
    const proby = baza().chainsFor("pages");
    expect(proby).toHaveLength(3);
    expect(filtrEq(proby[1], "slug")).toEqual(["slug", "tez-usunieta"]);
    // Strona główna musi być korzeniem drzewa - inaczej podstrona microsite'u
    // mogłaby przejąć adres „/”.
    expect(ogniwa(proby[1], "is")).toEqual([
      ["parent_id", null],
      ["deleted_at", null],
    ]);
  });

  it("ODMOWA bazy w fallbacku rzuca, zamiast udawać „serwis bez strony głównej”", async () => {
    baza().setResponse("site_settings", ok({ value: {} }));
    planuj({ strony: { home: fail("odmowa pages", "42501") } });
    await expect(klient().fetchQuery(homePageQueryOptions())).rejects.toThrow("odmowa pages");
  });

  it("brak jakiejkolwiek strony głównej daje `null` BEZ pytania o body", async () => {
    baza().setResponse("site_settings", ok({ value: {} }));
    planuj({ strony: { home: ok(null) } });
    await expect(klient().fetchQuery(homePageQueryOptions())).resolves.toBeNull();
    expect(funkcje().callsFor("get_entity_content")).toHaveLength(0);
  });

  it("wskazanie trybu statycznego BEZ id i bez slugu wraca do konwencji „home”", async () => {
    baza().setResponse("site_settings", ok({ value: { homepage_mode: "static_page" } }));
    planuj({ strony: { home: ok({ id: "home-1" }) } });
    const wynik = await klient().fetchQuery(homePageQueryOptions());
    expect(wynik?.id).toBe("home-1");
    expect(filtrEq(lancuch("pages"), "slug")).toEqual(["slug", "home"]);
  });

  it("strona główna czyta kolumny SEO i takeaways, ale ŻADNEJ kolumny ciała", async () => {
    baza().setResponse("site_settings", ok({ value: {} }));
    planuj({ strony: { home: ok({ id: "home-1" }) } });
    await klient().fetchQuery(homePageQueryOptions());
    const kolumny = lancuch("pages").argsOf("select")?.[0];
    expect(kolumny).toBe(ENTITY_SELECT_COLS.homepage);
    // Gdyby body szło zwykłym selectem, treść premium wyciekłaby do
    // anonimowego SSR-a - stąd asercja NA BRAK tych kolumn.
    expect(String(kolumny)).not.toContain("content_pl");
    expect(String(kolumny)).not.toContain("builder_data");
  });

  it("klucz cache strony głównej i jego TTL są częścią kontraktu", async () => {
    baza().setResponse("site_settings", ok({ value: {} }));
    planuj({ strony: { home: ok(null) } });
    await klient().fetchQuery(homePageQueryOptions());
    expect(h.cache).toEqual([{ key: "public:home-page", ttl: 60_000 }]);
  });

  it("brak wiersza ustawień w przeglądarce to brak decyzji, nie awaria", async () => {
    // Świeży serwis: nikt nigdy nie zapisał klucza `reading`. `maybeSingle()`
    // oddaje `null`, a nie błąd - kod musi to potraktować jak pusty obiekt
    // ustawień i zejść na konwencję `slug = "home"`.
    baza().setResponse("site_settings", ok(null));
    planuj({ strony: { home: ok({ id: "home-1", slug: "home" }) } });
    const wynik = await klient().fetchQuery(homePageQueryOptions());
    expect(wynik?.id).toBe("home-1");
  });

  it("a browser settings error does not select or cache a different homepage", async () => {
    baza().setResponse("site_settings", fail("reading unavailable", "503"));
    await expect(klient().fetchQuery(homePageQueryOptions())).rejects.toMatchObject({
      message: "reading unavailable",
    });
    expect(baza().chainsFor("pages")).toHaveLength(0);
  });

  it("wiersz ustawień z pustą wartością zachowuje się jak brak wiersza", async () => {
    baza().setResponse("site_settings", ok({ value: null }));
    planuj({ strony: { home: ok({ id: "home-1", slug: "home" }) } });
    const wynik = await klient().fetchQuery(homePageQueryOptions());
    expect(wynik?.id).toBe("home-1");
  });

  it("błąd odczytu jest zgłaszany: odmowa RLS", async () => {
    // Przypięcie zachowania, nie życzenie: linie 479-487 czytają `const { data }`
    // bez `error`, więc odmowa RLS/timeout daje `data === null` i kod schodzi
    // na fallback `slug = "home"` tak samo, jakby strona nie istniała.
    baza().setResponse(
      "site_settings",
      ok({ value: { homepage_mode: "static_page", homepage_page_id: "wskazana" } }),
    );
    planuj({
      strony: { poId: fail("odmowa RLS", "42501"), home: ok({ id: "home-1", slug: "home" }) },
    });
    await expect(klient().fetchQuery(homePageQueryOptions())).rejects.toMatchObject({
      message: "odmowa RLS",
    });
  });

  it("AWARIA odczytu wskazanej strony głównej POWINNA być odróżnialna od jej usunięcia", async () => {
    baza().setResponse(
      "site_settings",
      ok({ value: { homepage_mode: "static_page", homepage_page_id: "wskazana" } }),
    );
    planuj({
      strony: { poId: fail("odmowa RLS", "42501"), home: ok({ id: "home-1", slug: "home" }) },
    });
    await expect(klient().fetchQuery(homePageQueryOptions())).rejects.toThrow();
  });
});

// ==========================================================================
// ROZMIAR STRONY LIST - widełki jak w formularzu
// ==========================================================================

describe("rozmiar strony list wpisów: co wolno wpisać operatorowi", () => {
  it("brak ustawień zostawia dotychczasowy rozmiar strony", () => {
    expect(resolvePostsPerPage(undefined)).toBe(BLOG_PAGE_SIZE);
    expect(resolvePostsPerPage({})).toBe(BLOG_PAGE_SIZE);
  });

  it("uszkodzony wpis (nie-obiekt, null) nie zmienia zachowania serwisu", () => {
    expect(resolvePostsPerPage({ reading: null })).toBe(BLOG_PAGE_SIZE);
    expect(resolvePostsPerPage({ reading: "12" })).toBe(BLOG_PAGE_SIZE);
  });

  it("wartość z formularza przechodzi, także zapisana jako tekst", () => {
    expect(resolvePostsPerPage({ reading: { posts_per_page: 24 } })).toBe(24);
    expect(resolvePostsPerPage({ reading: { posts_per_page: "24" } })).toBe(24);
  });

  it("widełki 1..100 z zaokrągleniem - wartość spoza zakresu nie kładzie listy", () => {
    expect(resolvePostsPerPage({ reading: { posts_per_page: 500 } })).toBe(100);
    expect(resolvePostsPerPage({ reading: { posts_per_page: 12.6 } })).toBe(13);
    // Zero i wartości ujemne to nie „strona bez wpisów", a brak decyzji.
    expect(resolvePostsPerPage({ reading: { posts_per_page: 0 } })).toBe(BLOG_PAGE_SIZE);
    expect(resolvePostsPerPage({ reading: { posts_per_page: -5 } })).toBe(BLOG_PAGE_SIZE);
    expect(resolvePostsPerPage({ reading: { posts_per_page: "abc" } })).toBe(BLOG_PAGE_SIZE);
  });
});

// ==========================================================================
// LISTA BLOGA - kształt zapytania i dwa stany zwrotki
// ==========================================================================

describe("lista bloga: kształt zapytania, adresy i dwa stany zwrotki", () => {
  it("pyta wyłącznie o opublikowane i nieusunięte, od najnowszych, z limitem strony", async () => {
    baza().setResponse("posts", ok([wierszWpisuListy("a")]));
    await klient().fetchQuery(blogListQueryOptions());
    const c = lancuch("posts");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    // Zgubione ogniwo `.order()` to losowa kolejność między żądaniami.
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[BLOG_PAGE_SIZE]]);
    // Oznaczenie komercyjne MUSI być w selekcie - bez tych kolumn karta
    // wyrenderowałaby materiał sponsorowany bez ujawnienia.
    expect(String(c.argsOf("select")?.[0])).toContain(SPONSORED_LIST_COLS);
  });

  it("większy limit z przeglądarki rozdziela wpis cache, nie miesza się z SSR-em", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(blogListQueryOptions(120));
    expect(ogniwa(lancuch("posts"), "limit")).toEqual([[120]]);
    expect(h.cache).toEqual([{ key: "public:blog-list:120", ttl: 60_000 }]);
  });

  it("adres wpisu idzie przez trasę /post/$slug, więc brak ścieżki rodzica go nie psuje", async () => {
    baza().setResponse("posts", ok([wierszWpisuListy("a"), wierszWpisuListy("b")]));
    const wynik = await klient().fetchQuery(blogListQueryOptions());
    expect(wynik.posts.map((p) => p.href)).toEqual(["/post/slug-a", "/post/slug-b"]);
    // Zero N+1: żadne `page_full_path` nie poleciało.
    expect(funkcje().callsFor("page_full_path")).toHaveLength(0);
  });

  it("PUSTO: serwis bez wpisów oddaje pustą listę", async () => {
    baza().setResponse("posts", ok(null));
    await expect(klient().fetchQuery(blogListQueryOptions())).resolves.toEqual({ posts: [] });
  });

  it("ODMOWA: baza, która odmówiła, rzuca - lista nie udaje serwisu bez treści", async () => {
    baza().setResponse("posts", fail("odmowa posts", "42501"));
    await expect(klient().fetchQuery(blogListQueryOptions())).rejects.toThrow("odmowa posts");
  });
});

// ==========================================================================
// ARCHIWUM BLOGA - okno strony i licznik
// ==========================================================================

describe("archiwum bloga: okno strony jest dokładne, licznik niezależny od wiersza", () => {
  it("pierwsza strona to okno [0, rozmiar-1]", async () => {
    baza().setResponse("posts", okZLicznikiem([wierszWpisuListy("a")], 137));
    const wynik = await klient().fetchQuery(blogArchiveQueryOptions({ pageSize: 20 }));
    expect(ogniwa(lancuch("posts"), "range")).toEqual([[0, 19]]);
    expect(wynik).toMatchObject({ total: 137, page: 1, pageSize: 20 });
  });

  it("strona ze środka liczy przesunięcie z rozmiaru strony, nie z długości wyniku", async () => {
    baza().setResponse("posts", okZLicznikiem([wierszWpisuListy("a")], 137));
    await klient().fetchQuery(blogArchiveQueryOptions({ page: 3, pageSize: 10 }));
    expect(ogniwa(lancuch("posts"), "range")).toEqual([[20, 29]]);
    expect(h.cache).toEqual([{ key: "public:blog-archive:3:10", ttl: 60_000 }]);
  });

  it("ZA ostatnią stroną: pusta lista, ale PRAWDZIWY licznik (nie zero)", async () => {
    // `okCount` to zwrotka bez wierszy - dokładnie to, co PostgREST oddaje na
    // przesunięciu poza zbiorem. Gdyby `total` liczył się z długości wyniku,
    // nawigacja paginacji zniknęłaby i czytelnik utknąłby na pustej stronie.
    baza().setResponse("posts", okCount(137));
    const wynik = await klient().fetchQuery(blogArchiveQueryOptions({ page: 99, pageSize: 20 }));
    expect(ogniwa(lancuch("posts"), "range")).toEqual([[1960, 1979]]);
    expect(wynik.posts).toEqual([]);
    expect(wynik.total).toBe(137);
  });

  it("brak licznika od bazy daje total 0, a nie wyjątek", async () => {
    baza().setResponse("posts", ok([]));
    const wynik = await klient().fetchQuery(blogArchiveQueryOptions());
    expect(wynik.total).toBe(0);
  });

  it("ODMOWA: archiwum rzuca, zamiast pokazać „brak wpisów” z licznikiem 0", async () => {
    baza().setResponse("posts", fail("odmowa archiwum", "57014"));
    await expect(klient().fetchQuery(blogArchiveQueryOptions())).rejects.toThrow("odmowa archiwum");
  });
});

// ==========================================================================
// MAPA STRONY I KATEGORIE - filtry, których zgubienie widać dopiero w SEO
// ==========================================================================

describe("widoczna mapa strony: co wolno w niej rozgłosić", () => {
  it("adres ukryty przed crawlerem NIE MOŻE trafić do mapy - filtr to dosłownie `false`", async () => {
    baza().setResponse("pages", ok([{ id: "p1", slug: "a", parent_id: null, menu_order: 0 }]));
    await klient().fetchQuery(publicPagesTreeQueryOptions());
    const c = lancuch("pages");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    // Wartość fałszywa, ale ZNACZĄCA: `eq("seo_noindex", false)` to inny filtr
    // niż jego brak. Porównanie całych argumentów łapie oba błędy.
    expect(filtrEq(c, "seo_noindex")).toEqual(["seo_noindex", false]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(c, "limit")).toEqual([[500]]);
    expect(h.cache).toEqual([{ key: "public:pages-tree", ttl: 5 * 60_000 }]);
  });

  it("PUSTO: serwis bez stron oddaje pustą mapę", async () => {
    baza().setResponse("pages", ok(null));
    await expect(klient().fetchQuery(publicPagesTreeQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA: mapa rzuca, zamiast udawać serwis bez stron", async () => {
    baza().setResponse("pages", fail("odmowa drzewa", "42501"));
    await expect(klient().fetchQuery(publicPagesTreeQueryOptions())).rejects.toThrow(
      "odmowa drzewa",
    );
  });
});

describe("publiczna lista kategorii", () => {
  it("sortuje po nazwie polskiej BEZ opcji kierunku (kolejność alfabetyczna nawigacji)", async () => {
    baza().setResponse("categories", ok([{ slug: "a", name_pl: "A", name_en: "A" }]));
    await klient().fetchQuery(publicCategoriesQueryOptions());
    // Jedno ogniwo, jeden argument: dodanie opcji ZMIENIŁOBY kolejność menu.
    expect(ogniwa(lancuch("categories"), "order")).toEqual([["name_pl"]]);
    expect(h.cache).toEqual([{ key: "public:categories", ttl: 5 * 60_000 }]);
  });

  it("PUSTO: brak kategorii to pusta lista", async () => {
    baza().setResponse("categories", ok(null));
    await expect(klient().fetchQuery(publicCategoriesQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA: lista kategorii rzuca, zamiast wygasić nawigację po cichu", async () => {
    baza().setResponse("categories", fail("odmowa kategorii", "42501"));
    await expect(klient().fetchQuery(publicCategoriesQueryOptions())).rejects.toThrow(
      "odmowa kategorii",
    );
  });
});

// ==========================================================================
// REZOLUCJA TREŚCI PO SEGMENTACH - gałęzie TypeScriptu, nie rozstrzygnięcie SQL
// ==========================================================================

describe("rezolucja adresu: pięć wyjść, gdy funkcja SQL już odpowiedziała", () => {
  it("pusta ścieżka nie dotyka bazy ani cache'u", async () => {
    planuj();
    await expect(klient().fetchQuery(resolvedContentQueryOptions([]))).resolves.toBeNull();
    expect(funkcje().calls).toHaveLength(0);
    expect(baza().chains).toHaveLength(0);
    expect(h.cache).toEqual([]);
  });

  it("ODMOWA rezolucji ścieżki rzuca - adres nie staje się cichym 404", async () => {
    // Gdyby ta odmowa była połknięta, awaria bazy pokazywałaby czytelnikowi
    // (i crawlerowi) stronę „nie znaleziono" dla istniejącej treści.
    planuj({ resolve: fail("odmowa resolve_path", "42501") });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toThrow("odmowa resolve_path");
  });

  it("ścieżka bez dopasowania daje `null` i NIE pyta o nic więcej", async () => {
    planuj({ resolve: ok([]) });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["nie-ma"]))).resolves.toBeNull();
    expect(baza().chains).toHaveLength(0);
    expect(funkcje().names()).toEqual(["resolve_path"]);
  });

  it("brak tablicy wierszy z funkcji SQL to też „nie ma takiego adresu”", async () => {
    planuj({ resolve: ok(null) });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["nie-ma"]))).resolves.toBeNull();
  });

  it("wiersz bez `page_id` daje `null` - nawet gdy `post_id` jest ustawiony", async () => {
    // Wpis bez strony-rodzica nie ma ścieżki, więc nie ma czego renderować pod
    // tym adresem; gałąź wpisu NIE MOŻE się na to złapać.
    planuj({ resolve: ok([{ page_id: null, post_id: ID_WPISU }]) });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["wpis"]))).resolves.toBeNull();
    expect(baza().chains).toHaveLength(0);
  });

  it("klucz cache rezolucji składa się z CAŁEJ ścieżki, nie z ostatniego segmentu", async () => {
    planuj({ resolve: ok([]) });
    await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "prawo", "wpis"]));
    // Zgubiony segment serwowałby treść jednej ścieżki pod adresem innej.
    expect(h.cache).toEqual([{ key: "public:resolved:analizy/prawo/wpis", ttl: 60_000 }]);
  });
});

describe("rezolucja adresu: gałąź WPISU", () => {
  const TRAFIENIE_WPISU = ok([{ page_id: ID_STRONY, post_id: ID_WPISU }]);

  it("siedem granic naraz: kształt każdego zapytania i nazwy argumentów funkcji SQL", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: null })),
    });
    await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"]));

    // Wiersz wpisu: kolumny prezentacyjne, ZERO kolumn ciała.
    const cWpis = lancuch("posts");
    expect(cWpis.argsOf("select")?.[0]).toBe(ENTITY_SELECT_COLS.post);
    expect(filtrEq(cWpis, "id")).toEqual(["id", ID_WPISU]);
    expect(cWpis.has("maybeSingle")).toBe(true);

    // Taksonomie: zagnieżdżony select przez tabelę pivot.
    expect(lancuch("post_tags").argsOf("select")?.[0]).toBe("tags(slug, name)");
    expect(filtrEq(lancuch("post_tags"), "post_id")).toEqual(["post_id", ID_WPISU]);
    expect(lancuch("post_categories").argsOf("select")?.[0]).toBe(
      "categories(slug, name_pl, name_en, color)",
    );

    // Współautorzy: kolejność jest KONTRAKTEM - bez tego ogniwa autorzy w
    // cytowaniu zamieniają się miejscami między żądaniami.
    expect(ogniwa(lancuch("post_authors"), "order")).toEqual([["sort_order", { ascending: true }]]);

    // Okruszki i reguła dostępu.
    expect(wywolanie("page_breadcrumbs").keys()).toEqual(["_page_id"]);
    expect(wywolanie("page_breadcrumbs").arg("_page_id")).toBe(ID_STRONY);
    const cDostep = lancuch("content_access_public");
    expect(filtrEq(cDostep, "entity_type")).toEqual(["entity_type", "post"]);
    expect(filtrEq(cDostep, "entity_id")).toEqual(["entity_id", ID_WPISU]);
    // Reguła dostępu NIE MOŻE wieźć pól wrażliwych do anonimowego SSR-a.
    const kolumnyDostepu = String(cDostep.argsOf("select")?.[0]);
    expect(kolumnyDostepu).toContain("teaser_pl");
    expect(kolumnyDostepu).not.toContain("password");
  });

  it("wpis, który zniknął między rezolucją a pobraniem, daje `null` (nie pusty wpis)", async () => {
    planuj({ resolve: TRAFIENIE_WPISU, wpis: ok(null) });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).resolves.toBeNull();
  });

  it("ODMOWA odczytu wiersza wpisu rzuca, zamiast oddać „nie ma takiego wpisu”", async () => {
    planuj({ resolve: TRAFIENIE_WPISU, wpis: fail("odmowa posts", "42501") });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toThrow("odmowa posts");
  });

  it("ODMOWA okruszków rzuca - ścieżka nawigacyjna nie może zniknąć po cichu", async () => {
    planuj({ resolve: TRAFIENIE_WPISU, okruszki: fail("odmowa okruszków", "42501") });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toThrow("odmowa okruszków");
  });

  it("pivot bez powiązanego wiersza (RLS ukrył tag) nie tworzy widma w liście", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      tagi: ok([{ tags: { slug: "nato", name: "NATO" } }, { tags: null }]),
      kategorie: ok([
        { categories: null },
        { categories: { slug: "analizy", name_pl: "Analizy", name_en: "Analyses", color: "#111" } },
      ]),
    });
    const wpis = jakoWpis(
      await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    );
    expect(wpis.tags).toEqual([{ slug: "nato", name: "NATO" }]);
    expect(wpis.categories.map((c) => c.slug)).toEqual(["analizy"]);
  });

  it("profile WSZYSTKICH autorów lecą JEDNYM zapytaniem, w kanonicznej kolejności", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
      wspolautorzy: ok([{ user_id: "wsp-1" }, { user_id: "wsp-2" }]),
      profile: ok([wierszProfilu("wsp-2"), wierszProfilu(ID_AUTORA), wierszProfilu("wsp-1")]),
      nakladka: ok({ job_title: "Analityk", custom_socials: [] }),
    });
    const wpis = jakoWpis(
      await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    );
    // JEDEN round-trip po profile (nie trzy) i DOKŁADNA lista id: autor główny
    // pierwszy, potem współautorzy w kolejności `sort_order`. To jest wywołanie
    // `orderAuthorIds` - samą funkcję pokrywa postAuthors.test.ts.
    expect(baza().chainsFor("profiles_public")).toHaveLength(1);
    expect(lancuch("profiles_public").argsOf("in")).toEqual(["id", [ID_AUTORA, "wsp-1", "wsp-2"]]);
    // Nakładka tylko dla autora GŁÓWNEGO i tylko z publicznej projekcji.
    expect(filtrEq(lancuch("author_profiles_public"), "user_id")).toEqual(["user_id", ID_AUTORA]);
    expect(String(lancuch("author_profiles_public").argsOf("select")?.[0])).not.toContain(
      "contact_email",
    );
    expect(wpis.author?.id).toBe(ID_AUTORA);
    expect(wpis.authors.map((a) => a.id)).toEqual([ID_AUTORA, "wsp-1", "wsp-2"]);
  });

  it("wpis BEZ autorów nie płaci ani jednego round-tripu za profile", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: null })),
      wspolautorzy: ok([]),
    });
    const wpis = jakoWpis(
      await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    );
    expect(baza().chainsFor("profiles_public")).toHaveLength(0);
    expect(baza().chainsFor("author_profiles_public")).toHaveLength(0);
    expect(wpis.author).toBeNull();
    expect(wpis.authors).toEqual([]);
  });

  it("wpis bez autora głównego, ale ze współautorami, NIE pyta o nakładkę", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: null })),
      wspolautorzy: ok([{ user_id: "wsp-1" }]),
      profile: ok([wierszProfilu("wsp-1")]),
    });
    const wpis = jakoWpis(
      await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    );
    // Nakładka jest własnością autora GŁÓWNEGO - bez niego zapytanie nie ma
    // sensu i kod podstawia gotowe `{ data: null }`.
    expect(baza().chainsFor("author_profiles_public")).toHaveLength(0);
    expect(wpis.author).toBeNull();
    expect(wpis.authors.map((a) => a.id)).toEqual(["wsp-1"]);
  });

  it("błąd odczytu jest zgłaszany: odmowa post_authors", async () => {
    // Linia 729 domyka odmowę wyrażeniem `(coAuthorRows ?? [])`, więc lista
    // autorów kurczy się do tego jednego, którego id siedzi w wierszu wpisu.
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
      wspolautorzy: fail("odmowa post_authors", "42501"),
      profile: ok([wierszProfilu(ID_AUTORA)]),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "odmowa post_authors" });
  });

  it("błąd odczytu jest zgłaszany: odmowa post_tags", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      tagi: fail("odmowa post_tags", "42501"),
      kategorie: fail("odmowa post_categories", "42501"),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "odmowa post_tags" });
  });

  it("AWARIA taksonomii POWINNA być odróżnialna od wpisu, którego nikt nie skategoryzował", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      kategorie: fail("odmowa post_categories", "42501"),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toThrow();
  });

  it("błąd odczytu jest zgłaszany: odmowa profiles_public", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
      profile: fail("odmowa profiles_public", "42501"),
      nakladka: fail("odmowa nakładki", "42501"),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "odmowa profiles_public" });
  });

  it("błąd odczytu jest zgłaszany: odmowa profiles_public", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
      profile: fail("odmowa profiles_public", "42501"),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "odmowa profiles_public" });
  });

  it("błąd odczytu jest zgłaszany: odmowa reguły", async () => {
    planuj({ resolve: TRAFIENIE_WPISU, dostep: fail("odmowa reguły", "42501") });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "odmowa reguły" });
  });

  it("AWARIA reguły dostępu POWINNA być odróżnialna od treści bez paywalla", async () => {
    planuj({ resolve: TRAFIENIE_WPISU, dostep: fail("odmowa reguły", "42501") });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toThrow();
  });

  it("ciało wpisu doklejane jest do wiersza prezentacyjnego, nie zamiast niego", async () => {
    planuj({
      resolve: TRAFIENIE_WPISU,
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: null, read_minutes: 7 })),
      cialo: ok(cialo({ content_pl: "pełna treść" })),
    });
    const wpis = jakoWpis(
      await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    );
    expect(wpis.item.read_minutes).toBe(7);
    expect(wpis.item.content_pl).toBe("pełna treść");
    expect(wpis.parentPageId).toBe(ID_STRONY);
    expect(wpis.crumbs.map((c) => c.id)).toEqual([ID_STRONY]);
  });
});

describe("rezolucja adresu: gałąź STRONY i dziedziczenie nagłówka microsite'u", () => {
  const TRAFIENIE_STRONY = ok([{ page_id: ID_STRONY, post_id: null }]);

  it("strona z WŁASNYM nagłówkiem nie płaci za zapytanie o przodków", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek("korzen", 0), okruszek(ID_STRONY, 1)]),
      strony: { poId: ok({ id: ID_STRONY, header_override: "naglowek-wlasny" }) },
    });
    const strona = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["o-nas"])));
    expect(strona.item.header_override).toBe("naglowek-wlasny");
    // Jedno zapytanie do `pages` - o sam wiersz strony, bez `.in()` po przodkach.
    expect(baza().chainsFor("pages")).toHaveLength(1);
    expect(baza().chainsFor("pages")[0].has("in")).toBe(false);
  });

  it("nagłówek dziedziczy z NAJBLIŻSZEGO przodka, który go ustawił", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek("korzen", 0), okruszek("dzial", 1), okruszek(ID_STRONY, 2)]),
      strony: {
        poId: ok({ id: ID_STRONY, header_override: null }),
        przodkowie: ok([
          { id: "korzen", header_override: "naglowek-korzenia" },
          { id: "dzial", header_override: "naglowek-dzialu" },
        ]),
      },
    });
    const strona = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["a", "b"])));
    // Najbliższy = największa głębokość. Odwrotna kolejność dałaby nagłówek
    // korzenia serwisu na każdej podstronie każdego microsite'u.
    expect(strona.item.header_override).toBe("naglowek-dzialu");
    // Pytamy TYLKO o przodków - własne id strony nie ma czego szukać w `.in()`.
    const cPrzodkowie = baza().chainsFor("pages")[1];
    expect(cPrzodkowie.argsOf("in")).toEqual(["id", ["korzen", "dzial"]]);
  });

  it("okruszki zawierające TYLKO samą stronę nie generują zapytania o przodków", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek(ID_STRONY, 0)]),
      strony: { poId: ok({ id: ID_STRONY, header_override: null }) },
    });
    const strona = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["o-nas"])));
    expect(strona.item.header_override).toBeNull();
    expect(baza().chainsFor("pages")).toHaveLength(1);
  });

  it("brak okruszków (strona-sierota) też nie generuje zapytania o przodków", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([]),
      strony: { poId: ok({ id: ID_STRONY, header_override: null }) },
    });
    const strona = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["o-nas"])));
    expect(strona.item.header_override).toBeNull();
    expect(baza().chainsFor("pages")).toHaveLength(1);
  });

  it("gdy żaden przodek nie ustawił nagłówka, strona zostaje przy globalnym", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek("korzen", 0), okruszek(ID_STRONY, 1)]),
      strony: {
        poId: ok({ id: ID_STRONY, header_override: null }),
        przodkowie: ok([{ id: "korzen", header_override: null }]),
      },
    });
    const strona = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["a", "b"])));
    expect(strona.item.header_override).toBeNull();
  });

  it("strona, która zniknęła między rezolucją a pobraniem, daje `null`", async () => {
    planuj({ resolve: TRAFIENIE_STRONY, strony: { poId: ok(null) } });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["o-nas"]))).resolves.toBeNull();
  });

  it("ODMOWA odczytu wiersza strony rzuca, zamiast oddać „nie ma takiej strony”", async () => {
    planuj({ resolve: TRAFIENIE_STRONY, strony: { poId: fail("odmowa pages", "42501") } });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["o-nas"]))).rejects.toThrow(
      "odmowa pages",
    );
  });

  it("błąd odczytu jest zgłaszany: odmowa przodków", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek("korzen", 0), okruszek(ID_STRONY, 1)]),
      strony: {
        poId: ok({ id: ID_STRONY, header_override: null }),
        przodkowie: fail("odmowa przodków", "42501"),
      },
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["a", "b"])),
    ).rejects.toMatchObject({ message: "odmowa przodków" });
  });

  it("AWARIA odczytu przodków POWINNA być odróżnialna od microsite'u bez własnego nagłówka", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      okruszki: ok([okruszek("korzen", 0), okruszek(ID_STRONY, 1)]),
      strony: {
        poId: ok({ id: ID_STRONY, header_override: null }),
        przodkowie: fail("odmowa przodków", "42501"),
      },
    });
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["a", "b"]))).rejects.toThrow();
  });

  it("strona czyta szablon i nagłówek, ale ŻADNEJ kolumny ciała", async () => {
    planuj({
      resolve: TRAFIENIE_STRONY,
      strony: { poId: ok({ id: ID_STRONY, header_override: "x" }) },
    });
    await klient().fetchQuery(resolvedContentQueryOptions(["o-nas"]));
    const kolumny = String(baza().chainsFor("pages")[0].argsOf("select")?.[0]);
    expect(kolumny).toBe(ENTITY_SELECT_COLS.page);
    expect(kolumny).toContain("template_type");
    expect(kolumny).not.toContain("content_pl");
    expect(kolumny).not.toContain("builder_data");
  });
});

describe("independent public query failures", () => {
  it("rejects the configured homepage slug lookup without choosing another page", async () => {
    baza().setResponse(
      "site_settings",
      ok({ value: { homepage_mode: "static_page", homepage_page_slug: "start" } }),
    );
    planuj({ strony: { poSlug: fail("slug denied", "42501"), home: ok({ id: "wrong-home" }) } });
    await expect(klient().fetchQuery(homePageQueryOptions())).rejects.toMatchObject({
      message: "slug denied",
    });
    expect(baza().chainsFor("pages")).toHaveLength(1);
  });

  it("rejects a failed author overlay even when profiles loaded successfully", async () => {
    planuj({
      resolve: ok([{ page_id: ID_STRONY, post_id: ID_WPISU }]),
      wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
      profile: ok([wierszProfilu(ID_AUTORA)]),
      nakladka: fail("overlay denied", "42501"),
    });
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
    ).rejects.toMatchObject({ message: "overlay denied" });
  });
});

it("successful empty metadata responses preserve the resolved article", async () => {
  planuj({
    resolve: ok([{ page_id: ID_STRONY, post_id: ID_WPISU }]),
    wpis: ok(wierszWpisuListy(ID_WPISU, { author_id: ID_AUTORA })),
    tagi: ok(null),
    kategorie: ok(null),
    wspolautorzy: ok(null),
    profile: ok(null),
    nakladka: ok(null),
  });
  const article = jakoWpis(
    await klient().fetchQuery(resolvedContentQueryOptions(["analizy", "wpis"])),
  );
  expect(article.item.id).toBe(ID_WPISU);
  expect(article.tags).toEqual([]);
  expect(article.categories).toEqual([]);
});

it("a missing ancestor metadata list preserves the global page header", async () => {
  planuj({
    okruszki: ok([okruszek("korzen", 0), okruszek(ID_STRONY, 1)]),
    strony: { poId: ok({ id: ID_STRONY, header_override: null }), przodkowie: ok(null) },
  });
  const page = jakoStrona(await klient().fetchQuery(resolvedContentQueryOptions(["o-nas"])));
  expect(page.item.header_override).toBeNull();
});

it("resolves the configured homepage slug without falling back to home", async () => {
  baza().setResponse(
    "site_settings",
    ok({ value: { homepage_mode: "static_page", homepage_page_slug: "start" } }),
  );
  planuj({ strony: { poSlug: ok({ id: "configured-start", slug: "start" }) } });
  expect((await klient().fetchQuery(homePageQueryOptions()))?.id).toBe("configured-start");
  expect(baza().chainsFor("pages")).toHaveLength(1);
});
