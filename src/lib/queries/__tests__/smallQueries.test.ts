// MAŁE CZYTNIKI TREŚCI PUBLICZNEJ - dziesięć powierzchni, jeden wspólny wzorzec
// awarii.
//
// CO TO DOWODZI. Dziesięć modułów w `src/lib/queries/**` obsługuje po jednej
// powierzchni czytelnika: sąsiedzi wpisu, CV autora, słowniczek pojęć, kolumna
// mega-menu, konfiguracja mobilnego drawera, kolejny wpis do doczytania, seria/
// dossier, layout paska bocznego, metadane stron statycznych i Web Stories.
// Stoją w jednym pliku, bo dzielą JEDEN kontrakt i JEDEN wzorzec błędu, a
// rozbicie ich na dziesięć plików powtórzyłoby tę samą fabrykę atrap dziesięć
// razy. Przypadki są nazwane po skutku dla czytelnika, nie po nazwach funkcji:
//
//   * PUSTKA I BŁĄD TO DWA RÓŻNE ŚWIATY. Każdy z tych modułów umie zwrócić
//     jedno i drugie, więc każdy ma osobny przypadek „nic nie ma" i osobny
//     „baza odmówiła". Osiem z nich rzuca (słowniczek, sąsiedzi, kolejny wpis,
//     seria, layouty, Web Stories) - i to jest właściwe zachowanie. DWA
//     POŁYKAJĄ i to jest cała treść tego pliku:
//       - `authorCv.ts:104-110` nie sprawdza `error` przy ŻADNYM z pięciu
//         odczytów: odmowa daje kompletne, puste CV;
//       - `staticPageSeo.ts:38` ma `if (error) return null`, czyli zamienia
//         awarię w „operator nie opisał tej strony";
//     oba dostają przypadek przypinający stan faktyczny i `it.fails` z
//     konsekwencją dla człowieka. Trzeci połykacz, `megaMenu.ts` (linie 40, 46,
//     54), jest przypięty stanem faktycznym bez `it.fails`: to ta sama klasa
//     defektu i to samo rozstrzygnięcie, a `staticPageSeo` opisuje ją na
//     przykładzie o dużo poważniejszym skutku (indeksacja);
//   * ROZSTRZYGNIĘCIE REMISÓW JEST KONTRAKTEM. CV autora czyta PIĘĆ tabel i
//     każda ma DWA ogniwa `.order()`: `sort_order` operatora, a po nim
//     naturalny porządek (data od najnowszej, etykieta alfabetycznie).
//     Zgubione drugie ogniwo daje losową kolejność doświadczeń o tej samej
//     wadze między żądaniami, czyli „skaczące" CV. To samo w layoutach paska
//     (`is_default` malejąco, potem nazwa) i w sąsiadach wpisu (kierunek
//     sortowania rozstrzyga, KTÓRY sąsiad jest poprzedni, a który następny);
//   * FILTR, KTÓREGO ZGUBIENIE POKAZUJE SZKICE. Wszędzie, gdzie treść ma być
//     publiczna, asercje porównują CAŁE argumenty ogniwa `.eq("status",
//     "published")` i `.is("deleted_at", null)` - bo filtr z inną wartością i
//     brak filtra to dwa różne błędy o tym samym skutku: szkic redakcyjny na
//     publicznej stronie;
//   * OSTRE PORÓWNANIA ZAMIAST WYKLUCZANIA SIEBIE. Sąsiedzi wpisu opierają się
//     na `lt`/`gt` po dacie publikacji - bez ogniwa `neq(id)`. Test przypina to
//     jako świadomą decyzję: gdyby porównania stały się nieostre (`lte`/`gte`),
//     wpis stałby się swoim własnym sąsiadem i nawigacja „poprzedni/następny"
//     zapętliłaby czytelnika na jednym materiale;
//   * BRAK ID NIE PYTA BAZY. CV bez `userId`, layout bez `id`, kolejny wpis bez
//     rodzica, kolumna menu bez slugu - wszystkie muszą zwrócić pustą odpowiedź
//     BEZ round-tripu. To asercje na brak łańcucha;
//   * DANE OD OPERATORA MOGĄ BYĆ USZKODZONE. `parseWidgets` w
//     `sidebarLayouts.ts:22-32` dostaje jsonb: nie-tablicę, `null` w tablicy,
//     widget bez typu, widget bez id. Żaden z tych stanów nie może wywalić
//     renderu paska bocznego, a widget bez id musi dostać własny identyfikator.
//
// JAK. Zaślepione są DOKŁADNIE dwie granice: klient Supabase (łańcuch PostgREST
// + rejestrator RPC ze wspólnego harnessu `@/test/supabase`) i server fn
// konfiguracji drawera. Zero sieci, zero sekretów, zero prawdziwego zegara
// (data bazowa 2026-08-21T10:00); jedyne inne źródło niedeterminizmu w tej
// warstwie, `crypto.randomUUID()` w `parseWidgets`, jest podmienione szpiegiem
// NA INSTANCJI. `queryFn` uruchamiamy PRAWDZIWYM `QueryClient.fetchQuery`, więc
// nie ma tu ani jednego rzutowania funkcji.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * `fetchGatedBody` i strip bramek buildera - to `publicContent.test.ts` i
//     `src/lib/builder/__tests__/publicBuilderAccessStrip.test.ts`. `nextPost.ts`
//     woła gated RPC i tutaj sprawdzam TYLKO, że body kolejnego wpisu idzie tą
//     drogą, a nie zwykłym selectem kolumn treści;
//   * `pickLocalized` (polityka wyboru języka z kolumn bliźniaczych) -
//     `src/lib/i18n/__tests__` ma ją na własność; w kolumnie mega-menu
//     sprawdzam wyłącznie, że moduł ją WOŁA dla właściwego języka;
//   * `safeParsePages`, `parseDrawerConfig` i schematy zod Web Stories oraz
//     drawera - należą do swoich modułów i mają własne testy; tutaj dowodzę
//     tylko, że warstwa danych przez nie przechodzi (uszkodzony jsonb nie
//     wychodzi z modułu);
//   * `DEFAULT_READING_PANEL_SETTINGS` i model widgetów paska bocznego -
//     `src/lib/sidebarBuilder`; tu tylko fallbackowy layout jako CAŁOŚĆ;
//   * renderu komponentów, które te zapytania konsumują (`AutoLoadNextPost`,
//     `PostFooterBars`, `MegaMenu`, drawer mobilny, box CV autora, StoryViewer)
//     - mają własne testy i ZAŚLEPIAJĄ te moduły, więc nie wykonują ani jednej
//     ich linii;
//   * treści i uprawnień funkcji SQL `page_full_path` oraz RLS/izolacji
//     najemcy - to pgTAP. Tu dowodzę wyłącznie nazw argumentów i tego, co kod
//     robi z odpowiedzią.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fail,
  ok,
  type RecordedChain,
  type SupabaseFromStub,
  type SupabaseResult,
} from "@/test/supabaseChain";
import type { RecordedRpc, SupabaseRpcStub } from "@/test/supabase/rpc";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";
import { DEFAULT_DRAWER_CONFIG, type DrawerConfig } from "@/lib/mobileDrawer";
import { DEFAULT_READING_PANEL_SETTINGS } from "@/lib/sidebarBuilder/types";

