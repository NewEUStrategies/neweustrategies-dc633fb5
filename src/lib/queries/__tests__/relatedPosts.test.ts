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
  type RelatedScoringInput,
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
const CZYTELNIK = "00000000-0000-4000-8000-0000000000c0";
const INNY_CZYTELNIK = "00000000-0000-4000-8000-0000000000c9";
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

/**
 * Strojenie silnika w wejściu testowym - czytane Z DOMYŚLNEJ KONFIGURACJI, a nie
 * przepisane literałami. Literał zamroziłby wagi w teście: zmiana `use_idf`
 * albo dowolnej wagi w `RELATED_POSTS_DEFAULTS` przeszłaby wtedy przez CI,
 * chociaż przestawia kolejność rekomendacji pod każdym artykułem serwisu.
 */
function wagi(nadpisania: Partial<RelatedScoringInput> = {}): RelatedScoringInput {
  return {
    weight_categories: RELATED_POSTS_DEFAULTS.weight_categories,
    weight_tags: RELATED_POSTS_DEFAULTS.weight_tags,
    weight_author: RELATED_POSTS_DEFAULTS.weight_author,
    weight_recency: RELATED_POSTS_DEFAULTS.weight_recency,
    weight_popularity: RELATED_POSTS_DEFAULTS.weight_popularity,
    weight_dwell: RELATED_POSTS_DEFAULTS.weight_dwell,
    weight_personalization: RELATED_POSTS_DEFAULTS.weight_personalization,
    use_idf: RELATED_POSTS_DEFAULTS.use_idf,
    min_score: RELATED_POSTS_DEFAULTS.min_score,
    ...nadpisania,
  };
}

function wejscie(nadpisania: Partial<RelatedPostsInput> = {}): RelatedPostsInput {
  return {
    postId: WPIS,
    limit: 6,
    strategy: "both",
    recencyBoostDays: 30,
    scoring: wagi(),
    personalizedFor: null,
    ...nadpisania,
  };
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
  /** `user_read_history` - historia czytania zalogowanego czytelnika. */
  historiaCzytania?: SupabaseResult;
  /** Kategorie wpisów Z HISTORII (profil zainteresowań), nie kandydatów. */
  kategorieHistorii?: SupabaseResult;
  /** Tagi wpisów Z HISTORII. */
  tagiHistorii?: SupabaseResult;
  /** RPC `trending_posts` - źródło sygnału popularności. */
  popularne?: SupabaseResult;
}

