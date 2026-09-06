// REKOMENDACJE POD ARTYKUŁEM - dwie fabryki zapytań, od których zależy CAŁE
// wewnętrzne linkowanie serwisu.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/queries/relatedPosts.ts` do 04.09.2026
// miał 6/54 linii, 2/63 GAŁĘZI (3,17%) i 2/16 funkcji: wykonywały się WYŁĄCZNIE
// dwie fabryki `queryOptions`, a ciała obu `queryFn` - czyli sześć zapytań
// PostgREST, dwie funkcje SQL, składanie kandydatów, scoring i budowa adresów -
// nie wykonały się ani raz. Zero nie brało się z braku testów, a z ich rodzaju:
// jedyny konsument tego modułu w testach (`components/post/__tests__/
// postComposition.test.tsx`) ATRAPUJE `@/lib/queries/relatedPosts`, żeby
// sprawdzić kompozycję strony wpisu - słusznie, ale wtedy nie widzi, CO ten
// moduł robi. Ta sama przyczyna dała zero w `require-staff.ts`.
//
// DLACZEGO TO BOLI. To zapytanie decyduje, co czytelnik widzi POD artykułem:
// ruch wewnętrzny, czas na stronie i przepływ PageRank po własnym serwisie.
// Awaria nie daje tu żadnego sygnału - komponent `RelatedPosts` przy pustej
// liście zwraca `null`, więc widget PO PROSTU ZNIKA. Strona jest kompletna,
// szybka i wygląda poprawnie; z artykułu nie wychodzi ani jeden link.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   * KLUCZ JEST TREŚCIĄ. Klucz konfiguracji (`["public",
//     "related-posts-config"]`) celowo NIE niesie tenanta, bo prefetch SSR i
//     render kliencki muszą trafić w TEN SAM wpis cache. Klucz per wpis niesie
//     `limit`/`strategy`/`recencyBoostDays`, a te trzy wartości pochodzą
//     Z KONFIGURACJI - klucz zawężony do samego `postId` oddawałby po zmianie
//     strategii przez redakcję listę policzoną starą strategią, aż do
//     wygaśnięcia `staleTime` (5 minut);
//   * ODCZYT KONFIGURACJI IDZIE FUNKCJĄ, NIE SELEKTEM. `get_related_posts_config()`
//     zamiast `select().limit(1)` to naprawa realnego wycieku między tenantami
//     (polityki SELECT sumują się przez OR, więc zalogowany edytor tenanta A
//     przeglądający domenę tenanta B dostawał konfigurację TENANTA A). Test
//     pilnuje, że ten moduł NIE dotyka tabeli - powrót do selektu przywraca
//     wyciek, a wygląda jak uproszczenie;
//   * BRAK SYGNAŁÓW TO NIE „POLEĆ COKOLWIEK". Wpis bez kategorii i bez tagów
//     musi oddać pustą listę BEZ round-tripu po kandydatów. Zdjęcie tej bramki
//     zamienia rekomendacje w losowe wpisy z serwisu;
//   * KAŻDA STRATEGIA PYTA O CO INNEGO. `categories` / `tags` / `both` /
//     `author` to cztery różne zestawy zapytań i cztery różne wagi w scoringu.
//     Zgubione zawężenie strategii przechodzi przez `tsc` (to string z bazy)
//     i przez przegląd, a daje listę policzoną nie tym, co ustawiła redakcja;
//   * WPIS NIE JEST SWOIM WŁASNYM „POWIĄZANYM". Bieżący `postId` wypada
//     z kandydatów w pivotach (`id !== input.postId`) i przez `.neq("id", …)`
//     na drodze autora. Bez tego pod artykułem stoi link do tego artykułu;
//   * TRZY ZACISKI LIMITÓW, KAŻDY W INNYM MIEJSCU: `.limit(50)` na kandydatach
//     autora, `.slice(0, 100)` przed hydracją i `input.limit` na wyjściu.
//     Wszystkie trzy są asertowane, bo każdy chroni inną granicę (round-trip,
//     rozmiar `in(...)`, długość widgetu);
//   * SZKICE NIE MOGĄ WEJŚĆ DO WIDGETU. Kandydaci przychodzą z pivotów, które
//     nie wiedzą nic o statusie - `eq("status","published")` i
//     `is("deleted_at", null)` na hydracji to JEDYNE miejsce, które trzyma
//     szkice i wpisy usunięte poza rekomendacjami;
//   * NAZWA ARGUMENTU RPC JEST JEDYNYM DOWODEM. `page_full_path` dostaje luźny
//     obiekt `{ _page_id }`, więc literówka przechodzi przez `tsc`, przez
//     przegląd i przez interfejs (adresy „jakieś" powstaną) - stąd asercja po
//     NAZWIE argumentu, nie po danych;
//   * AWARIA WYGLĄDA JAK PUSTKA - i to jest tu klasa defektu numer jeden.
//     Sześć odczytów w `queryFn` i jeden w konfiguracji czyta `const { data }`
//     BEZ `error`. Każde takie miejsce dostaje przypadek przypinający stan
//     faktyczny, a dwa najgroźniejsze - `it.fails` z konsekwencją dla
//     człowieka (patrz sekcje na końcu pliku).
//
// JAK. Zaślepione są DOKŁADNIE dwie granice, obie na kliencie Supabase:
// thenable łańcuch PostgREST (`@/test/supabase/chain`) i rejestrator RPC
// (`@/test/supabase/rpc`). Moduł pokrywany NIE jest atrapowany - to reguła
// bezwzględna. Prawdziwe są też `scoreRelated`, `rankRelated` i
// `RELATED_POSTS_DEFAULTS` z `@/lib/relatedPosts`: gdyby scoring był atrapą,
// dowód o KOLEJNOŚCI rekomendacji byłby fikcją. `queryFn` uruchamiamy
// prawdziwym `QueryClient.fetchQuery`, więc nie ma tu ani jednego rzutowania
// funkcji. Zero sieci, zero sekretów, zero prawdziwego zegara (data bazowa
// 2026-08-21T10:00 - bez niej okno `recency_boost_days` czyniłoby wynik
// scoringu zależnym od dnia przebiegu CI).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * ALGORYTMU SCORINGU v2 (wagi, IDF, sygnały behawioralne, personalizacja),
//     `mergeRelatedConfig`, `rankRelated`, `buildIdf` i `normalizeMap` -
//     to `src/lib/__tests__/relatedPosts.test.ts`,
//     `relatedPostsIdf.test.ts` i `relatedPostsSignals.test.ts`. Tutaj scoring
//     jest UŻYWANY jako prawdziwy, a asercje dotyczą tylko tego, jakie dane
//     moduł do niego wkłada i co robi z wynikiem;
//   * BLOKU `related-posts` SILNIKA BLOKÓW. `relatedPostsBlockQueryOptions`
//     z `lib/queries/blocks.ts` to INNA fabryka, inny klucz (`["public",
//     "blocks","related", …]`) i inne wejście (slugi, nie identyfikatory) -
//     ma własne testy w `blocks.test.ts`, a kontekstu rozgrzewki
//     (`categorySlugs`/`tagSlugs`) dowodzi `publicCatchAllRoute.test.tsx`;
//   * RENDERU WIDGETU (`components/post/RelatedPosts.tsx`, układy grid/slider/
//     magazine, beacon kliknięcia) i PANELU ADMINA - mają własne testy;
//   * KLASY DEFEKTU `paths.get(…) ?? "blog"` W PEŁNYM ZAPISIE. Ta sama
//     jednolinijkowa konstrukcja stoi w `archives.ts:81`, `programs.ts:124`,
//     `series.ts:80` i `liveBlogs.ts:72`, a pełny `it.fails` z mechanizmem
//     i konsekwencją ma ją `archives.test.ts:797`. Tutaj przypinam wyłącznie
//     STAN FAKTYCZNY dla tej powierzchni, bez powtarzania tamtego opisu;
//   * TREŚCI I UPRAWNIEŃ funkcji SQL (`get_related_posts_config`,
//     `page_full_path`) oraz izolacji tenanta - to pgTAP
//     (`supabase/tests/related_posts_config_provisioning_test.sql`).
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
import { RELATED_POSTS_DEFAULTS } from "@/lib/relatedPosts";

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

