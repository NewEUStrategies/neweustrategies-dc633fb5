// STRONA SEKCYJNA (`template_type === 'archive_listing'`) - jedno zapytanie,
// które JEST całą treścią najsilniejszych linkowo tras serwisu.
//
// PO CO TEN PLIK ISTNIEJE. `src/lib/queries/archiveListing.ts` do 04.09.2026
// miał 2/5 linii, 0/4 GAŁĘZI i 1/2 funkcji. Pokryta była sama FABRYKA i sam
// KLUCZ - bo jedyny test, który ten moduł dotykał
// (`src/routes/__tests__/publicSurfacesSsrContent.test.tsx`), dowodzi rzeczy
// komplementarnej: że rozgrzany klucz emituje treść w `renderToString`,
// i robi to przez `setQueryData`, czyli PODSTAWIAJĄC wiersze zamiast ich
// pobierać. `queryFn` nie wykonał się tam ani raz. Skutek: całe zapytanie -
// trzy filtry, sortowanie, zacisk 60 i obsługa odmowy bazy - nie miało ani
// jednej asercji, a to ono decyduje, CO wchodzi do NES Edge Cache na do 24 h.
//
// CO JEST PRZEDMIOTEM DOWODU.
//   * FILTR, KTÓREGO ZGUBIENIE PUBLIKUJE SZKICE. `.eq("status","published")`
//     i `.is("deleted_at", null)` porównujemy CAŁYMI argumentami, bo filtr
//     z inną wartością i brak filtra to dwa różne błędy o tym samym skutku:
//     nieopublikowany albo usunięty materiał na publicznej liście sekcji;
//   * ZAWĘŻENIE RODZICEM JEST TOŻSAMOŚCIĄ STRONY. `.eq("parent_page_id", …)`
//     zgubione albo wpisane pod inną kolumną daje listę WSZYSTKICH wpisów
//     serwisu na każdej stronie sekcyjnej - i to jest stan, który wygląda
//     poprawnie (lista jest, karty się renderują), a rozjeżdża strukturę
//     informacji i kanibalizuje wewnętrzne linkowanie;
//   * SORTOWANIE JEST KONTRAKTEM, NIE OZDOBĄ. Bez `.order("published_at",
//     { ascending: false })` PostgREST oddaje wiersze w kolejności fizycznej,
//     czyli między żądaniami RÓŻNEJ. Ponieważ SSR-owy HTML tej trasy siedzi
//     w cache brzegowym do 24 h, jedna losowa kolejność zostaje zakonserwowana
//     na dobę: czytelnik wchodzący z Google dostaje sekcję otwartą archiwalnym
//     wpisem, a robot indeksuje ją jako świeżą listę;
//   * ZACISK 60 MA JEDNO ŹRÓDŁO. `ARCHIVE_LISTING_LIMIT` jest eksportowany po
//     to, żeby rozgrzewka i komponent nie mogły się rozjechać - więc asercja
//     porównuje argument ogniwa `.limit()` ZE STAŁĄ, a nie z literałem 60.
//     Dwie różne liczby po obu stronach hydracji dają miganie listy (60 z SSR,
//     potem inna długość z klienta) i drugie, niepotrzebne żądanie;
//   * ODMOWA BAZY RZUCA. Ten moduł jest w warstwie `lib/queries` w mniejszości:
//     `if (error) throw error` odróżnia „awarię" od „sekcji bez wpisów".
//     To zachowanie WŁAŚCIWE i dlatego przypięte - `authorCv.ts`,
//     `megaMenu.ts`, `staticPageSeo.ts` i `relatedPosts.ts` błąd POŁYKAJĄ
//     (patrz `smallQueries.test.ts`, `archives.test.ts`, `relatedPosts.test.ts`),
//     więc każda przyszła „unifikacja" tej warstwy ma tu czerwień, zanim
//     zamieni awarię strony sekcyjnej w pustą listę zapamiętaną na 2 minuty;
//   * `staleTime` JEST CZĘŚCIĄ RACHUNKU SSR. Loader `/$` płaci za to zapytanie
//     na serwerze; `staleTime` równy zeru unieważniałby rozgrzany wpis od razu
//     po hydracji i klient wysłałby to samo żądanie po raz drugi.
//
// JAK. Zaślepiona jest DOKŁADNIE jedna granica: klient Supabase (thenable
// łańcuch PostgREST ze wspólnego harnessu `@/test/supabase`). Moduł pokrywany
// NIE jest atrapowany - `archiveListingQueryOptions` i `ARCHIVE_LISTING_LIMIT`
// są prawdziwe, a `queryFn` uruchamiamy prawdziwym `QueryClient.fetchQuery`,
// więc nie ma tu ani jednego rzutowania funkcji. Zero sieci, zero sekretów,
// dane syntetyczne.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * RÓWNOŚCI KLUCZA fabryki i komponentu oraz tego, że rozgrzany wpis daje
//     treść w SSR - dowodzi `publicSurfacesSsrContent.test.tsx` (cztery
//     przypadki, w tym `renderToString` dla pl i en). Tutaj dowodzę drugiej
//     połowy kontraktu klucza: że ROZRÓŻNIA sekcje i że nie niesie języka;
//   * TEGO, ŻE LOADER `/$` W OGÓLE GRZEJE ten klucz - to `publicCatchAllRoute
//     .test.tsx` i `$.tsx:350`;
//   * RENDERU KART LISTY (`PostListCard`, oznaczenie materiału sponsorowanego)
//     - komponenty mają własne testy; tutaj dowodzę wyłącznie, że zapytanie
//     PYTA o kolumny ujawnienia, bo bez nich karta nie ma czym oznaczyć.
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, type RecordedChain, type SupabaseFromStub } from "@/test/supabaseChain";
import { SPONSORED_LIST_COLS } from "@/lib/content/sponsored";