function planuj(plan: Plan = {}): void {
  // Dwa RÓŻNE zapytania trafiają w `post_categories` po ogniwie `in("post_id")`:
  // przynależność KANDYDATÓW i kategorie wpisów z HISTORII czytelnika. Oba mają
  // ten sam kształt łańcucha, więc rozróżnia je ZBIÓR IDENTYFIKATORÓW - jedyne,
  // co je naprawdę różni. Stała odpowiedź na tabelę „dowodziłaby", że te dwa
  // odczyty są wymienne, a mylą się o cały profil czytelnika.
  const zHistorii = (chain: RecordedChain): boolean => {
    const historia = (plan.historiaCzytania?.data ?? []) as Array<{ post_id?: string }>;
    const idHistorii = new Set(historia.map((r) => r.post_id));
    const pytane = (chain.argsOf("in")?.[1] ?? []) as unknown[];
    return pytane.some((id) => idHistorii.has(String(id)));
  };

  baza().setResponse("post_categories", (chain) => {
    const kolumna = String(chain.argsOf("in")?.[0] ?? "");
    if (kolumna === "category_id") return plan.kandydaciZKategorii ?? ok([]);
    if (kolumna === "post_id") {
      return zHistorii(chain)
        ? (plan.kategorieHistorii ?? ok([]))
        : (plan.kategorieKandydatow ?? ok([]));
    }
    return plan.wlasneKategorie ?? ok([{ category_id: KAT_A }, { category_id: KAT_B }]);
  });
  baza().setResponse("post_tags", (chain) => {
    const kolumna = String(chain.argsOf("in")?.[0] ?? "");
    if (kolumna === "tag_id") return plan.kandydaciZTagow ?? ok([]);
    if (kolumna === "post_id") {
      return zHistorii(chain) ? (plan.tagiHistorii ?? ok([])) : (plan.tagiKandydatow ?? ok([]));
    }
    return plan.wlasneTagi ?? ok([{ tag_id: TAG_A }, { tag_id: TAG_B }]);
  });
  baza().setResponse("user_read_history", () => plan.historiaCzytania ?? ok([]));
  funkcje().setResponse("trending_posts", plan.popularne ?? ok([]));
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
      {
        postId: WPIS,
        limit: 6,
        strategy: "both",
        recencyBoostDays: 30,
        scoring: wagi(),
        personalizedFor: null,
      },
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

// ==========================================================================
// SILNIK v2 - SIEDEM POKRĘTEŁ PANELU, KTÓRE NAPRAWDĘ COŚ ROBIĄ
//
// Klasa defektu, którą ta sekcja zamyka na stałe: do 14.09.2026 panel
// /admin/related-posts zapisywał siedem wag, przełącznik IDF i próg
// `min_score`, a warstwa zapytań przyjmowała CZTERY pola. Reszta dobierała się
// z wartości domyślnych w legacy `scoreRelated`, który dodatkowo zerował
// popularność, dwell i personalizację oraz wymuszał `use_idf: false`. Redakcja
// kręciła pokrętłami bez podłączenia, a `min_score` nigdy nie odciął ani
// jednego kandydata.
//
// Awaria nie dawała ŻADNEGO sygnału: lista się renderowała, tylko liczona nie
// tym, co ustawiła redakcja. Dlatego dowód nie może brzmieć „pole jest
// w typie" - każde pokrętło musi ZMIENIĆ WYNIK, inaczej test przechodzi nad
// martwym kodem tak samo, jak przechodził poprzednio.
// ==========================================================================

describe("wagi silnika docierają do scoringu: każde pokrętło zmienia wynik", () => {
  /** Kandydat wyłącznie kategorialny i kandydat wyłącznie tagowy. */
  function planKategoriaKontraTag(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-kat" }]),
      kandydaciZTagow: ok([{ post_id: "k-tag" }]),
      hydracja: ok([kandydat("k-kat", STARY), kandydat("k-tag", STARY)]),
      kategorieKandydatow: ok([{ post_id: "k-kat", category_id: KAT_A }]),
      tagiKandydatow: ok([{ post_id: "k-tag", tag_id: TAG_A }]),
    };
  }

  it("PRZEWAGA WAGI KATEGORII stawia kandydata kategorialnego nad tagowym", async () => {
    planuj(planKategoriaKontraTag());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ scoring: wagi({ weight_categories: 9, weight_tags: 1, use_idf: false }) }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-kat", "slug-k-tag"]);
  });

  it("ODWRÓCENIE WAG odwraca kolejność - to jest dowód, że waga JEST czytana", async () => {
    // Ten sam plan, te same dane, różnica WYŁĄCZNIE w konfiguracji panelu.
    // Gdyby wagi znów przestały docierać do silnika, oba przypadki zwróciłyby
    // tę samą kolejność i jeden z nich by padł.
    planuj(planKategoriaKontraTag());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ scoring: wagi({ weight_categories: 1, weight_tags: 9, use_idf: false }) }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-tag", "slug-k-kat"]);
  });

  it("WAGA ZERO wygasza sygnał: kandydat bez innego dopasowania wypada z listy", async () => {
    // `rankRelated` odsiewa wynik <= 0, więc waga 0 na jedynym sygnale
    // kandydata to nie „mniej punktów", tylko brak wpisu w rekomendacjach.
    planuj(planKategoriaKontraTag());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          scoring: wagi({
            weight_categories: 0,
            weight_tags: 5,
            weight_recency: 0,
            use_idf: false,
          }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-tag"]);
  });

  it("WAGA ŚWIEŻOŚCI podnosi wpis z okna ponad starszy o równym dopasowaniu", async () => {
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-swiezy" }, { post_id: "k-stary" }]),
      hydracja: ok([kandydat("k-stary", STARY), kandydat("k-swiezy", SWIEZY)]),
      kategorieKandydatow: ok([
        { post_id: "k-swiezy", category_id: KAT_A },
        { post_id: "k-stary", category_id: KAT_A },
      ]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ weight_recency: 10, use_idf: false }) }),
      ),
    );
    expect(slugi(wynik)[0]).toBe("slug-k-swiezy");
  });
});