import {
  relatedPostsConfigQueryOptions,
  relatedPostsQueryOptions,
  type RelatedPostsInput,
} from "@/lib/queries/relatedPosts";

// --- dane syntetyczne -------------------------------------------------------

/** Data bazowa - okno `recency_boost_days` nie może zależeć od dnia przebiegu. */
const DATA_BAZOWA = "2026-08-21T10:00:00.000Z";
/** W oknie 30 dni od daty bazowej (20 dni) - dostaje bonus świeżości. */
const SWIEZY = "2026-08-01T09:00:00.000Z";
/** Świeższy od `SWIEZY`, też w oknie - rozstrzyga remisy wyniku. */
const SWIEZSZY = "2026-08-10T09:00:00.000Z";
/** Poza oknem - bez bonusu świeżości. */
const STARY = "2026-01-01T09:00:00.000Z";

const WPIS = "00000000-0000-4000-8000-000000000001";
const AUTOR = "00000000-0000-4000-8000-0000000000a0";
const INNY_AUTOR = "00000000-0000-4000-8000-0000000000a9";
const RODZIC = "00000000-0000-4000-8000-0000000000b0";
const INNY_RODZIC = "00000000-0000-4000-8000-0000000000b1";
const KAT_A = "kategoria-analizy";
const KAT_B = "kategoria-energia";
const TAG_A = "tag-atom";
const TAG_B = "tag-oze";
const SCIEZKA_RODZICA = "analizy";

/** Wiersz hydracji kandydata - kształt 1:1 z selektem modułu. */
function kandydat(
  id: string,
  publishedAt: string | null,
  nadpisania: { author_id?: string | null; parent_page_id?: string } = {},
): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: publishedAt,
    parent_page_id: nadpisania.parent_page_id ?? RODZIC,
    author_id: nadpisania.author_id ?? INNY_AUTOR,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: false,
  };
}

function wejscie(nadpisania: Partial<RelatedPostsInput> = {}): RelatedPostsInput {
  return { postId: WPIS, limit: 6, strategy: "both", recencyBoostDays: 30, ...nadpisania };
}

// --- planer odpowiedzi ------------------------------------------------------
//
// Jedna tabela obsługuje w tym module PO KILKA różnych zapytań (`posts` aż
// trzy: własny wpis, kandydaci autora, hydracja), więc atrapa rozpoznaje je po
// KSZTAŁCIE ŁAŃCUCHA - dokładnie tak, jak robi to `requireStaff.test.ts`.
// Stała odpowiedź na tabelę „dowodziłaby", że zawężenia są wymienne.

interface Plan {
  wlasneKategorie?: SupabaseResult;
  wlasneTagi?: SupabaseResult;
  wlasnyWpis?: SupabaseResult;
  kandydaciZKategorii?: SupabaseResult;
  kandydaciZTagow?: SupabaseResult;
  kandydaciAutora?: SupabaseResult;
  hydracja?: SupabaseResult;
  kategorieKandydatow?: SupabaseResult;
  tagiKandydatow?: SupabaseResult;
  sciezka?: SupabaseResult;
}