/** Data bazowa całego pliku - żaden przypadek nie czyta prawdziwego zegara. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";
/** Stałe UUID zamiast losowego - `parseWidgets` sięga po generator. */
const UUID_STALY = "00000000-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  drawer: vi.fn<() => Promise<unknown>>(),
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

// Server fn drawera nie da się wywołać bez kontekstu żądania frameworka, więc
// granica jest tu atrapą - a testem jest to, że warstwa zapytań NIE dokłada
// własnej obsługi błędu ani własnego fallbacku.
vi.mock("@/lib/mobileDrawer.functions", () => ({ getMobileDrawerConfig: h.drawer }));

import { adjacentPostsQueryOptions } from "@/lib/queries/adjacentPosts";
import { authorCvQueryOptions } from "@/lib/queries/authorCv";
import { glossaryTermsQueryOptions } from "@/lib/queries/glossary";
import { megaMenuCategoryQueryOptions } from "@/lib/queries/megaMenu";
import { mobileDrawerConfigQueryOptions } from "@/lib/queries/mobileDrawer";
import { fetchNextPost } from "@/lib/queries/nextPost";
import { postSeriesQueryOptions, seriesPageQueryOptions } from "@/lib/queries/series";
import {
  allSidebarLayoutsQueryOptions,
  buildFallbackLayout,
  defaultSidebarLayoutQueryOptions,
  sidebarLayoutByIdQueryOptions,
} from "@/lib/queries/sidebarLayouts";
import {
  pickStaticSeo,
  staticPageSeoQueryOptions,
  type StaticPageSeo,
} from "@/lib/queries/staticPageSeo";
import { latestWebStoriesQueryOptions, webStoryBySlugQueryOptions } from "@/lib/queries/webStories";

// ---------- strażniki zawężające (zamiast rzutowań) ------------------------

function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return s;
}

function funkcje(): SupabaseRpcStub {
  const s = h.rpc;
  if (!s) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return s;
}

function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