describe("przełącznik IDF: rzadkie terminy ważą więcej", () => {
  /**
   * Kategoria `KAT_A` siedzi na OBU kandydatach (pospolita), `KAT_B` tylko na
   * jednym (rzadka). Przy IDF wyłączonym oba terminy ważą tyle samo, więc
   * kandydat z dwiema kategoriami wygrywa ilością. Przy IDF włączonym rzadki
   * termin dostaje wyższą wagę - i to właśnie musi być widać.
   */
  function planPospolitaIRzadka(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-rzadka" }, { post_id: "k-pospolita" }]),
      hydracja: ok([kandydat("k-rzadka", STARY), kandydat("k-pospolita", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-rzadka", category_id: KAT_B },
        { post_id: "k-pospolita", category_id: KAT_A },
        { post_id: "k-inny-1", category_id: KAT_A },
      ]),
    };
  }

  it("WŁĄCZONY IDF stawia kandydata z RZADKĄ kategorią nad pospolitą", async () => {
    planuj(planPospolitaIRzadka());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ use_idf: true, weight_recency: 0 }) }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-rzadka", "slug-k-pospolita"]);
  });

  it("WYŁĄCZONY IDF zrównuje terminy - przełącznik naprawdę przełącza", async () => {
    // Przy równych wagach terminów remis rozstrzyga data, więc sama zmiana
    // `use_idf` musi wystarczyć do innego wyniku niż w teście wyżej.
    planuj(planPospolitaIRzadka());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ use_idf: false, weight_recency: 0 }) }),
      ),
    );
    const oba = slugi(wynik);
    expect(oba).toHaveLength(2);
    expect(oba).toContain("slug-k-rzadka");
    expect(oba).toContain("slug-k-pospolita");
  });

  it("IDF NIE dokłada ani jednego zapytania - `df` liczy się z danych w ręku", async () => {
    // Gdyby częstość dokumentową pobierać osobnym zapytaniem, IDF kosztowałby
    // round-trip na każdej stronie artykułu. Liczy się z wierszy przynależności
    // pobranych już w kroku 4, więc liczba łańcuchów po pivotach się nie zmienia.
    planuj(planPospolitaIRzadka());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ use_idf: true }) }),
      ),
    );
    const zIdf = baza().chainsFor("post_categories").length;

    baza().reset();
    funkcje().reset();
    planuj(planPospolitaIRzadka());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ use_idf: false }) }),
      ),
    );
    expect(baza().chainsFor("post_categories").length).toBe(zIdf);
  });
});