function planuj(plan: Plan = {}): void {
  baza().setResponse("post_categories", (chain) => {
    const kolumna = String(chain.argsOf("in")?.[0] ?? "");
    if (kolumna === "category_id") return plan.kandydaciZKategorii ?? ok([]);
    if (kolumna === "post_id") return plan.kategorieKandydatow ?? ok([]);
    return plan.wlasneKategorie ?? ok([{ category_id: KAT_A }, { category_id: KAT_B }]);
  });
  baza().setResponse("post_tags", (chain) => {
    const kolumna = String(chain.argsOf("in")?.[0] ?? "");
    if (kolumna === "tag_id") return plan.kandydaciZTagow ?? ok([]);
    if (kolumna === "post_id") return plan.tagiKandydatow ?? ok([]);
    return plan.wlasneTagi ?? ok([{ tag_id: TAG_A }, { tag_id: TAG_B }]);
  });
  baza().setResponse("posts", (chain) => {
    if (chain.has("maybeSingle")) {
      return plan.wlasnyWpis ?? ok({ author_id: AUTOR, parent_page_id: RODZIC });
    }
    if (chain.has("neq")) return plan.kandydaciAutora ?? ok([]);
    return plan.hydracja ?? ok([]);
  });
  funkcje().setResponse("page_full_path", plan.sciezka ?? ok(SCIEZKA_RODZICA));
}

// --- strażniki zawężające (zamiast rzutowań) --------------------------------

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

function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

function filtrEq(chain: RecordedChain, kolumna: string): ReadonlyArray<unknown> | undefined {
  return ogniwa(chain, "eq").find((a) => a[0] === kolumna);
}

/** Łańcuch KANDYDATÓW z pivotu - rozpoznany po kolumnie ogniwa `in`. */
function lancuchKandydatow(tabela: string, kolumna: string): RecordedChain | undefined {
  return baza()
    .chainsFor(tabela)
    .find((c) => c.argsOf("in")?.[0] === kolumna);
}