function wywolanie(nazwa: string): RecordedRpc {
  const c = funkcje().lastCall(nazwa);
  if (!c) throw new Error(`test: kod nie wywołał RPC "${nazwa}"`);
  return c;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - `.order()` bywa tu wołane dwa razy
 *  i to drugie wywołanie jest rozstrzygnięciem remisów, czyli kontraktem. */
function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

function filtrEq(chain: RecordedChain, kolumna: string): ReadonlyArray<unknown> | undefined {
  return ogniwa(chain, "eq").find((a) => a[0] === kolumna);
}

/** Zawężenie do NIEPUSTEGO wyniku w runtime - zamiast rzutowania. */
function obecne<T>(wartosc: T | null | undefined, opis: string): T {
  if (wartosc === null || wartosc === undefined) {
    throw new Error(`test: oczekiwano ${opis}, dostano brak wartości`);
  }
  return wartosc;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// ---------- cykl życia -----------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  funkcje().reset();
  h.drawer.mockReset();
  // W happy-dom `crypto.randomUUID` siedzi na prototypie, ale szpieg zakłada
  // własną właściwość NA INSTANCJI i to ona przechwytuje wywołanie.
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(UUID_STALY);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ==========================================================================
// SĄSIEDZI WPISU - „poprzedni / następny" w stopce
// ==========================================================================

describe("sąsiedzi wpisu: który materiał jest poprzedni, a który następny", () => {
  const DATA_WPISU = "2026-08-10T00:00:00.000Z";

  function wierszSasiada(slug: string): Record<string, unknown> {
    return { slug, title_pl: `Tytuł ${slug}`, title_en: `Title ${slug}`, parent_page_id: "str-1" };
  }

  it("bez identyfikatora albo bez daty zapytanie jest WYŁĄCZONE", () => {
    expect(adjacentPostsQueryOptions(null, DATA_WPISU).enabled).toBe(false);
    expect(adjacentPostsQueryOptions("w-1", null).enabled).toBe(false);
    expect(adjacentPostsQueryOptions("w-1", DATA_WPISU).enabled).toBe(true);
  });

  it("wywołane bez kluczy nie dotyka bazy i oddaje pustych sąsiadów", async () => {
    await expect(klient().fetchQuery(adjacentPostsQueryOptions(null, null))).resolves.toEqual({
      prev: null,
      next: null,
    });
    expect(baza().chains).toHaveLength(0);
  });

  it("kierunek sortowania rozstrzyga, KTÓRY sąsiad jest poprzedni", async () => {
    baza().setResponse("posts", (chain) =>
      ok([wierszSasiada(chain.has("lt") ? "starszy" : "nowszy")]),
    );
    const wynik = await klient().fetchQuery(adjacentPostsQueryOptions("w-1", DATA_WPISU));
    expect(wynik.prev?.slug).toBe("starszy");
    expect(wynik.next?.slug).toBe("nowszy");

    const [cPrev, cNext] = baza().chainsFor("posts");
    // Poprzedni = NAJNOWSZY z wcześniejszych, więc `lt` + malejąco.
    expect(cPrev.argsOf("lt")).toEqual(["published_at", DATA_WPISU]);
    expect(ogniwa(cPrev, "order")).toEqual([["published_at", { ascending: false }]]);
    // Następny = NAJSTARSZY z późniejszych, więc `gt` + rosnąco. Zamiana
    // kierunku wysłałaby czytelnika na koniec archiwum zamiast do sąsiada.
    expect(cNext.argsOf("gt")).toEqual(["published_at", DATA_WPISU]);
    expect(ogniwa(cNext, "order")).toEqual([["published_at", { ascending: true }]]);
    for (const c of [cPrev, cNext]) {
      expect(filtrEq(c, "status")).toEqual(["status", "published"]);
      expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
      expect(ogniwa(c, "limit")).toEqual([[1]]);
      // ŚWIADOMY brak `neq(id)`: ostre porównania same wykluczają bieżący wpis.
      expect(c.has("neq")).toBe(false);
    }
  });

  it("brak sąsiada z którejkolwiek strony daje `null`, a nie pustą tablicę", async () => {
    baza().setResponse("posts", ok([]));
    await expect(
      klient().fetchQuery(adjacentPostsQueryOptions("w-1", DATA_WPISU)),
    ).resolves.toEqual({ prev: null, next: null });
  });

  it("brak wierszy (null) też jest brakiem sąsiada, a nie awarią", async () => {
    baza().setResponse("posts", ok(null));
    await expect(
      klient().fetchQuery(adjacentPostsQueryOptions("w-1", DATA_WPISU)),
    ).resolves.toEqual({ prev: null, next: null });
  });

  it("ODMOWA po stronie POPRZEDNIEGO rzuca - stopka nie udaje krańca archiwum", async () => {
    baza().setResponse("posts", (chain) =>
      chain.has("lt") ? fail("odmowa poprzedniego", "42501") : ok([]),
    );
    await expect(klient().fetchQuery(adjacentPostsQueryOptions("w-1", DATA_WPISU))).rejects.toThrow(
      "odmowa poprzedniego",
    );
  });

  it("ODMOWA po stronie NASTĘPNEGO rzuca osobnym błędem", async () => {
    // Osobny przypadek, bo to osobne `if (error) throw` - jedno sprawdzenie
    // mniej i połowa nawigacji milknie bez śladu.
    baza().setResponse("posts", (chain) =>
      chain.has("gt") ? fail("odmowa następnego", "42501") : ok([]),
    );
    await expect(klient().fetchQuery(adjacentPostsQueryOptions("w-1", DATA_WPISU))).rejects.toThrow(
      "odmowa następnego",
    );
  });
});

// ==========================================================================
// CV AUTORA - pięć tabel, żadnego sprawdzenia błędu
// ==========================================================================

describe("CV autora: kolejność operatora i cisza po odmowie", () => {
  const TABELE = [
    "profile_experiences_public",
    "profile_education_public",
    "profile_skills_public",
    "profile_awards_public",
    "profile_hobbies_public",
  ] as const;

  // Parametr typowany szeroko (`SupabaseResult`), bo przypadki odmowy podają
  // `fail(...)`, gdzie `data` jest `null`, a nie tablicą.
  function planujCv(odpowiedz: SupabaseResult = ok([])): void {
    for (const t of TABELE) baza().setResponse(t, odpowiedz);
  }

  it("brak autora nie generuje ani jednego round-tripu", async () => {
    const cv = await klient().fetchQuery(authorCvQueryOptions(null));
    expect(cv).toEqual({ experiences: [], education: [], skills: [], awards: [], hobbies: [] });
    expect(baza().chains).toHaveLength(0);
  });

  it("`undefined` (profil jeszcze nieznany) też nie pyta bazy", async () => {
    await klient().fetchQuery(authorCvQueryOptions(undefined));
    expect(baza().chains).toHaveLength(0);
  });

  it("każda z pięciu sekcji ma kolejność operatora I rozstrzygnięcie remisów", async () => {
    planujCv();
    await klient().fetchQuery(authorCvQueryOptions("aut-1"));
    const oczekiwane: Record<string, ReadonlyArray<ReadonlyArray<unknown>>> = {
      profile_experiences_public: [
        ["sort_order", { ascending: true }],
        ["start_date", { ascending: false }],
      ],
      profile_education_public: [
        ["sort_order", { ascending: true }],
        ["start_date", { ascending: false }],
      ],
      profile_skills_public: [
        ["sort_order", { ascending: true }],
        ["label", { ascending: true }],
      ],
      profile_awards_public: [
        ["sort_order", { ascending: true }],
        ["awarded_at", { ascending: false }],
      ],
      profile_hobbies_public: [
        ["sort_order", { ascending: true }],
        ["label", { ascending: true }],
      ],
    };
    for (const tabela of TABELE) {
      const c = lancuch(tabela);
      expect(filtrEq(c, "user_id")).toEqual(["user_id", "aut-1"]);
      // Bez drugiego ogniwa doświadczenia o tej samej wadze zmieniałyby
      // kolejność między żądaniami - CV „skakałoby" czytelnikowi.
      expect(ogniwa(c, "order")).toEqual(oczekiwane[tabela]);
    }
  });

  it("puste sekcje dają puste listy, każda niezależnie", async () => {
    planujCv();
    baza().setResponse("profile_skills_public", ok([{ id: "u-1", label: "Analiza", level: 3 }]));
    const cv = await klient().fetchQuery(authorCvQueryOptions("aut-1"));
    expect(cv.skills).toHaveLength(1);
    expect(cv.experiences).toEqual([]);
    expect(cv.hobbies).toEqual([]);
  });

  it("odpowiedź null daje pięć pustych sekcji CV", async () => {
    planujCv(ok(null));
    await expect(klient().fetchQuery(authorCvQueryOptions("aut-1"))).resolves.toEqual({
      experiences: [],
      education: [],
      skills: [],
      awards: [],
      hobbies: [],
    });
  });

  it.each(TABELE)("odmowa %s nie udaje pustego CV", async (table) => {
    planujCv();
    baza().setResponse(table, fail("odmowa CV", "42501"));
    await expect(klient().fetchQuery(authorCvQueryOptions("aut-1"))).rejects.toMatchObject({
      message: "odmowa CV",
    });
  });
});

// ==========================================================================
// SŁOWNICZEK POJĘĆ
// ==========================================================================

describe("słowniczek pojęć: alfabet i dwa stany zwrotki", () => {
  it("sortuje alfabetycznie po nazwie polskiej i ma twardy limit", async () => {
    baza().setResponse("glossary_terms", ok([]));
    await klient().fetchQuery(glossaryTermsQueryOptions());
    const c = lancuch("glossary_terms");
    // Jedno ogniwo, jeden argument - dodanie opcji zmieniłoby kolejność haseł.
    expect(ogniwa(c, "order")).toEqual([["term_pl"]]);
    expect(ogniwa(c, "limit")).toEqual([[500]]);
  });

  it("PUSTO: serwis bez haseł oddaje pustą listę", async () => {
    baza().setResponse("glossary_terms", ok(null));
    await expect(klient().fetchQuery(glossaryTermsQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA: słowniczek rzuca, zamiast wygasić wszystkie tooltipy po cichu", async () => {
    baza().setResponse("glossary_terms", fail("odmowa słowniczka", "42501"));
    await expect(klient().fetchQuery(glossaryTermsQueryOptions())).rejects.toThrow(
      "odmowa słowniczka",
    );
  });
});

// ==========================================================================
// KOLUMNA MEGA-MENU
// ==========================================================================

describe("kolumna mega-menu: co pokazuje rozwijane menu nawigacji", () => {
  function wierszKategorii(): Record<string, unknown> {
    return { id: "kat-1", name_pl: "Analizy", name_en: "Analyses" };
  }

  function wierszWpisu(id: string): Record<string, unknown> {
    return {
      id,
      slug: `slug-${id}`,
      title_pl: `Tytuł ${id}`,
      title_en: `Title ${id}`,
      cover_image_url: null,
      published_at: "2026-08-01T00:00:00.000Z",
    };
  }

  it("pusty slug wyłącza zapytanie zamiast pytać bazę o nic", () => {
    expect(megaMenuCategoryQueryOptions("", 4, "pl").enabled).toBe(false);
    expect(megaMenuCategoryQueryOptions("analizy", 4, "pl").enabled).toBe(true);
  });

  it("nieistniejąca kategoria kończy sprawę BEZ nazwy i BEZ zapytania o pivot", async () => {
    baza().setResponse("categories", ok(null));
    const dane = await klient().fetchQuery(megaMenuCategoryQueryOptions("nie-ma", 4, "pl"));
    expect(dane).toEqual({ posts: [], catName: "" });
    expect(baza().chainsFor("post_categories")).toHaveLength(0);
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("kategoria bez wpisów zachowuje NAZWĘ kolumny - menu nie gubi nagłówka", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok([]));
    const dane = await klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl"));
    expect(dane).toEqual({ posts: [], catName: "Analizy" });
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it("pivot pobiera z zapasem, a lista wpisów dokładnie tyle, ile ma kolumna", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok([{ post_id: "w-1" }, { post_id: "w-2" }]));
    baza().setResponse("posts", ok([wierszWpisu("w-1")]));
    await klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl"));
    // Zapas x4 pokrywa wpisy, które wypadną na filtrze publikacji/usunięcia.
    expect(ogniwa(lancuch("post_categories"), "limit")).toEqual([[16]]);
    const c = lancuch("posts");
    expect(c.argsOf("in")).toEqual(["id", ["w-1", "w-2"]]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[4]]);
  });

  it("karta menu prowadzi na trasę /post/$slug i znosi brak okładki", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok([{ post_id: "w-1" }]));
    baza().setResponse("posts", ok([wierszWpisu("w-1")]));
    const dane = await klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl"));
    expect(dane.posts).toEqual([
      {
        id: "w-1",
        slug: "slug-w-1",
        title: "Tytuł w-1",
        // Brak okładki to pusty string, nie `null` - karta nie może dostać
        // `src={null}` i wyemitować żądania do adresu „null".
        cover: "",
        href: "/post/slug-w-1",
      },
    ]);
  });

  it("język steruje nazwą kolumny i tytułami kart", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok([{ post_id: "w-1" }]));
    baza().setResponse("posts", ok([wierszWpisu("w-1")]));
    const dane = await klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "en"));
    expect(dane.catName).toBe("Analyses");
    expect(dane.posts[0].title).toBe("Title w-1");
  });

  it("brak wierszy wpisów (null) daje pustą kolumnę z zachowaną nazwą", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok([{ post_id: "w-1" }]));
    baza().setResponse("posts", ok(null));
    const dane = await klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl"));
    expect(dane).toEqual({ posts: [], catName: "Analizy" });
  });

  it("pusta odpowiedź powiązań zachowuje nazwę kategorii i nie pyta o wpisy", async () => {
    baza().setResponse("categories", ok(wierszKategorii()));
    baza().setResponse("post_categories", ok(null));
    await expect(
      klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl")),
    ).resolves.toEqual({ posts: [], catName: "Analizy" });
    expect(baza().chainsFor("posts")).toHaveLength(0);
  });

  it.each(["categories", "post_categories", "posts"])(
    "odmowa %s odrzuca odczyt menu zamiast udawać pustą kategorię",
    async (table) => {
      baza().setResponse("categories", ok(wierszKategorii()));
      baza().setResponse("post_categories", ok([{ post_id: "w-1" }]));
      baza().setResponse("posts", ok([wierszWpisu("w-1")]));
      baza().setResponse(table, fail("odmowa odczytu", "42501"));
      await expect(
        klient().fetchQuery(megaMenuCategoryQueryOptions("analizy", 4, "pl")),
      ).rejects.toThrow("odmowa odczytu");
    },
  );
});