describe("próg `min_score`: filtr jakości, który wreszcie działa", () => {
  function planDwochOWyniku(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-mocny" }, { post_id: "k-slaby" }]),
      hydracja: ok([kandydat("k-mocny", STARY), kandydat("k-slaby", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-mocny", category_id: KAT_A },
        { post_id: "k-mocny", category_id: KAT_B },
        { post_id: "k-slaby", category_id: KAT_A },
      ]),
    };
  }

  it("próg ODCINA słabsze dopasowanie, mocniejsze zostaje", async () => {
    // Wagi bez IDF i bez świeżości: `k-mocny` = 2 kategorie x 3 = 6,
    // `k-slaby` = 1 x 3 = 3. Próg 5 przepuszcza wyłącznie pierwszego.
    planuj(planDwochOWyniku());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          scoring: wagi({ use_idf: false, weight_recency: 0, min_score: 5 }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-mocny"]);
  });

  it("PRÓG 0 (domyślny) nie odcina niczego - naprawa nie zmienia zastanych serwisów", async () => {
    // Zdecydowana większość tenantów ma zapisane domyślne 0. Gdyby włączenie
    // progu cokolwiek im zmieniło, naprawa byłaby regresją dla wszystkich.
    planuj(planDwochOWyniku());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          scoring: wagi({ use_idf: false, weight_recency: 0, min_score: 0 }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-mocny", "slug-k-slaby"]);
  });

  it("PRÓG, KTÓRY KASUJE CAŁĄ SEKCJĘ, ZOSTAWIA ŚLAD W KONSOLI", async () => {
    // Najgroźniejszy stan tego ustawienia: widget po prostu znika (RelatedPosts
    // przy pustej liście zwraca `null`), strona wygląda poprawnie i nikt nie
    // wie, że zrobił to suwak w panelu. Decyzji redakcji NIE nadpisujemy - ale
    // musi zostać po niej diagnozowalny ślad.
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj(planDwochOWyniku());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          scoring: wagi({ use_idf: false, weight_recency: 0, min_score: 999 }),
        }),
      ),
    );
    expect(wynik).toEqual([]);
    expect(ostrzezenia).toHaveBeenCalledWith(expect.stringContaining("min_score=999"));
    expect(ostrzezenia).toHaveBeenCalledWith(expect.stringContaining("2 kandydatów"));
    ostrzezenia.mockRestore();
  });

  it("DIAGNOSTYKA WSKAZUJE WINOWAJCĘ: przy zerowych wynikach nie obwinia progu", async () => {
    // `rankRelated` odsiewa dwoma sitami naraz (`score > 0` ORAZ `>= minScore`).
    // Pusta lista przy ustawionym progu NIE dowodzi więc, że to próg ją
    // opróżnił. Redakcja odesłana do „zmniejsz próg", kiedy naprawdę winne są
    // wagi, będzie go zmniejszać bez skutku - i straci zaufanie do panelu.
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([kandydat("k-1", STARY)]),
      kategorieKandydatow: ok([]),
    });
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          scoring: wagi({ use_idf: false, weight_recency: 0, min_score: 7 }),
        }),
      ),
    );
    const tresc = ostrzezenia.mock.calls.map((c) => String(c[0])).join("\n");
    expect(tresc).toContain("nie uzyskał wyniku > 0");
    expect(tresc).not.toContain("min_score=7 odrzucił");
    ostrzezenia.mockRestore();
  });

  it("pusta lista z powodu LIMITU nie jest raportowana jako problem z progiem", async () => {
    // `limit: 0` daje pustą listę mimo kandydatów z dodatnim wynikiem. To nie
    // jest ani wina progu, ani wag - diagnostyka musi wtedy milczeć, zamiast
    // wysyłać redakcję do ustawienia, które nic tu nie zmieni.
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([kandydat("k-1", STARY)]),
      kategorieKandydatow: ok([{ post_id: "k-1", category_id: KAT_A }]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          limit: 0,
          strategy: "categories",
          scoring: wagi({ use_idf: false, min_score: 0 }),
        }),
      ),
    );
    expect(wynik).toEqual([]);
    expect(ostrzezenia).not.toHaveBeenCalled();
    ostrzezenia.mockRestore();
  });

  it("BRAK KANDYDATÓW w ogóle nie hałasuje - nie ma o czym ostrzegać", async () => {
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      kandydaciZKategorii: ok([{ post_id: "k-1" }]),
      hydracja: ok([]),
    });
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ min_score: 7 }) }),
      ),
    );
    expect(ostrzezenia).not.toHaveBeenCalled();
    ostrzezenia.mockRestore();
  });
});