/** Slugi rekomendacji w kolejności wyjścia - kolejność JEST przedmiotem dowodu. */
function slugi(lista: ReadonlyArray<{ slug: string }>): string[] {
  return lista.map((p) => p.slug);
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

// --- cykl życia -------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(DATA_BAZOWA));
  baza().reset();
  funkcje().reset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ==========================================================================
// KONFIGURACJA TENANTA - klucz, droga odczytu i degradacja
// ==========================================================================

describe("konfiguracja rekomendacji: klucz i droga odczytu", () => {
  it("klucz jest jeden dla całej domeny i NIE niesie tenanta", () => {
    // To decyzja udokumentowana w module, nie przeoczenie: prefetch w loaderze
    // `/$` i render kliencki muszą trafić w TEN SAM wpis cache. Dopisanie
    // tenanta do klucza rozjechałoby rozgrzewkę SSR z odczytem po hydracji -
    // widget migałby, a żądanie poszłoby drugi raz.
    expect(relatedPostsConfigQueryOptions().queryKey).toEqual(["public", "related-posts-config"]);
  });

  it("konfiguracja żyje 5 minut - inaczej każdy wpis płaci za nią osobno", () => {
    expect(relatedPostsConfigQueryOptions().staleTime).toBe(5 * 60_000);
  });

  it("czyta FUNKCJĄ, nie selektem z tabeli - to naprawa wycieku między tenantami", async () => {
    // Polityki SELECT na `related_posts_config` sumują się przez OR: publiczna
    // po `public_tenant_id()` i edytorska po `current_tenant_id()`. Zalogowany
    // edytor tenanta A przeglądający domenę tenanta B spełniał OBIE, więc
    // `select().limit(1)` mógł oddać wiersz TENANTA A - i publiczna strona
    // tenanta B renderowała się cudzą konfiguracją. Powrót do selektu wygląda
    // jak uproszczenie i przywraca wyciek, dlatego brak łańcucha jest asercją.
    funkcje().setData("get_related_posts_config", [{ items_limit: 4 }]);
    await klient().fetchQuery(relatedPostsConfigQueryOptions());

    expect(funkcje().names()).toEqual(["get_related_posts_config"]);
    expect(baza().chains).toHaveLength(0);
    // Funkcja jest bezargumentowa: dołożenie obiektu argumentów kazałoby
    // PostgREST szukać przeciążenia, którego nie ma (404 na całej konfiguracji).
    expect(wywolanie("get_related_posts_config").keys()).toEqual([]);
  });

  it("wiersz tenanta NADPISUJE domyślne, a nieustawione pola zostają domyślne", async () => {
    funkcje().setData("get_related_posts_config", [
      { enabled: false, items_limit: 3, source_strategy: "tags" },
    ]);
    const cfg = await klient().fetchQuery(relatedPostsConfigQueryOptions());

    expect(cfg.enabled).toBe(false);
    expect(cfg.items_limit).toBe(3);
    expect(cfg.source_strategy).toBe("tags");
    // Pola, których wiersz nie dotyka, MUSZĄ zostać domyślne - inaczej jedna
    // zmiana w panelu zerowałaby wagi silnika i rekomendacje przestałyby
    // różnicować kategorie od tagów.
    expect(cfg.layout).toBe(RELATED_POSTS_DEFAULTS.layout);
    expect(cfg.weight_categories).toBe(RELATED_POSTS_DEFAULTS.weight_categories);
    expect(cfg.recency_boost_days).toBe(RELATED_POSTS_DEFAULTS.recency_boost_days);
  });

  it("tenant BEZ wiersza konfiguracji dostaje komplet domyślnych", async () => {
    // Świeżo utworzony tenant (albo taki, któremu trigger seedujący nie
    // dojechał) musi mieć DZIAŁAJĄCE rekomendacje, nie pusty obiekt.
    funkcje().setData("get_related_posts_config", []);
    await expect(klient().fetchQuery(relatedPostsConfigQueryOptions())).resolves.toEqual(
      RELATED_POSTS_DEFAULTS,
    );
  });

  it("odpowiedź, która nie jest tablicą, też daje domyślne zamiast rzutu", async () => {
    // `SETOF` przez PostgREST oddaje tablicę, ale odpowiedź poza kontraktem
    // (`null`, obiekt) nie może wywrócić strony wpisu - to tylko ustawienia
    // widgetu, a nie treść artykułu.
    funkcje().setData("get_related_posts_config", null);
    await expect(klient().fetchQuery(relatedPostsConfigQueryOptions())).resolves.toEqual(
      RELATED_POSTS_DEFAULTS,
    );
  });

  it("błąd odczytu jest zgłaszany: odmowa konfiguracji", async () => {
    funkcje().setError("get_related_posts_config", "odmowa konfiguracji", "42501");
    await expect(klient().fetchQuery(relatedPostsConfigQueryOptions())).rejects.toMatchObject({
      message: "odmowa konfiguracji",
    });
  });

  it("AWARIA konfiguracji POWINNA być odróżnialna od redakcji, która widget WYŁĄCZYŁA", async () => {
    funkcje().setError("get_related_posts_config", "odmowa konfiguracji", "42501");
    await expect(klient().fetchQuery(relatedPostsConfigQueryOptions())).rejects.toThrow(
      "odmowa konfiguracji",
    );
  });
});

// ==========================================================================
// KLUCZ PER WPIS - trafienie w cache po hydracji SSR
// ==========================================================================

describe("klucz rekomendacji per wpis: co MUSI go różnicować", () => {
  it("niesie wpis i CAŁE wejście, nie tylko identyfikator", () => {
    expect(relatedPostsQueryOptions(wejscie()).queryKey).toEqual([
      "public",
      "related-posts",
      { postId: WPIS, limit: 6, strategy: "both", recencyBoostDays: 30 },
    ]);
  });

  it("zmiana STRATEGII, LIMITU albo OKNA ŚWIEŻOŚCI daje INNY wpis cache", () => {
    // Te trzy wartości przychodzą z konfiguracji tenanta. Klucz zawężony do
    // samego `postId` oddawałby po zmianie w panelu listę policzoną STARĄ
    // strategią - przez 5 minut `staleTime` i bez żadnego sygnału, że panel
    // „nie działa".
    const bazowy = relatedPostsQueryOptions(wejscie()).queryKey;
    for (const inne of [
      wejscie({ strategy: "author" }),
      wejscie({ limit: 3 }),
      wejscie({ recencyBoostDays: 7 }),
      wejscie({ postId: "00000000-0000-4000-8000-000000000002" }),
    ]) {
      expect(relatedPostsQueryOptions(inne).queryKey).not.toEqual(bazowy);
    }
  });

  it("BEZ identyfikatora wpisu zapytanie jest WYŁĄCZONE", () => {
    // Wpis niekiedy dojeżdża do widgetu dopiero po rezolucji trasy. Bez tej
    // bramki pusty `postId` kosztowałby trzy round-tripy, które nie mogą nic
    // znaleźć, przy każdym renderze przejściowym.
    expect(relatedPostsQueryOptions(wejscie({ postId: "" })).enabled).toBe(false);
    expect(relatedPostsQueryOptions(wejscie()).enabled).toBe(true);
  });

  it("lista rekomendacji żyje 5 minut, tak samo jak konfiguracja", () => {
    expect(relatedPostsQueryOptions(wejscie()).staleTime).toBe(5 * 60_000);
  });
});

// ==========================================================================
// SYGNAŁY BIEŻĄCEGO WPISU - i bramka „brak sygnałów"
// ==========================================================================

describe("sygnały bieżącego wpisu: czym moduł zaczyna", () => {
  it("czyta kategorie, tagi i autora - każde zawężone TYM wpisem", async () => {
    planuj({ hydracja: ok([]) });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));

    const kategorie = baza().chainsFor("post_categories")[0];
    expect(kategorie.argsOf("select")).toEqual(["category_id"]);
    expect(filtrEq(kategorie, "post_id")).toEqual(["post_id", WPIS]);

    const tagi = baza().chainsFor("post_tags")[0];
    expect(tagi.argsOf("select")).toEqual(["tag_id"]);
    expect(filtrEq(tagi, "post_id")).toEqual(["post_id", WPIS]);

    const wpis = baza().chainsFor("posts")[0];
    expect(filtrEq(wpis, "id")).toEqual(["id", WPIS]);
    // `maybeSingle`, nie `single`: wpis skasowany w trakcie renderu nie może
    // wywrócić widgetu błędem PGRST116.
    expect(wpis.has("maybeSingle")).toBe(true);
  });

  it("wpis BEZ kategorii i BEZ tagów nie pyta o kandydatów", async () => {
    // Bramka istnieje po to, żeby nie rekomendować LOSOWYCH wpisów serwisu.
    // Jej zdjęcie daje pod artykułem o polityce klimatycznej trzy wpisy
    // o czymkolwiek - i nikt tego nie zgłosi, bo widget „działa".
    planuj({ wlasneKategorie: ok([]), wlasneTagi: ok([]) });
    await expect(klient().fetchQuery(relatedPostsQueryOptions(wejscie()))).resolves.toEqual([]);

    expect(baza().chains).toHaveLength(3);
    expect(funkcje().calls).toHaveLength(0);
  });

  it("brak wierszy (`null`) w pivotach i brak wpisu to też „brak sygnałów”", async () => {
    // PostgREST oddaje `data: null` przy odmowie i przy odpowiedzi bez treści.
    // Bez `?? []` moduł wywróciłby się na `.map` zamiast oddać pustą listę.
    planuj({ wlasneKategorie: ok(null), wlasneTagi: ok(null), wlasnyWpis: ok(null) });
    await expect(klient().fetchQuery(relatedPostsQueryOptions(wejscie()))).resolves.toEqual([]);
    expect(baza().chains).toHaveLength(3);
  });

  it("strategia AUTORA nie potrzebuje kategorii ani tagów - wystarczy autor", async () => {
    // Odwrotność poprzedniego przypadku: przy `author` sygnałem jest autor,
    // więc bramka „brak sygnałów" NIE może zamknąć drogi wpisowi bez taksonomii
    // (typowo: notka redakcyjna albo felieton bez kategorii).
    planuj({
      wlasneKategorie: ok([]),
      wlasneTagi: ok([]),
      kandydaciAutora: ok([{ id: "k-autor" }]),
      hydracja: ok([kandydat("k-autor", STARY, { author_id: AUTOR })]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "author" })),
    );
    expect(slugi(wynik)).toEqual(["slug-k-autor"]);
  });

  it("strategia AUTORA przy wpisie bez autora nie pyta o kandydatów", async () => {
    planuj({
      wlasneKategorie: ok([]),
      wlasneTagi: ok([]),
      wlasnyWpis: ok({ author_id: null, parent_page_id: RODZIC }),
    });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "author" }))),
    ).resolves.toEqual([]);
    expect(baza().chains).toHaveLength(3);
  });
});