// ==========================================================================
// KONFIGURACJA MOBILNEGO DRAWERA
// ==========================================================================

describe("mobilny drawer: konfiguracja z serwera i domyślna z kodu", () => {
  it("do pierwszego odczytu drawer działa na konfiguracji domyślnej", () => {
    // `initialData` jest tu warunkiem sensu: bez niej pierwszy render mobilny
    // nie miałby czym narysować menu i drawer byłby pusty.
    expect(mobileDrawerConfigQueryOptions.initialData).toBe(DEFAULT_DRAWER_CONFIG);
    expect(mobileDrawerConfigQueryOptions.queryKey).toEqual(["mobile-drawer-config"]);
    expect(mobileDrawerConfigQueryOptions.staleTime).toBe(5 * 60_000);
  });

  it("odświeżenie bierze konfigurację z server fn-a, bez własnego przetwarzania", async () => {
    const konfiguracja: DrawerConfig = {
      ...DEFAULT_DRAWER_CONFIG,
      top_tools: { search: false, theme: true, language: true },
    };
    h.drawer.mockResolvedValue(konfiguracja);
    // `staleTime: 0` wymusza pobranie - z domyślnym oknem `fetchQuery` oddałby
    // `initialData` i `queryFn` nigdy by nie pobiegło.
    const wynik = await klient().fetchQuery({ ...mobileDrawerConfigQueryOptions, staleTime: 0 });
    expect(wynik).toBe(konfiguracja);
    expect(h.drawer).toHaveBeenCalledTimes(1);
  });

  it("ODMOWA server fn-a rzuca - warstwa zapytań nie dokłada cichego fallbacku", async () => {
    // Fallback na konfigurację domyślną należy do `parseDrawerConfig` PO
    // stronie serwera; gdyby połknięcie było i tutaj, awaria zapisu operatora
    // byłaby nie do odróżnienia od świeżej instalacji.
    h.drawer.mockRejectedValue(new Error("odmowa drawera"));
    await expect(
      klient().fetchQuery({ ...mobileDrawerConfigQueryOptions, staleTime: 0 }),
    ).rejects.toThrow("odmowa drawera");
  });
});

// ==========================================================================
// KOLEJNY WPIS DO DOCZYTANIA
// ==========================================================================