describe("sygnał popularności: jedyna publiczna droga do `post_views`", () => {
  function planRemisu(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-niszowy" }, { post_id: "k-czytany" }]),
      hydracja: ok([kandydat("k-niszowy", STARY), kandydat("k-czytany", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-niszowy", category_id: KAT_A },
        { post_id: "k-czytany", category_id: KAT_A },
      ]),
    };
  }

  it("POPULARNOŚĆ rozstrzyga remis dopasowania", async () => {
    // Obaj kandydaci mają identyczne dopasowanie taksonomiczne i tę samą datę,
    // więc o kolejności decyduje WYŁĄCZNIE sygnał popularności.
    planuj({
      ...planRemisu(),
      popularne: ok([
        { id: "k-czytany", views_count: 500 },
        { id: "k-niszowy", views_count: 5 },
      ]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_popularity: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-czytany", "slug-k-niszowy"]);
  });

  it("czyta popularność funkcją `trending_posts`, NIGDY tabelą `post_views`", async () => {
    // Polityka „post_views public read" została świadomie zdjęta (migracja
    // 20260625160054). Sięgnięcie po tabelę wprost wygląda w kodzie jak
    // uproszczenie, a jest cofnięciem decyzji o nieujawnianiu odsłon.
    planuj({ ...planRemisu(), popularne: ok([{ id: "k-czytany", views_count: 10 }]) });
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ weight_popularity: 5 }) }),
      ),
    );
    expect(funkcje().names()).toContain("trending_posts");
    expect(baza().chainsFor("post_views")).toHaveLength(0);
  });

  it("WAGA 0 nie płaci za sygnał - żadnego round-tripu po popularność", async () => {
    // Przy zerowej wadze wkład i tak wyszedłby zerowy, więc zapytanie byłoby
    // czystym kosztem na KAŻDEJ stronie artykułu.
    planuj(planRemisu());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ weight_popularity: 0 }) }),
      ),
    );
    expect(funkcje().names()).not.toContain("trending_posts");
  });

  it("AWARIA POPULARNOŚCI NIE GASI WIDGETU - lista wychodzi z pozostałych sygnałów", async () => {
    // Odwrotnie niż sześć odczytów dostarczających KANDYDATÓW: te muszą rzucać,
    // bo bez nich nie ma czego pokazać. Sygnał dostrajający nie ma prawa
    // zamienić sekcji rekomendacji w pustkę pod artykułem.
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({ ...planRemisu(), popularne: fail("brak dostępu do trending_posts", "42501") });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", scoring: wagi({ weight_popularity: 10 }) }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(ostrzezenia).toHaveBeenCalledWith(
      expect.stringContaining("popularity signal unavailable"),
      expect.anything(),
    );
    ostrzezenia.mockRestore();
  });

  it("popularność liczy się RAZ dla wielu wpisów - własny klucz, nie klucz artykułu", async () => {
    // Snapshot `trending_posts` jest globalny dla tenanta. Gdyby siedział pod
    // kluczem rekomendacji (który niesie `postId`), czytelnik przeglądający
    // kolejne artykuły pobierałby tę samą listę od nowa pod każdym z nich.
    planuj({ ...planRemisu(), popularne: ok([{ id: "k-czytany", views_count: 10 }]) });
    const qc = klient();
    const opcje = (postId: string) =>
      relatedPostsQueryOptions(
        wejscie({ postId, strategy: "categories", scoring: wagi({ weight_popularity: 5 }) }),
      );
    await qc.fetchQuery(opcje(WPIS));
    await qc.fetchQuery(opcje("00000000-0000-4000-8000-000000000002"));

    expect(funkcje().callsFor("trending_posts")).toHaveLength(1);
  });
});