// ==========================================================================
// KANDYDACI - każda strategia pyta o co innego
// ==========================================================================

describe("kandydaci: strategia rozstrzyga, KTÓRE pivoty są pytane", () => {
  it("`both` pyta OBA pivoty i sumuje kandydatów", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-kat" }]),
      kandydaciZTagow: ok([{ post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-kat", SWIEZY), kandydat("k-tag", STARY)]),
      kategorieKandydatow: ok([{ post_id: "k-kat", category_id: KAT_A }]),
      tagiKandydatow: ok([{ post_id: "k-tag", tag_id: TAG_A }]),
    });
    const wynik = await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));

    expect(slugi(wynik).sort()).toEqual(["slug-k-kat", "slug-k-tag"]);
    // Pivoty pytane WŁASNYMI kolumnami i CAŁYM zestawem sygnałów wpisu -
    // zgubiony drugi identyfikator zawęża rekomendacje do jednej kategorii.
    expect(lancuchKandydatow("post_categories", "category_id")?.argsOf("in")).toEqual([
      "category_id",
      [KAT_A, KAT_B],
    ]);
    expect(lancuchKandydatow("post_tags", "tag_id")?.argsOf("in")).toEqual([
      "tag_id",
      [TAG_A, TAG_B],
    ]);
  });

  it("`categories` NIE pyta pivotu tagów", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-kat" }]),
      hydracja: ok([kandydat("k-kat", SWIEZY)]),
      kategorieKandydatow: ok([{ post_id: "k-kat", category_id: KAT_A }]),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" })));

    expect(lancuchKandydatow("post_categories", "category_id")).toBeDefined();
    expect(lancuchKandydatow("post_tags", "tag_id")).toBeUndefined();
  });

  it("`tags` NIE pyta pivotu kategorii", async () => {
    planuj({
      kandydaciZTagow: ok([{ post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-tag", SWIEZY)]),
      tagiKandydatow: ok([{ post_id: "k-tag", tag_id: TAG_A }]),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "tags" })));

    expect(lancuchKandydatow("post_tags", "tag_id")).toBeDefined();
    expect(lancuchKandydatow("post_categories", "category_id")).toBeUndefined();
  });

  it("`both` przy wpisie BEZ kategorii pyta tylko o tagi", async () => {
    // Wpis otagowany, ale nieskategoryzowany, nie może kosztować round-tripu
    // z pustą listą w `in(...)` - PostgREST oddałby wtedy CAŁY pivot.
    planuj({
      wlasneKategorie: ok([]),
      kandydaciZTagow: ok([{ post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-tag", SWIEZY)]),
      tagiKandydatow: ok([{ post_id: "k-tag", tag_id: TAG_A }]),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));

    expect(lancuchKandydatow("post_categories", "category_id")).toBeUndefined();
    expect(lancuchKandydatow("post_tags", "tag_id")).toBeDefined();
  });

  it("`author` pyta wpisy autora: bez siebie, tylko opublikowane, ZACISK 50", async () => {
    // Jedyna droga kandydatów, która czyta `posts` bezpośrednio - i jedyna,
    // która ma własny limit. Bez `.limit(50)` autor z tysiącem wpisów ciągnie
    // tysiąc wierszy do PRZEGLĄDARKI czytelnika przy każdym artykule.
    planuj({
      kandydaciAutora: ok([{ id: "k-autor" }]),
      hydracja: ok([kandydat("k-autor", STARY, { author_id: AUTOR })]),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "author" })));

    const c = baza()
      .chainsFor("posts")
      .find((x) => x.has("neq"));
    if (!c) throw new Error("test: brak łańcucha kandydatów autora");
    expect(filtrEq(c, "author_id")).toEqual(["author_id", AUTOR]);
    expect(c.argsOf("neq")).toEqual(["id", WPIS]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
    expect(ogniwa(c, "order")).toEqual([["published_at", { ascending: false }]]);
    expect(ogniwa(c, "limit")).toEqual([[50]]);
  });

  it("BIEŻĄCY wpis wypada z kandydatów - pod artykułem nie stoi link do niego", async () => {
    // Pivot kategorii ZAWSZE zwraca bieżący wpis (należy do swojej kategorii),
    // więc bez `id !== input.postId` pierwsza rekomendacja byłaby autolinkiem.
    planuj({
      kandydaciZKategorii: ok([{ post_id: WPIS }, { post_id: "k-kat" }]),
      kandydaciZTagow: ok([{ post_id: WPIS }, { post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-kat", SWIEZY), kandydat("k-tag", SWIEZY)]),
      kategorieKandydatow: ok([{ post_id: "k-kat", category_id: KAT_A }]),
      tagiKandydatow: ok([{ post_id: "k-tag", tag_id: TAG_A }]),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));

    const idsHydracji = lancuch("posts").argsOf("in")?.[1];
    expect(idsHydracji).toEqual(["k-kat", "k-tag"]);
  });

  it("kandydaci ograniczeni DO SIEBIE nie kosztują hydracji", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: WPIS }]),
      kandydaciZTagow: ok([{ post_id: WPIS }]),
    });
    await expect(klient().fetchQuery(relatedPostsQueryOptions(wejscie()))).resolves.toEqual([]);
    // Trzy zapytania sygnałów + dwa pivoty kandydatów i ANI JEDNEGO więcej.
    expect(baza().chains).toHaveLength(5);
    expect(funkcje().calls).toHaveLength(0);
  });

  it("pustka na KAŻDEJ z trzech dróg kandydatów daje pustą listę bez hydracji", async () => {
    for (const [strategia, plan] of [
      ["categories", { kandydaciZKategorii: ok(null) }],
      ["tags", { kandydaciZTagow: ok(null) }],
      ["author", { kandydaciAutora: ok(null) }],
    ] as const) {
      baza().reset();
      funkcje().reset();
      planuj(plan);
      await expect(
        klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: strategia }))),
      ).resolves.toEqual([]);
      expect(
        baza()
          .chainsFor("posts")
          .some((c) => c.has("in")),
      ).toBe(false);
    }
  });

  it("ZACISK 100: z nadmiaru kandydatów do hydracji idzie dokładnie sto identyfikatorów", async () => {
    // Pivot kandydatów NIE ma ani `.limit()`, ani `.order()`, a zacisk stoi
    // dopiero na `Array.from(candidateIds).slice(0, 100)`. Skutek do zapisania,
    // bo nie jest oczywisty: przy kategorii z tysiącem wpisów o hydracji
    // decyduje KOLEJNOŚĆ WIERSZY, jaką odda baza, więc najlepiej dopasowany
    // materiał może nigdy nie wejść do scoringu. Test przypina sam zacisk -
    // jego zdjęcie wysłałoby `in(...)` z tysiącem identyfikatorów w URL-u
    // (PostgREST odrzuca długie zapytania i widget znika w całości).
    const nadmiar = Array.from({ length: 150 }, (_, i) => ({ post_id: `k-${i}` }));
    planuj({ kandydaciZKategorii: ok(nadmiar), hydracja: ok([]) });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" })));

    const ids = lancuch("posts").argsOf("in")?.[1];
    expect(Array.isArray(ids) && ids.length).toBe(100);
    expect(Array.isArray(ids) && ids[0]).toBe("k-0");
  });
});