describe("kolejny wpis: co doczytuje się pod materiałem", () => {
  const WEJSCIE = {
    currentPostId: "w-1",
    parentPageId: "str-1",
    currentPublishedAt: "2026-08-10T00:00:00.000Z",
  };

  function wierszNastepnego(): Record<string, unknown> {
    return {
      id: "w-2",
      slug: "slug-w-2",
      editor: "richtext",
      title_pl: "Tytuł",
      title_en: "Title",
      excerpt_pl: null,
      excerpt_en: null,
      cover_image_url: null,
      published_at: "2026-08-05T00:00:00.000Z",
      parent_page_id: "str-1",
      is_sponsored: null,
      sponsored_kind: null,
      sponsored_affiliate: null,
    };
  }

  function planujCialo(): void {
    funkcje().setResponse(
      "get_entity_content",
      ok([
        {
          content_pl: "treść pl",
          content_en: null,
          builder_data: null,
          blocks_data: null,
        },
      ]),
    );
  }

  it("szuka w TYM SAMYM dziale, pomija bieżący wpis i bierze jeden, najnowszy", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", ok("analizy"));
    planujCialo();
    await fetchNextPost(WEJSCIE);
    const c = lancuch("posts");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    expect(filtrEq(c, "parent_page_id")).toEqual(["parent_page_id", "str-1"]);
    expect(c.argsOf("neq")).toEqual(["id", "w-1"]);
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[1]]);
    // Filtr chronologiczny jest DOKŁADANY warunkowo - to osobne ogniwo.
    expect(c.argsOf("lt")).toEqual(["published_at", WEJSCIE.currentPublishedAt]);
    // Kolumny ciała NIE MOGĄ być w selekcie - body idzie bramkowanym RPC,
    // inaczej materiał premium wyciekłby do doczytywania.
    const kolumny = String(c.argsOf("select")?.[0]);
    expect(kolumny).toContain(SPONSORED_LIST_COLS);
    expect(kolumny).not.toContain("content_pl");
    expect(kolumny).not.toContain("builder_data");
  });

  it("wpis bez daty publikacji NIE dokłada filtra chronologicznego", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", ok("analizy"));
    planujCialo();
    await fetchNextPost({ ...WEJSCIE, currentPublishedAt: null });
    // Brak ogniwa to inny stan niż ogniwo z `null` - drugie odfiltrowałoby
    // wszystko i doczytywanie milczałoby na każdym szkicu.
    expect(lancuch("posts").has("lt")).toBe(false);
  });

  it("brak kolejnego wpisu daje `null` i NIE pyta o body ani o ścieżkę", async () => {
    baza().setResponse("posts", ok([]));
    await expect(fetchNextPost(WEJSCIE)).resolves.toBeNull();
    expect(funkcje().calls).toHaveLength(0);
  });

  it("brak wierszy (null) też jest brakiem kolejnego wpisu", async () => {
    baza().setResponse("posts", ok(null));
    await expect(fetchNextPost(WEJSCIE)).resolves.toBeNull();
  });

  it("ODMOWA odczytu listy rzuca, zamiast wygasić doczytywanie po cichu", async () => {
    baza().setResponse("posts", fail("odmowa kolejnego", "42501"));
    await expect(fetchNextPost(WEJSCIE)).rejects.toThrow("odmowa kolejnego");
  });

  it("body kolejnego wpisu dokleja się z bramkowanego RPC, nie z selectu", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", ok("analizy"));
    planujCialo();
    const wynik = obecne(await fetchNextPost(WEJSCIE), "kolejnego wpisu");
    expect(wynik.content_pl).toBe("treść pl");
    expect(wynik.href).toBe("/analizy/slug-w-2");
    expect(wywolanie("get_entity_content").arg("_entity_id")).toBe("w-2");
    expect(wywolanie("page_full_path").keys()).toEqual(["_page_id"]);
    expect(wywolanie("page_full_path").arg("_page_id")).toBe("str-1");
  });

  it("czytelnik bez uprawnień dostaje nagłówek i link, ale puste body", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", ok("analizy"));
    // Serwer nie oddaje ciała, bo `has_content_access` jest fałszywe.
    funkcje().setResponse("get_entity_content", ok([]));
    const wynik = obecne(await fetchNextPost(WEJSCIE), "kolejnego wpisu");
    expect(wynik.content_pl).toBeNull();
    expect(wynik.builder_data).toBeNull();
    // Nagłówek i adres zostają - AutoLoadNextPost pokaże sam link.
    expect(wynik.title_pl).toBe("Tytuł");
    expect(wynik.href).toBe("/analizy/slug-w-2");
  });

  it("odmowa ścieżki kolejnego wpisu nie tworzy fałszywego adresu", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", fail("odmowa ścieżki", "42501"));
    planujCialo();
    await expect(fetchNextPost(WEJSCIE)).rejects.toThrow("odmowa ścieżki");
  });

  it("odpowiedź nie-tekstowa z rezolucji też daje prefiks „blog”", async () => {
    baza().setResponse("posts", ok([wierszNastepnego()]));
    funkcje().setResponse("page_full_path", ok(null));
    planujCialo();
    const wynik = obecne(await fetchNextPost(WEJSCIE), "kolejnego wpisu");
    expect(wynik.href).toBe("/blog/slug-w-2");
  });
});

// ==========================================================================
// SERIA / DOSSIER
// ==========================================================================