describe("personalizacja: profil czytelnika pod bramką zgody", () => {
  function planZHistoria(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-w-profilu" }, { post_id: "k-obcy" }]),
      hydracja: ok([kandydat("k-w-profilu", STARY), kandydat("k-obcy", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-w-profilu", category_id: KAT_A },
        { post_id: "k-obcy", category_id: KAT_B },
      ]),
      wlasneKategorie: ok([{ category_id: KAT_A }, { category_id: KAT_B }]),
      historiaCzytania: ok([{ post_id: "h-1" }, { post_id: "h-2" }]),
      kategorieHistorii: ok([
        { post_id: "h-1", category_id: KAT_A },
        { post_id: "h-2", category_id: KAT_A },
      ]),
    };
  }

  it("PROFIL podnosi kandydata z kategorii, które czytelnik faktycznie czyta", async () => {
    planuj(planZHistoria());
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-w-profilu", "slug-k-obcy"]);
  });

  it("BEZ ZGODY (`personalizedFor: null`) historia NIE jest w ogóle czytana", async () => {
    // Bramka RODO nie jest umowna: bez identyfikatora silnik nie ma czego
    // pobrać, więc profilowanie jest niewykonalne, a nie tylko pominięte.
    planuj(planZHistoria());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: null,
          scoring: wagi({ weight_personalization: 10 }),
        }),
      ),
    );
    expect(baza().chainsFor("user_read_history")).toHaveLength(0);
  });

  it("WAGA 0 nie sięga po historię, nawet przy udzielonej zgodzie", async () => {
    planuj(planZHistoria());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ weight_personalization: 0 }),
        }),
      ),
    );
    expect(baza().chainsFor("user_read_history")).toHaveLength(0);
  });

  it("historia jest zawężona do WŁASNEGO czytelnika - drugi zamek obok RLS", async () => {
    planuj(planZHistoria());
    await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ weight_personalization: 10 }),
        }),
      ),
    );
    expect(filtrEq(lancuch("user_read_history"), "user_id")).toEqual(["user_id", CZYTELNIK]);
  });

  it("PUSTA HISTORIA to profil zerowy, nie awaria", async () => {
    planuj({ ...planZHistoria(), historiaCzytania: ok([]) });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
  });

  it("HISTORIA Z OBCEGO TENANTA NIE ROZCIEŃCZA PROFILU", async () => {
    // Historia jest zawężona tenantem DOMOWYM czytelnika, a taksonomia
    // kandydatów - tenantem PRZEGLĄDANYM. Wpisy przeczytane gdzie indziej nie
    // mają tu kategorii: gdyby liczyły się do mianownika, czytelnik aktywny na
    // kilku serwisach miałby profil tym słabszy, im więcej czyta. Tutaj dwa z
    // trzech wpisów historii nie rozwiązują się na żadną kategorię.
    planuj({
      ...planZHistoria(),
      historiaCzytania: ok([{ post_id: "h-1" }, { post_id: "h-obcy-1" }, { post_id: "h-obcy-2" }]),
      kategorieHistorii: ok([{ post_id: "h-1", category_id: KAT_A }]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 }),
        }),
      ),
    );
    // Mianownik = 1 (jedyny wpis z rozwiązaną kategorią), więc pełne trafienie
    // w KAT_A daje pełny wkład i wyprzedza kandydata spoza profilu.
    expect(slugi(wynik)).toEqual(["slug-k-w-profilu", "slug-k-obcy"]);
  });

  it("TAGI Z HISTORII też budują profil, nie tylko kategorie", async () => {
    // Profil liczy oba wymiary taksonomii - tagi z wagą 0,6 kategorii
    // (`scoreRelatedDetailed`). Bez tego przypadku gałąź tagowa profilu nie
    // wykonuje się ani razu, a to POŁOWA sygnału personalizacji.
    planuj({
      kandydaciZTagow: ok([{ post_id: "k-tag-w-profilu" }, { post_id: "k-tag-obcy" }]),
      hydracja: ok([kandydat("k-tag-w-profilu", STARY), kandydat("k-tag-obcy", STARY)]),
      tagiKandydatow: ok([
        { post_id: "k-tag-w-profilu", tag_id: TAG_A },
        { post_id: "k-tag-obcy", tag_id: TAG_B },
      ]),
      historiaCzytania: ok([{ post_id: "h-1" }]),
      kategorieHistorii: ok([]),
      tagiHistorii: ok([{ post_id: "h-1", tag_id: TAG_A }]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "tags",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toEqual(["slug-k-tag-w-profilu", "slug-k-tag-obcy"]);
  });

  it("HISTORIA, KTÓREJ NIC NIE ROZWIĄZUJE, daje profil pusty - bez dzielenia przez zero", async () => {
    // Czytelnik aktywny wyłącznie na innym tenancie: historia jest, ale żaden
    // z jej wpisów nie ma tu widocznej taksonomii. Mianownik wychodzi zerowy,
    // więc profil musi wyjść pusty, a nie wyprodukować NaN - NaN nie
    // przechodzi progu `min_score` i wygasiłby CAŁĄ listę.
    planuj({
      ...planZHistoria(),
      historiaCzytania: ok([{ post_id: "h-obcy-1" }, { post_id: "h-obcy-2" }]),
      kategorieHistorii: ok([]),
      tagiHistorii: ok([]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(wynik.every((p) => Number.isFinite(0))).toBe(true);
  });

  it("AWARIA PROFILU NIE GASI WIDGETU - czytelnik dostaje listę bezosobową", async () => {
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({ ...planZHistoria(), historiaCzytania: fail("odmowa historii", "42501") });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({
          strategy: "categories",
          personalizedFor: CZYTELNIK,
          scoring: wagi({ weight_personalization: 10 }),
        }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(ostrzezenia).toHaveBeenCalledWith(
      expect.stringContaining("personalization signal unavailable"),
      expect.anything(),
    );
    ostrzezenia.mockRestore();
  });

  it("KLUCZ NIESIE CZYTELNIKA - spersonalizowana lista nie wyjeżdża obcej osobie", async () => {
    // Bez tego pola w kluczu wynik policzony dla jednego czytelnika siedziałby
    // pod tym samym wpisem cache co wynik dla każdego innego.
    const dlaA = relatedPostsQueryOptions(wejscie({ personalizedFor: CZYTELNIK })).queryKey;
    const dlaB = relatedPostsQueryOptions(wejscie({ personalizedFor: INNY_CZYTELNIK })).queryKey;
    const dlaGoscia = relatedPostsQueryOptions(wejscie({ personalizedFor: null })).queryKey;
    expect(dlaA).not.toEqual(dlaB);
    expect(dlaA).not.toEqual(dlaGoscia);
  });
});

describe("klucz rekomendacji niesie KAŻDE pokrętło silnika", () => {
  it("zmiana dowolnej wagi, IDF albo progu daje INNY wpis cache", () => {
    // To jest asercja, której brak pozwolił silnikowi umrzeć: dopóki wagi nie
    // były częścią wejścia, zmiana w panelu nie unieważniała nawet cache.
    const bazowy = relatedPostsQueryOptions(wejscie()).queryKey;
    const pokretla: Array<Partial<RelatedScoringInput>> = [
      { weight_categories: 7 },
      { weight_tags: 7 },
      { weight_author: 7 },
      { weight_recency: 7 },
      { weight_popularity: 7 },
      { weight_dwell: 7 },
      { weight_personalization: 7 },
      { use_idf: !RELATED_POSTS_DEFAULTS.use_idf },
      { min_score: 42 },
    ];
    for (const p of pokretla) {
      expect(relatedPostsQueryOptions(wejscie({ scoring: wagi(p) })).queryKey).not.toEqual(bazowy);
    }
  });

  it("klucz NIE niesie pól prezentacyjnych ani tenanta", () => {
    // `get_related_posts_config()` oddaje CAŁY wiersz tabeli, więc skrót
    // `{...cfg}` wsadziłby do klucza `tenant_id`, `updated_at` i layout.
    // Tenant w kluczu rozjeżdża prefetch SSR z renderem klienta, a pola
    // prezentacyjne kasują cache przy każdym kosmetycznym zapisie panelu.
    const klucz = relatedPostsQueryOptions(wejscie()).queryKey;
    const wejscieWKluczu = JSON.stringify(klucz[2]);
    for (const pole of ["tenant_id", "updated_at", "created_at", "layout", "title_pl", "columns"]) {
      expect(wejscieWKluczu).not.toContain(pole);
    }
  });
});

// ==========================================================================
// SYGNAŁY DOSTRAJAJĄCE - ŚCIEŻKI AWARII I DANYCH PUSTYCH
//
// Popularność i profil czytelnika NIE dostarczają kandydatów, tylko przestawiają
// kolejność. Każda ich awaria musi kończyć się listą policzoną z pozostałych
// sygnałów - nigdy pustą przestrzenią pod artykułem. Ta sekcja przechodzi
// wszystkie warianty „danych nie ma albo są dziwne".
// ==========================================================================

describe("sygnały dostrajające: puste i uszkodzone odpowiedzi", () => {
  function planProsty(): Plan {
    return {
      kandydaciZKategorii: ok([{ post_id: "k-1" }, { post_id: "k-2" }]),
      hydracja: ok([kandydat("k-1", STARY), kandydat("k-2", STARY)]),
      kategorieKandydatow: ok([
        { post_id: "k-1", category_id: KAT_A },
        { post_id: "k-2", category_id: KAT_A },
      ]),
    };
  }

  const zPopularnoscia = wagi({ use_idf: false, weight_recency: 0, weight_popularity: 10 });
  const zProfilem = wagi({ use_idf: false, weight_recency: 0, weight_personalization: 10 });

  it("`trending_posts` bez wierszy (`null`) nie wywraca scoringu", async () => {
    planuj({ ...planProsty(), popularne: ok(null) });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories", scoring: zPopularnoscia })),
    );
    expect(slugi(wynik)).toHaveLength(2);
  });

  it("odsłony zerowe i nieliczbowe są pomijane, a nie liczone jako popularność", async () => {
    // `views_count` spoza liczb dodatnich nie może wejść do normalizacji:
    // maksimum policzone z NaN zamieniłoby CAŁĄ mapę popularności w NaN,
    // a NaN nie przechodzi progu `min_score` i gasi listę.
    planuj({
      ...planProsty(),
      popularne: ok([
        { id: "k-1", views_count: 0 },
        { id: "k-2", views_count: "nie-liczba" },
      ]),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories", scoring: zPopularnoscia })),
    );
    expect(slugi(wynik)).toHaveLength(2);
  });

  it("AWARIA POPULARNOŚCI SPOZA KLASY `Error` też tylko ostrzega", async () => {
    // PostgREST bywa atrapowany i opakowywany po drodze; log nie może się
    // wysypać na braku `.message`.
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      ...planProsty(),
      popularne: { data: null, error: "awaria bez klasy Error" as unknown as Error },
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(wejscie({ strategy: "categories", scoring: zPopularnoscia })),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(ostrzezenia).toHaveBeenCalledWith(
      expect.stringContaining("popularity signal unavailable"),
      "awaria bez klasy Error",
    );
    ostrzezenia.mockRestore();
  });

  it("historia czytania bez wierszy (`null`) daje profil pusty", async () => {
    planuj({ ...planProsty(), historiaCzytania: ok(null) });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", personalizedFor: CZYTELNIK, scoring: zProfilem }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
  });

  it("puste (`null`) taksonomie historii nie wywracają profilu", async () => {
    planuj({
      ...planProsty(),
      historiaCzytania: ok([{ post_id: "h-1" }]),
      kategorieHistorii: ok(null),
      tagiHistorii: ok(null),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", personalizedFor: CZYTELNIK, scoring: zProfilem }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
  });

  it.each([
    ["kategorieHistorii", "kategorii"],
    ["tagiHistorii", "tagów"],
  ] as const)("odmowa odczytu %s historii nie gasi widgetu", async (etap) => {
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      ...planProsty(),
      historiaCzytania: ok([{ post_id: "h-1" }]),
      [etap]: fail("odmowa taksonomii historii", "42501"),
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", personalizedFor: CZYTELNIK, scoring: zProfilem }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(ostrzezenia).toHaveBeenCalledWith(
      expect.stringContaining("personalization signal unavailable"),
      expect.anything(),
    );
    ostrzezenia.mockRestore();
  });

  it("AWARIA PROFILU SPOZA KLASY `Error` też tylko ostrzega", async () => {
    const ostrzezenia = vi.spyOn(console, "warn").mockImplementation(() => {});
    planuj({
      ...planProsty(),
      historiaCzytania: { data: null, error: "awaria bez klasy Error" as unknown as Error },
    });
    const wynik = await klient().fetchQuery(
      relatedPostsQueryOptions(
        wejscie({ strategy: "categories", personalizedFor: CZYTELNIK, scoring: zProfilem }),
      ),
    );
    expect(slugi(wynik)).toHaveLength(2);
    expect(ostrzezenia).toHaveBeenCalledWith(
      expect.stringContaining("personalization signal unavailable"),
      "awaria bez klasy Error",
    );
    ostrzezenia.mockRestore();
  });
});