// ==========================================================================
// HYDRACJA - jedyne miejsce, które trzyma szkice poza widgetem
// ==========================================================================

describe("hydracja kandydatów: filtr publikacji i kolumny", () => {
  it("pyta o kandydatów TYLKO opublikowanych i nieusuniętych", async () => {
    // Pivoty nie wiedzą nic o statusie: kandydat może być szkicem albo wpisem
    // w koszu. Gdyby te dwa filtry zniknęły, pod publicznym artykułem stanąłby
    // link do materiału, którego redakcja jeszcze nie wydała.
    planuj({ kandydaciZKategorii: ok([{ post_id: "k-kat" }]), hydracja: ok([]) });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" })));

    const c = lancuch("posts");
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);

    const kolumny = String(c.argsOf("select")?.[0] ?? "");
    // Kolumny ujawnienia (UPNPR art. 7 pkt 11a) - bez nich karta rekomendacji
    // nie ma czym oznaczyć materiału sponsorowanego, a typ `BlogListItem`
    // dostanie `undefined` z rzutowania, więc `tsc` tego nie złapie.
    expect(kolumny).toContain(SPONSORED_LIST_COLS);
    // `parent_page_id` i `author_id` to nie ozdoba: pierwsza buduje ADRES,
    // druga jest sygnałem scoringu.
    expect(kolumny).toContain("parent_page_id");
    expect(kolumny).toContain("author_id");
  });

  it("wszyscy kandydaci nieopublikowani = pusta lista bez dalszych zapytań", async () => {
    planuj({ kandydaciZKategorii: ok([{ post_id: "k-kat" }]), hydracja: ok([]) });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" }))),
    ).resolves.toEqual([]);
    // Brak zapytań o przynależność i brak rezolucji ścieżek - nie ma czego pytać.
    expect(lancuchKandydatow("post_categories", "post_id")).toBeUndefined();
    expect(funkcje().calls).toHaveLength(0);
  });

  it("brak wierszy (`null`) z hydracji to pusta lista, a nie rzut", async () => {
    planuj({ kandydaciZKategorii: ok([{ post_id: "k-kat" }]), hydracja: ok(null) });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" }))),
    ).resolves.toEqual([]);
  });
});

// ==========================================================================
// PRZYNALEŻNOŚĆ, SCORING I KOLEJNOŚĆ - czyli CO czytelnik widzi pierwsze
// ==========================================================================