const h = vi.hoisted(() => ({ from: null as SupabaseFromStub | null }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const from = supabaseFromStub();
  h.from = from;
  return { supabase: { from: from.from } };
});

import {
  ARCHIVE_LISTING_LIMIT,
  archiveListingQueryOptions,
  type ArchiveListingRow,
} from "@/lib/queries/archiveListing";

// --- dane syntetyczne -------------------------------------------------------

const SEKCJA = "00000000-0000-4000-8000-0000000000a1";
const INNA_SEKCJA = "00000000-0000-4000-8000-0000000000a2";

function wiersz(slug: string, publishedAt: string | null): ArchiveListingRow {
  return {
    id: `wpis-${slug}`,
    slug,
    title_pl: `Tytuł ${slug}`,
    title_en: `Title ${slug}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: null,
    published_at: publishedAt,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: false,
  };
}

// --- strażniki zawężające (zamiast rzutowań) --------------------------------

function baza(): SupabaseFromStub {
  const s = h.from;
  if (!s) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return s;
}

function lancuch(tabela: string): RecordedChain {
  const c = baza().lastChain(tabela);
  if (!c) throw new Error(`test: kod nie zbudował łańcucha dla tabeli "${tabela}"`);
  return c;
}

/** Argumenty WSZYSTKICH wystąpień ogniwa - liczba wystąpień też jest treścią. */
function ogniwa(chain: RecordedChain, method: string): ReadonlyArray<ReadonlyArray<unknown>> {
  return chain.calls.filter((c) => c.method === method).map((c) => c.args);
}

function filtrEq(chain: RecordedChain, kolumna: string): ReadonlyArray<unknown> | undefined {
  return ogniwa(chain, "eq").find((a) => a[0] === kolumna);
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

beforeEach(() => {
  baza().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ==========================================================================
// KLUCZ - od niego zależy, czy rozgrzewka SSR spotyka się z odczytem klienta
// ==========================================================================

describe("klucz listy sekcyjnej: co rozróżnia, a czego świadomie nie niesie", () => {
  it("ROZRÓŻNIA sekcje - dwie strony sekcyjne nie mogą dzielić wpisu cache", () => {
    // Gdyby klucz był stały (albo gubił rodzica), pierwsza odwiedzona sekcja
    // zapełniłaby wpis, a każda następna oddawałaby JEJ listę - bez żadnego
    // błędu, z poprawnie wyglądającymi kartami.
    expect(archiveListingQueryOptions(SEKCJA).queryKey).not.toEqual(
      archiveListingQueryOptions(INNA_SEKCJA).queryKey,
    );
    expect(archiveListingQueryOptions(SEKCJA).queryKey[1]).toBe(SEKCJA);
  });

  it("NIE niesie języka - jeden wpis cache obsługuje pl i en", () => {
    // To decyzja, nie przeoczenie: wiersz ma kolumny bliźniacze (`title_pl` /
    // `title_en`), więc język wybiera komponent z TYCH SAMYCH danych.
    // Dopisanie języka do klucza podwoiłoby liczbę zapytań i rozgrzewek SSR,
    // nie zmieniając ani jednego wiersza w odpowiedzi.
    expect(archiveListingQueryOptions(SEKCJA).queryKey).toHaveLength(2);
  });

  it("rozgrzany wpis SSR żyje po hydracji - `staleTime` nie jest zerem", () => {
    // Zero unieważniłoby wpis natychmiast po hydracji i klient wysłałby drugie
    // żądanie o tę samą listę, za którą loader już zapłacił na serwerze.
    expect(archiveListingQueryOptions(SEKCJA).staleTime).toBe(2 * 60_000);
  });
});

// ==========================================================================
// ZAPYTANIE - filtry, sortowanie, zacisk
// ==========================================================================

describe("zapytanie listy sekcyjnej: czym zawęża i jak porządkuje", () => {
  it("pyta o wpisy TEJ sekcji, tylko opublikowane i nieusunięte", async () => {
    baza().setResponse("posts", ok([wiersz("traktat", "2026-07-01T09:00:00.000Z")]));
    await klient().fetchQuery(archiveListingQueryOptions(SEKCJA));

    const c = lancuch("posts");
    expect(filtrEq(c, "parent_page_id")).toEqual(["parent_page_id", SEKCJA]);
    expect(filtrEq(c, "status")).toEqual(["status", "published"]);
    expect(ogniwa(c, "is")).toEqual([["deleted_at", null]]);
  });

  it("sortuje od najnowszego JEDNYM ogniwem - i to ogniwo musi istnieć", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(archiveListingQueryOptions(SEKCJA));
    expect(ogniwa(lancuch("posts"), "order")).toEqual([["published_at", { ascending: false }]]);
  });

  it("zacisk długości bierze STAŁĄ, nie literał - 60 po obu stronach hydracji", async () => {
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(archiveListingQueryOptions(SEKCJA));
    expect(ogniwa(lancuch("posts"), "limit")).toEqual([[ARCHIVE_LISTING_LIMIT]]);
    expect(ARCHIVE_LISTING_LIMIT).toBe(60);
  });

  it("pyta o kolumny UJAWNIENIA - bez nich karta nie ma czym oznaczyć materiału", async () => {
    // UPNPR art. 7 pkt 11a: pozycja sponsorowana na liście MUSI być oznaczona.
    // Selekt bez tych trzech kolumn daje kartę bez oznaczenia i test typów tego
    // nie złapie, bo brakujące kolumny przychodzą jako `undefined` z rzutowania.
    baza().setResponse("posts", ok([]));
    await klient().fetchQuery(archiveListingQueryOptions(SEKCJA));

    const kolumny = String(lancuch("posts").argsOf("select")?.[0] ?? "");
    expect(kolumny).toContain(SPONSORED_LIST_COLS);
    for (const kolumna of ["id", "slug", "title_pl", "title_en", "published_at"]) {
      expect(kolumny).toContain(kolumna);
    }
  });
});

// ==========================================================================
// ODPOWIEDŹ - pustka, brak wiersza i odmowa to trzy różne światy
// ==========================================================================

describe("odpowiedź listy sekcyjnej: pustka to nie awaria", () => {
  it("oddaje wiersze BEZ mapowania - kolejność bazy jest kolejnością listy", async () => {
    const wiersze = [
      wiersz("traktat", "2026-07-01T09:00:00.000Z"),
      wiersz("budzet", "2026-06-15T09:00:00.000Z"),
    ];
    baza().setResponse("posts", ok(wiersze));
    await expect(klient().fetchQuery(archiveListingQueryOptions(SEKCJA))).resolves.toEqual(wiersze);
  });

  it("sekcja BEZ opublikowanych wpisów daje pustą listę", async () => {
    baza().setResponse("posts", ok([]));
    await expect(klient().fetchQuery(archiveListingQueryOptions(SEKCJA))).resolves.toEqual([]);
  });

  it("brak wierszy (`null`) też jest pustą listą, a nie rzutem na `.length`", async () => {
    // PostgREST oddaje `data: null` m.in. przy odpowiedzi bez treści. Bez
    // `?? []` komponent dostałby `null` i `rows.map` wywróciłby CAŁĄ stronę
    // sekcyjną - z pustej listy zrobiłby się błąd renderu.
    baza().setResponse("posts", ok(null));
    await expect(klient().fetchQuery(archiveListingQueryOptions(SEKCJA))).resolves.toEqual([]);
  });

  it("ODMOWA bazy RZUCA - strona sekcyjna nie udaje sekcji bez wpisów", async () => {
    // Zachowanie właściwe i dlatego przypięte: rzut przechodzi do granicy
    // błędu, React Query ponawia, a SSR-owy HTML z pustą listą NIE wchodzi do
    // cache brzegowego na 24 h jako „tu nic nie ma".
    baza().setResponse("posts", fail("odmowa listy sekcyjnej", "42501"));
    await expect(klient().fetchQuery(archiveListingQueryOptions(SEKCJA))).rejects.toThrow(
      "odmowa listy sekcyjnej",
    );
  });

  it("odmowa NIE zostawia po sobie danych - błąd wygrywa nad `data`", async () => {
    // PostgREST przy części awarii wypełnia OBA pola. Kolejność w kodzie
    // (`if (error) throw` PRZED `data ?? []`) rozstrzyga, czy klient dostanie
    // szczątkową listę udającą komplet.
    baza().setResponse("posts", () => ({
      data: [wiersz("szczatek", null)],
      error: new Error("częściowa awaria"),
    }));
    await expect(klient().fetchQuery(archiveListingQueryOptions(SEKCJA))).rejects.toThrow(
      "częściowa awaria",
    );
  });
});