describe("seria wpisu i strona serii: kolejność części i cztery wyjścia", () => {
  const SERIA = {
    id: "ser-1",
    slug: "dossier-nato",
    name_pl: "Dossier NATO",
    name_en: "NATO dossier",
    description_pl: null,
    description_en: null,
  };

  function czescSerii(
    postId: string,
    numer: number,
    rodzic = "str-1",
    posts: Record<string, unknown> | null = null,
  ): Record<string, unknown> {
    return {
      post_id: postId,
      part_number: numer,
      posts:
        posts === null
          ? {
              slug: `slug-${postId}`,
              title_pl: `Tytuł ${postId}`,
              title_en: `Title ${postId}`,
              cover_image_url: null,
              published_at: "2026-08-01T00:00:00.000Z",
              parent_page_id: rodzic,
              is_sponsored: null,
              sponsored_kind: null,
              sponsored_affiliate: null,
            }
          : posts,
    };
  }

  /** `post_series` obsługuje DWA różne łańcuchy: przypisanie wpisu (kończone
   *  `maybeSingle`) i listę części serii. Bez respondera zależnego od łańcucha
   *  nie da się ich rozdzielić. */
  function planujSerie(przypisanie: unknown, czesci: unknown): void {
    baza().setResponse("post_series", (chain) =>
      chain.has("maybeSingle") ? ok(przypisanie) : ok(czesci),
    );
  }

  it("wpis poza jakąkolwiek serią daje `null` i nie pyta o części", async () => {
    planujSerie(null, []);
    await expect(klient().fetchQuery(postSeriesQueryOptions("w-1"))).resolves.toBeNull();
    expect(baza().chainsFor("post_series")).toHaveLength(1);
  });

  it("przypisanie do serii, której nie widać (RLS), też daje `null`", async () => {
    // Wiersz pivotu istnieje, ale zagnieżdżona seria jest `null` - kod NIE MOŻE
    // zbudować z tego pustej ramki „część 3 z ?" nad wpisem.
    planujSerie({ part_number: 3, series: null }, []);
    await expect(klient().fetchQuery(postSeriesQueryOptions("w-1"))).resolves.toBeNull();
    expect(baza().chainsFor("post_series")).toHaveLength(1);
  });

  it("ODMOWA odczytu przypisania rzuca", async () => {
    baza().setResponse("post_series", fail("odmowa przypisania", "42501"));
    await expect(klient().fetchQuery(postSeriesQueryOptions("w-1"))).rejects.toThrow(
      "odmowa przypisania",
    );
  });

  it("części serii wracają rosnąco po numerze, także gdy baza da inną kolejność", async () => {
    planujSerie({ part_number: 2, series: SERIA }, [
      czescSerii("w-3", 3),
      czescSerii("w-1", 1),
      czescSerii("w-2", 2),
    ]);
    funkcje().setResponse("page_full_path", ok("analizy"));
    const info = obecne(await klient().fetchQuery(postSeriesQueryOptions("w-1")), "serii wpisu");
    // Numer części czytelnika bierze się z PRZYPISANIA, nie z pozycji na liście.
    expect(info.part).toBe(2);
    expect(info.parts.map((p) => p.part_number)).toEqual([1, 2, 3]);
    expect(info.parts.map((p) => p.href)).toEqual([
      "/analizy/slug-w-1",
      "/analizy/slug-w-2",
      "/analizy/slug-w-3",
    ]);
    // Jedno wywołanie rezolucji na RODZICA, nie na część.
    expect(funkcje().callsFor("page_full_path")).toHaveLength(1);
    const cCzesci = baza().chainsFor("post_series")[1];
    expect(filtrEq(cCzesci, "series_id")).toEqual(["series_id", "ser-1"]);
    expect(ogniwa(cCzesci, "order")).toEqual([["part_number", { ascending: true }]]);
    expect(String(cCzesci.argsOf("select")?.[0])).toContain(SPONSORED_LIST_COLS);
  });

  it("część, której wpis jest niewidoczny, NIE tworzy widma w spisie serii", async () => {
    planujSerie({ part_number: 1, series: SERIA }, [
      czescSerii("w-1", 1),
      { post_id: "w-2", part_number: 2, posts: null },
    ]);
    funkcje().setResponse("page_full_path", ok("analizy"));
    const info = obecne(await klient().fetchQuery(postSeriesQueryOptions("w-1")), "serii wpisu");
    expect(info.parts.map((p) => p.post_id)).toEqual(["w-1"]);
  });

  it("części o różnych rodzicach dostają różne prefiksy adresu", async () => {
    planujSerie({ part_number: 1, series: SERIA }, [
      czescSerii("w-1", 1, "str-a"),
      czescSerii("w-2", 2, "str-b"),
    ]);
    funkcje().setResponse("page_full_path", (call) =>
      ok(call.arg("_page_id") === "str-a" ? "analizy" : "raporty"),
    );
    const info = obecne(await klient().fetchQuery(postSeriesQueryOptions("w-1")), "serii wpisu");
    expect(info.parts.map((p) => p.href)).toEqual(["/analizy/slug-w-1", "/raporty/slug-w-2"]);
    expect(funkcje().callsFor("page_full_path")).toHaveLength(2);
  });

  it("nieznana ścieżka rodzica zachowuje konwencję adresu serii", async () => {
    planujSerie({ part_number: 1, series: SERIA }, [czescSerii("w-1", 1)]);
    funkcje().setResponse("page_full_path", ok(null));
    const info = obecne(await klient().fetchQuery(postSeriesQueryOptions("w-1")), "serii wpisu");
    expect(info.parts[0].href).toBe("/blog/slug-w-1");
  });

  it("odmowa ścieżki serii nie tworzy fałszywego adresu", async () => {
    planujSerie({ part_number: 1, series: SERIA }, [czescSerii("w-1", 1)]);
    funkcje().setResponse("page_full_path", fail("odmowa ścieżki", "42501"));
    await expect(klient().fetchQuery(postSeriesQueryOptions("w-1"))).rejects.toThrow(
      "odmowa ścieżki",
    );
  });

  it("ODMOWA odczytu części rzuca - spis serii nie może zniknąć po cichu", async () => {
    baza().setResponse("post_series", (chain) =>
      chain.has("maybeSingle")
        ? ok({ part_number: 1, series: SERIA })
        : fail("odmowa części", "42501"),
    );
    await expect(klient().fetchQuery(postSeriesQueryOptions("w-1"))).rejects.toThrow(
      "odmowa części",
    );
  });

  it("brak wierszy części (null) daje serię z pustym spisem, a nie awarię", async () => {
    planujSerie({ part_number: 1, series: SERIA }, null);
    const info = obecne(await klient().fetchQuery(postSeriesQueryOptions("w-1")), "serii wpisu");
    expect(info.parts).toEqual([]);
    expect(funkcje().callsFor("page_full_path")).toHaveLength(0);
  });

  it("strona serii pod nieistniejącym slugiem daje `null` bez pytania o części", async () => {
    baza().setResponse("series", ok(null));
    await expect(klient().fetchQuery(seriesPageQueryOptions("nie-ma"))).resolves.toBeNull();
    expect(baza().chainsFor("post_series")).toHaveLength(0);
  });

  it("ODMOWA odczytu serii rzuca, zamiast oddać „nie ma takiej serii”", async () => {
    baza().setResponse("series", fail("odmowa serii", "42501"));
    await expect(klient().fetchQuery(seriesPageQueryOptions("dossier-nato"))).rejects.toThrow(
      "odmowa serii",
    );
  });

  it("strona serii oddaje meta i uporządkowany spis części", async () => {
    baza().setResponse("series", ok(SERIA));
    baza().setResponse("post_series", ok([czescSerii("w-2", 2), czescSerii("w-1", 1)]));
    funkcje().setResponse("page_full_path", ok("analizy"));
    const wynik = obecne(
      await klient().fetchQuery(seriesPageQueryOptions("dossier-nato")),
      "serii",
    );
    expect(filtrEq(lancuch("series"), "slug")).toEqual(["slug", "dossier-nato"]);
    expect(wynik.series.slug).toBe("dossier-nato");
    expect(wynik.parts.map((p) => p.part_number)).toEqual([1, 2]);
  });
});

// ==========================================================================
// LAYOUTY PASKA BOCZNEGO - jsonb od operatora
// ==========================================================================