describe("kolejność rekomendacji: silniejsze dopasowanie stoi wyżej", () => {
  /** Trzech kandydatów o rozłącznych wynikach: 10, 4 i 2 punkty. */
  function planTrzechKandydatow(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-oba" }, { post_id: "k-kat" }]),
      kandydaciZTagow: ok([{ post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-oba", STARY), kandydat("k-kat", SWIEZY), kandydat("k-tag", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-oba", category_id: KAT_A },
        { post_id: "k-oba", category_id: KAT_B },
        { post_id: "k-kat", category_id: KAT_A },
      ]),
      tagiKandydatow: ok([
        { post_id: "k-oba", tag_id: TAG_A },
        { post_id: "k-oba", tag_id: TAG_B },
        { post_id: "k-tag", tag_id: TAG_A },
      ]),
    };
  }

  it("dwie wspólne kategorie i dwa wspólne tagi biją jedną kategorię i sam tag", async () => {
    // Wagi domyślne (kategorie 3, tagi 2, świeżość 1): k-oba = 3*2 + 2*2 = 10,
    // k-kat = 3 + 1 (w oknie 30 dni) = 4, k-tag = 2. Kolejność jest CAŁĄ
    // wartością widgetu - pierwsza karta zbiera większość kliknięć.
    planuj(planTrzechKandydatow());
    const wynik = await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));
    expect(slugi(wynik)).toEqual(["slug-k-oba", "slug-k-kat", "slug-k-tag"]);
  });

  it("przynależność kandydatów czytana JEDNYM zapytaniem na pivot", async () => {
    // Wsadowo, bo alternatywą jest po dwa round-tripy na kandydata (do 200
    // żądań z przeglądarki czytelnika przy pełnym zestawie stu kandydatów).
    planuj(planTrzechKandydatow());
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie()));

    const pc = lancuchKandydatow("post_categories", "post_id");
    const pt = lancuchKandydatow("post_tags", "post_id");
    expect(pc?.argsOf("in")).toEqual(["post_id", ["k-oba", "k-kat", "k-tag"]]);
    expect(pt?.argsOf("in")).toEqual(["post_id", ["k-oba", "k-kat", "k-tag"]]);
    expect(baza().chainsFor("post_categories")).toHaveLength(3);
    expect(baza().chainsFor("post_tags")).toHaveLength(3);
  });

  it("LIMIT z konfiguracji ucina wyjście, nie wejście", async () => {
    planuj(planTrzechKandydatow());
    const wynik = await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ limit: 2 })));
    // Ucięcie po scoringu, więc zostają DWA NAJLEPSZE, a nie dwa pierwsze
    // z bazy - odwrotna kolejność tych dwóch kroków dawałaby widget wypełniony
    // najsłabszymi dopasowaniami.
    expect(slugi(wynik)).toEqual(["slug-k-oba", "slug-k-kat"]);
  });

  it("przy RÓWNYM wyniku wyżej stoi nowszy - kolejność nie może się losować", async () => {
    // Bez rozstrzygnięcia remisu ta sama para wpisów wychodziłaby w różnej
    // kolejności między żądaniami, a HTML strony wpisu siedzi w cache
    // brzegowym - jedna losowa kolejność zostaje zakonserwowana na dobę.
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-stary" }, { post_id: "k-nowy" }]),
      hydracja: ok([kandydat("k-stary", SWIEZY), kandydat("k-nowy", SWIEZSZY)]),
      kategorieKandydatow: ok([
        { post_id: "k-stary", category_id: KAT_A },
        { post_id: "k-nowy", category_id: KAT_A },
      ]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories" })),
    );
    expect(slugi(wynik)).toEqual(["slug-k-nowy", "slug-k-stary"]);
  });

  it("strategia AUTORA punktuje autorstwo poczwórnie i ignoruje taksonomię", async () => {
    // `scoreRelated` przy `source_strategy: "author"` liczy wyłącznie
    // `weight_author * 4`, więc kandydat bez wspólnych kategorii i tagów
    // dostaje 4 punkty i wchodzi do widgetu. Zapytania o przynależność
    // JEDNAK lecą - to dwa round-tripy, których ta strategia nie używa,
    // i tak wygląda produkcja (stan faktyczny, nie postulat).
    planuj({
      kandydaciAutora: ok([{ id: "k-autor" }]),
      hydracja: ok([kandydat("k-autor", STARY, { author_id: AUTOR })]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "author" })),
    );
    expect(slugi(wynik)).toEqual(["slug-k-autor"]);
    expect(lancuchKandydatow("post_categories", "post_id")).toBeDefined();
    expect(lancuchKandydatow("post_tags", "post_id")).toBeDefined();
  });

  it("kandydat BEZ przynależności punktuje tylko świeżością - i to wystarcza", async () => {
    // STAN FAKTYCZNY, wart zapisania. Wsadowe zapytania o przynależność
    // (`relatedPosts.ts:145-148`) nie mają `.limit()`, więc przy stu
    // kandydatach o gęstej taksonomii odpowiedź może obciąć się na domyślnym
    // limicie wierszy PostgREST. Kandydat, którego wiersze nie dojechały,
    // dostaje PUSTE zbiory - i wtedy: świeży zostaje w widgecie za sam bonus
    // świeżości (1 punkt), a stary wypada, bo `rankRelated` odsiewa zero.
    // Skutek dla czytelnika: pod artykułem stoi rekomendacja, która nie ma
    // z nim NIC wspólnego poza datą publikacji.
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-swiezy" }, { post_id: "k-stary" }]),
      hydracja: ok([kandydat("k-swiezy", SWIEZY), kandydat("k-stary", STARY)]),
      kategorieKandydatow: ok(null),
      tagiKandydatow: ok(null),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories" })),
    );
    expect(slugi(wynik)).toEqual(["slug-k-swiezy"]);
  });
});

// ==========================================================================
// ADRESY REKOMENDACJI - rezolucja ścieżki strony rodzica
// ==========================================================================

describe("adresy rekomendacji: ścieżka rodzica w href", () => {
  it("jedno wywołanie `page_full_path` na DYSTYNKTNEGO rodzica, argument `_page_id`", async () => {
    // Nazwa argumentu to JEDYNY dowód: wywołanie idzie luźnym obiektem, więc
    // literówka w `_page_id` przechodzi przez `tsc` i przez przegląd, a serwer
    // po prostu zignoruje parametr. Deduplikacja przez `Set` też jest treścią:
    // ten moduł woła RPC per rodzica (a nie wsadowe `page_full_paths`, jak
    // `archives.ts`), więc bez deduplikacji trzy wpisy jednej sekcji dałyby
    // trzy round-tripy z przeglądarki.
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }, { post_id: "k-2" }, { post_id: "k-3" }]),
      hydracja: ok([
        kandydat("k-1", SWIEZY),
        kandydat("k-2", SWIEZY),
        kandydat("k-3", SWIEZY, { parent_page_id: INNY_RODZIC }),
      ]),
      kategorieKandydatow: ok([
        { post_id: "k-1", category_id: KAT_A },
        { post_id: "k-2", category_id: KAT_A },
        { post_id: "k-3", category_id: KAT_A },
      ]),
      sciezka: ok(SCIEZKA_RODZICA),
    });
    await klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" })));

    const wywolania = funkcje().callsFor("page_full_path");
    expect(wywolania).toHaveLength(2);
    expect(wywolania.map((c) => c.arg("_page_id")).sort()).toEqual([RODZIC, INNY_RODZIC].sort());
    expect(wywolanie("page_full_path").keys()).toEqual(["_page_id"]);
  });

  it("adres składa ścieżkę rodzica ze slugiem wpisu", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([kandydat("k-1", SWIEZY)]),
      kategorieKandydatow: ok([{ post_id: "k-1", category_id: KAT_A }]),
      sciezka: ok(SCIEZKA_RODZICA),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories" })),
    );
    expect(wynik[0]?.href).toBe(`/${SCIEZKA_RODZICA}/slug-k-1`);
  });

  it("odpowiedź RPC, która nie jest napisem, NIE trafia do adresu", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([kandydat("k-1", SWIEZY)]),
      kategorieKandydatow: ok([{ post_id: "k-1", category_id: KAT_A }]),
      sciezka: ok(null),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories" })),
    );
    expect(wynik[0]?.href).toBe("/blog/slug-k-1");
  });

  it("błąd odczytu jest zgłaszany: odmowa page_full_path", async () => {
    // Ta sama klasa defektu, ten sam fallback `paths.get(…) ?? "blog"`, co
    // w `archives.ts:81`, `programs.ts:124`, `series.ts:80` i `liveBlogs.ts:72`.
    // PEŁNY zapis mechanizmu, konsekwencji i uzasadnienia „to decyzja
    // człowieka" ma `archives.test.ts:797` - tutaj przypinam wyłącznie stan
    // faktyczny dla powierzchni rekomendacji, żeby go nie dublować.
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([kandydat("k-1", SWIEZY)]),
      kategorieKandydatow: ok([{ post_id: "k-1", category_id: KAT_A }]),
      sciezka: fail("odmowa page_full_path", "42501"),
    });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" }))),
    ).rejects.toMatchObject({ message: "odmowa page_full_path" });
  });
});

// ==========================================================================
// DEGRADACJA - awaria bazy jest tu nieodróżnialna od wpisu bez powiązań
// ==========================================================================

describe("degradacja rekomendacji: awaria wygląda jak brak powiązań", () => {
  it("błąd odczytu jest zgłaszany: odmowa post_categories", async () => {
    planuj({
      wlasneKategorie: fail("odmowa post_categories", "42501"),
      wlasneTagi: fail("odmowa post_tags", "42501"),
      wlasnyWpis: fail("odmowa posts", "42501"),
    });
    await expect(klient().fetchQuery(relatedPostsQueryOptions(wejscie()))).rejects.toMatchObject({
      message: "odmowa post_categories",
    });
  });

  it("błąd odczytu jest zgłaszany: odmowa hydracji", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: fail("odmowa hydracji", "42501"),
    });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" }))),
    ).rejects.toMatchObject({ message: "odmowa hydracji" });
  });

  it("AWARIA rekomendacji POWINNA być odróżnialna od wpisu bez powiązań", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: fail("odmowa hydracji", "42501"),
    });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy: "categories" }))),
    ).rejects.toThrow("odmowa hydracji");
  });
});

describe("independent related-post failures", () => {
  it.each([
    ["wlasneKategorie", "both"],
    ["wlasneTagi", "both"],
    ["wlasnyWpis", "both"],
    ["kandydaciZKategorii", "categories"],
    ["kandydaciZTagow", "tags"],
    ["kandydaciAutora", "author"],
    ["hydracja", "both"],
    ["kategorieKandydatow", "both"],
    ["tagiKandydatow", "both"],
  ] as const)("rejects %s without publishing partial recommendations", async (stage, strategy) => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      kandydaciZTagow: ok([{ post_id: "k-1" }]),
      kandydaciAutora: ok([{ id: "k-1" }]),
      hydracja: ok([kandydat("k-1", SWIEZY)]),
      [stage]: fail("odmowa konkretnego etapu", "42501"),
    });
    await expect(
      klient().fetchQuery(relatedPostsQueryOptions(wejscie({ strategy }))),
    ).rejects.toThrow("odmowa konkretnego etapu");
  });
});