describe("pasek boczny wpisu: layout z bazy i odporność na uszkodzony jsonb", () => {
  function wierszLayoutu(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "lay-1",
      tenant_id: "ten-1",
      name: "Domyślny",
      is_default: true,
      widgets: [],
      created_at: DATA_BAZOWA,
      updated_at: DATA_BAZOWA,
      ...over,
    };
  }

  it("layout domyślny bierze JEDEN wiersz oznaczony flagą", async () => {
    baza().setResponse("post_sidebar_layouts", ok(wierszLayoutu()));
    await klient().fetchQuery(defaultSidebarLayoutQueryOptions());
    const c = lancuch("post_sidebar_layouts");
    expect(filtrEq(c, "is_default")).toEqual(["is_default", true]);
    // `limit(1)` przed `maybeSingle()` jest tu warunkiem sensu: dwa wiersze z
    // flagą (stan możliwy w bazie) wywaliłyby `maybeSingle` błędem.
    expect(ogniwa(c, "limit")).toEqual([[1]]);
    expect(c.has("maybeSingle")).toBe(true);
  });

  it("świeża instalacja bez layoutu daje `null`, nie wyjątek", async () => {
    baza().setResponse("post_sidebar_layouts", ok(null));
    await expect(klient().fetchQuery(defaultSidebarLayoutQueryOptions())).resolves.toBeNull();
  });

  it("ODMOWA odczytu layoutu domyślnego rzuca", async () => {
    baza().setResponse("post_sidebar_layouts", fail("odmowa layoutu", "42501"));
    await expect(klient().fetchQuery(defaultSidebarLayoutQueryOptions())).rejects.toThrow(
      "odmowa layoutu",
    );
  });

  it("brak nadpisania w wpisie wyłącza zapytanie o layout po id", async () => {
    expect(sidebarLayoutByIdQueryOptions(null).enabled).toBe(false);
    expect(sidebarLayoutByIdQueryOptions(undefined).enabled).toBe(false);
    expect(sidebarLayoutByIdQueryOptions("lay-2").enabled).toBe(true);
    await expect(klient().fetchQuery(sidebarLayoutByIdQueryOptions(null))).resolves.toBeNull();
    expect(baza().chains).toHaveLength(0);
  });

  it("layout po id pyta dokładnie o ten wiersz", async () => {
    baza().setResponse("post_sidebar_layouts", ok(wierszLayoutu({ id: "lay-2" })));
    const layout = obecne(
      await klient().fetchQuery(sidebarLayoutByIdQueryOptions("lay-2")),
      "layoutu",
    );
    expect(filtrEq(lancuch("post_sidebar_layouts"), "id")).toEqual(["id", "lay-2"]);
    expect(layout.id).toBe("lay-2");
  });

  it("nadpisanie wskazujące usunięty layout daje `null`", async () => {
    baza().setResponse("post_sidebar_layouts", ok(null));
    await expect(klient().fetchQuery(sidebarLayoutByIdQueryOptions("lay-2"))).resolves.toBeNull();
  });

  it("ODMOWA odczytu layoutu po id rzuca", async () => {
    baza().setResponse("post_sidebar_layouts", fail("odmowa po id", "42501"));
    await expect(klient().fetchQuery(sidebarLayoutByIdQueryOptions("lay-2"))).rejects.toThrow(
      "odmowa po id",
    );
  });

  it("lista layoutów stawia domyślny na czele, a REMISY rozstrzyga nazwą", async () => {
    baza().setResponse("post_sidebar_layouts", ok([wierszLayoutu()]));
    await klient().fetchQuery(allSidebarLayoutsQueryOptions());
    expect(ogniwa(lancuch("post_sidebar_layouts"), "order")).toEqual([
      ["is_default", { ascending: false }],
      ["name", { ascending: true }],
    ]);
  });

  it("PUSTO: brak layoutów oddaje pustą listę", async () => {
    baza().setResponse("post_sidebar_layouts", ok(null));
    await expect(klient().fetchQuery(allSidebarLayoutsQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA odczytu listy layoutów rzuca", async () => {
    baza().setResponse("post_sidebar_layouts", fail("odmowa listy", "42501"));
    await expect(klient().fetchQuery(allSidebarLayoutsQueryOptions())).rejects.toThrow(
      "odmowa listy",
    );
  });

  it("uszkodzony jsonb widgetów NIE wywala paska - zostaje pusta lista", async () => {
    baza().setResponse("post_sidebar_layouts", ok(wierszLayoutu({ widgets: "to nie tablica" })));
    const layout = obecne(
      await klient().fetchQuery(defaultSidebarLayoutQueryOptions()),
      "layoutu domyślnego",
    );
    expect(layout.widgets).toEqual([]);
  });

  it("śmieci w tablicy widgetów są odsiewane, a braki dostają wartości domyślne", async () => {
    baza().setResponse(
      "post_sidebar_layouts",
      ok(
        wierszLayoutu({
          widgets: [
            null,
            "napis",
            42,
            { id: "w-toc", type: "toc", hidden: true, settings: { depth: 2 } },
            // Widget bez id i bez typu: operator zapisał go z panelu, w którym
            // te pola były opcjonalne. Musi dostać własne id, żeby React nie
            // pomieszał kluczy, i typ domyślny, żeby coś się wyrenderowało.
            {},
          ],
        }),
      ),
    );
    const layout = obecne(
      await klient().fetchQuery(defaultSidebarLayoutQueryOptions()),
      "layoutu domyślnego",
    );
    expect(layout.widgets).toEqual([
      { id: "w-toc", type: "toc", hidden: true, settings: { depth: 2 } },
      { id: UUID_STALY, type: "reading-panel", hidden: false, settings: {} },
    ]);
  });

  it("layout awaryjny jest gotowy do renderu BEZ żadnego odczytu z bazy", () => {
    // Świeża instalacja: baza nie ma layoutu, a pasek boczny i tak musi się
    // wyrenderować z panelem czytania.
    const layout = buildFallbackLayout();
    expect(layout.widgets).toEqual([
      {
        id: "fallback-reading",
        type: "reading-panel",
        hidden: false,
        settings: { ...DEFAULT_READING_PANEL_SETTINGS },
      },
    ]);
    expect(layout.is_default).toBe(true);
    expect(baza().chains).toHaveLength(0);
  });
});

// ==========================================================================
// METADANE STRON STATYCZNYCH - jedyne miejsce, gdzie błąd JEST mapowany na null
// ==========================================================================

describe("metadane stron statycznych: skąd bierze się tytuł i robots dla /pricing", () => {
  /** Wiersz metadanych w kształcie, jakiego wymaga `pickStaticSeo` - typ jest
   *  tu ZAWĘŻONY zamiast rzutowany, więc literówka w nazwie kolumny nie
   *  przechodzi przez `tsc` (a `StaticPageSeo` dopuszcza `null`, którego ta
   *  fabryka nigdy nie zwraca). */
  type WierszSeo = NonNullable<StaticPageSeo>;

  function wierszSeo(over: Partial<WierszSeo> = {}): WierszSeo {
    return {
      slug: "pricing",
      title_pl: "Cennik",
      title_en: "Pricing",
      excerpt_pl: "Opis pl",
      excerpt_en: "Opis en",
      seo_title_pl: null,
      seo_title_en: null,
      seo_description_pl: null,
      seo_description_en: null,
      seo_canonical_url: null,
      seo_noindex: false,
      seo_og_image_url: null,
      og_image_generated_url: null,
      ...over,
    };
  }

  it("metadane bierze się z opublikowanej, nieusuniętej strony o tym slugu", async () => {
    baza().setResponse("pages", ok(wierszSeo()));
    const wiersz = await klient().fetchQuery(staticPageSeoQueryOptions("pricing"));
    expect(obecne(wiersz, "wiersza metadanych").slug).toBe("pricing");
    const c = lancuch("pages");
    expect(filtrEq(c, "slug")).toEqual(["slug", "pricing"]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
  });

  it("strona bez wpisu w panelu daje `null` - trasa użyje defaultów marki", async () => {
    baza().setResponse("pages", ok(null));
    await expect(klient().fetchQuery(staticPageSeoQueryOptions("pricing"))).resolves.toBeNull();
  });

  it("błąd odczytu jest zgłaszany: odmowa metadanych", async () => {
    baza().setResponse("pages", fail("odmowa metadanych", "42501"));
    await expect(klient().fetchQuery(staticPageSeoQueryOptions("pricing"))).rejects.toMatchObject({
      message: "odmowa metadanych",
    });
  });

  it("AWARIA odczytu metadanych POWINNA być odróżnialna od strony nieopisanej w panelu", async () => {
    baza().setResponse("pages", fail("odmowa metadanych", "42501"));
    await expect(klient().fetchQuery(staticPageSeoQueryOptions("pricing"))).rejects.toThrow();
  });

  it("brak wiersza oddaje defaulty wołającego, bez indeksowej blokady", () => {
    expect(pickStaticSeo(null, "pl", { title: "Marka", description: "Opis marki" })).toEqual({
      title: "Marka",
      description: "Opis marki",
      canonical: null,
      noindex: false,
      image: null,
    });
  });

  it("nadpisanie SEO wygrywa z tytułem strony, a tytuł strony z defaultem", () => {
    const domyslne = { title: "Marka", description: "Opis marki" };
    expect(pickStaticSeo(wierszSeo({ seo_title_pl: "SEO PL" }), "pl", domyslne).title).toBe(
      "SEO PL",
    );
    // Bez nadpisania zostaje tytuł strony z panelu.
    expect(pickStaticSeo(wierszSeo(), "pl", domyslne).title).toBe("Cennik");
    // Puste pola po obu stronach - default wołającego.
    expect(
      pickStaticSeo(wierszSeo({ title_pl: "", excerpt_pl: "" }), "pl", domyslne),
    ).toMatchObject({ title: "Marka", description: "Opis marki" });
  });

  it("język wybiera kolumnę, a nie wariant tekstu", () => {
    const domyslne = { title: "Marka", description: "Opis marki" };
    expect(pickStaticSeo(wierszSeo({ seo_title_en: "SEO EN" }), "en", domyslne).title).toBe(
      "SEO EN",
    );
    expect(pickStaticSeo(wierszSeo(), "en", domyslne).description).toBe("Opis en");
  });

  it("adres kanoniczny z samych spacji to BRAK adresu, nie pusty `<link>`", () => {
    const domyslne = { title: "Marka", description: "Opis marki" };
    expect(pickStaticSeo(wierszSeo({ seo_canonical_url: "   " }), "pl", domyslne).canonical).toBe(
      null,
    );
    expect(
      pickStaticSeo(wierszSeo({ seo_canonical_url: " https://x/y " }), "pl", domyslne).canonical,
    ).toBe("https://x/y");
  });

  it("blokada indeksacji z panelu przechodzi, a obrazek ma ustaloną kolejność źródeł", () => {
    const domyslne = { title: "Marka", description: "Opis marki" };
    expect(pickStaticSeo(wierszSeo({ seo_noindex: true }), "pl", domyslne).noindex).toBe(true);
    // Ręczne nadpisanie wygrywa z generowanym automatem.
    expect(
      pickStaticSeo(
        wierszSeo({
          seo_og_image_url: "https://x/a.png",
          og_image_generated_url: "https://x/b.png",
        }),
        "pl",
        domyslne,
      ).image,
    ).toBe("https://x/a.png");
    expect(
      pickStaticSeo(wierszSeo({ og_image_generated_url: "https://x/b.png" }), "pl", domyslne).image,
    ).toBe("https://x/b.png");
  });
});

// ==========================================================================
// WEB STORIES
// ==========================================================================

describe("Web Stories: lista i pojedyncza historia", () => {
  function wierszHistorii(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "ws-1",
      tenant_id: "ten-1",
      slug: "historia",
      title_pl: "Historia",
      title_en: "Story",
      description_pl: "",
      description_en: "",
      cover_url: null,
      pages: [{ id: "p1" }],
      status: "published",
      published_at: "2026-08-01T00:00:00.000Z",
      author_id: null,
      created_at: DATA_BAZOWA,
      updated_at: DATA_BAZOWA,
      ...over,
    };
  }

  it("lista bierze tylko opublikowane, od najnowszych, z pustymi datami NA KOŃCU", async () => {
    baza().setResponse("web_stories", ok([wierszHistorii()]));
    await klient().fetchQuery(latestWebStoriesQueryOptions());
    const c = lancuch("web_stories");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    // Cały obiekt opcji jest kontraktem: bez `nullsFirst: false` historie bez
    // daty publikacji wypchnęłyby świeże materiały z początku listy.
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false, nullsFirst: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[8]]);
  });

  it("limit trzyma się widełek 1..50", async () => {
    baza().setResponse("web_stories", ok([]));
    await klient().fetchQuery(latestWebStoriesQueryOptions(0));
    expect(ogniwa(lancuch("web_stories"), "limit")).toEqual([[1]]);

    baza().reset();
    baza().setResponse("web_stories", ok([]));
    await klient().fetchQuery(latestWebStoriesQueryOptions(500));
    expect(ogniwa(lancuch("web_stories"), "limit")).toEqual([[50]]);
  });

  it("uszkodzony jsonb stron historii nie wychodzi z modułu", async () => {
    // `safeParsePages` ma własne testy - tu dowodzę, że warstwa danych ją WOŁA,
    // więc StoryViewer nigdy nie dostanie `pages` innego niż tablica.
    baza().setResponse("web_stories", ok([wierszHistorii({ pages: "to nie tablica" })]));
    const lista = await klient().fetchQuery(latestWebStoriesQueryOptions());
    expect(lista[0].pages).toEqual([]);
  });

  it("PUSTO: brak historii oddaje pustą listę", async () => {
    baza().setResponse("web_stories", ok(null));
    await expect(klient().fetchQuery(latestWebStoriesQueryOptions())).resolves.toEqual([]);
  });

  it("ODMOWA: lista historii rzuca, zamiast wygasić sekcję po cichu", async () => {
    baza().setResponse("web_stories", fail("odmowa historii", "42501"));
    await expect(klient().fetchQuery(latestWebStoriesQueryOptions())).rejects.toThrow(
      "odmowa historii",
    );
  });

  it("pusty slug wyłącza zapytanie o pojedynczą historię", () => {
    expect(webStoryBySlugQueryOptions("").enabled).toBe(false);
    expect(webStoryBySlugQueryOptions("historia").enabled).toBe(true);
  });

  it("pojedyncza historia szuka się po slugu I po statusie", async () => {
    baza().setResponse("web_stories", ok(wierszHistorii()));
    const historia = obecne(
      await klient().fetchQuery(webStoryBySlugQueryOptions("historia")),
      "historii",
    );
    const c = lancuch("web_stories");
    expect(filtrEq(c, "slug")).toEqual(["slug", "historia"]);
    // Szkic nie ma publicznego adresu - bez tego filtra wyciekłby pod URL-em.
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(historia.pages).toHaveLength(1);
  });

  it("nieistniejąca albo nieopublikowana historia daje `null`", async () => {
    baza().setResponse("web_stories", ok(null));
    await expect(klient().fetchQuery(webStoryBySlugQueryOptions("historia"))).resolves.toBeNull();
  });

  it("ODMOWA odczytu pojedynczej historii rzuca", async () => {
    baza().setResponse("web_stories", fail("odmowa historii", "42501"));
    await expect(klient().fetchQuery(webStoryBySlugQueryOptions("historia"))).rejects.toThrow(
      "odmowa historii",
    );
  });
});
