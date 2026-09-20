// `clubHeadLoader` - loader nagłówka trasy LIŚCIOWEJ klubu po przebudowie F09.
//
// CO TEN PLIK DOWODZI. Do 2026-09-20 czternaście tras `/club/$clubSlug/*`
// robiło w loaderze własne `ensureQueryData` na `club_view` - pełny round-trip
// PRZED PIERWSZYM BAJTEM, którego wynik zasilał wyłącznie `head()`. Audyt CWV
// (F09) zdjął go do JEDNEGO odczytu w loaderze UKŁADU `/club/$clubSlug`,
// a liściom został sam odczyt z cache'u. Ta zamiana ma trzy miejsca, w których
// łatwo o cichą regresję, i każde z nich kosztuje inaczej:
//
//   1. BRAK `await parentMatchPromise`. Loadery całego łańcucha dopasowań
//      startują RÓWNOLEGLE (`@tanstack/router-core`, `createLoaderTask` dla
//      każdego indeksu naraz), więc samo `getQueryData` czytałoby cache PUSTY
//      i KAŻDA trasa liściowa emitowałaby `noindex` - dokładnie tę regresję,
//      przed którą broni `isClubIndexable`. To jest najdroższy z trzech
//      błędów: niewidoczny na ekranie, a wypisuje klub publiczny z indeksu.
//   2. ROZJAZD KLUCZA. Układ grzeje klucz widza ANONIMOWEGO, bo dokument SSR
//      jest z konstrukcji anonimowy (sesja mieszka w localStorage). Odczyt
//      spod `clubKeys.bySlug` albo spod klucza z widzem trafia w pustkę -
//      efekt jak wyżej, tylko trudniej go znaleźć.
//   3. POWRÓT DO ROUND-TRIPU. Loader, który przy pustym cache'u „dociągnie"
//      kartę sam, znosi całą oszczędność F09 i robi to po cichu - dlatego
//      pusty cache MUSI dać `null`, a nie zapytanie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `toClubHeadSource`, `isClubIndexable`
// i `buildClubHead` (reguły nagłówka i polityka pustki) mają własny zakres
// w `clubPureModules.test.ts`. Tutaj dowodzimy WYWOŁANIA: co loader czyta,
// kiedy to czyta i co z tego przepuszcza dalej.
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { clubHeadLoader, toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { clubViewRow } from "@/test/clubs/fixtures";

const SLUG = "klub-energetyczny";

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("clubHeadLoader - karta z cache'u układu, zero round-tripów", () => {
  it("czyta DOKŁADNIE klucz widza anonimowego, który grzeje układ", async () => {
    const queryClient = klient();
    const row = clubViewRow({ visibility: "public" });
    queryClient.setQueryData(clubKeys.bySlugViewer(SLUG, null), row);

    await expect(clubHeadLoader(queryClient, SLUG, Promise.resolve())).resolves.toEqual({
      club: toClubHeadSource(row),
    });
  });

  it("wpis pod `clubKeys.bySlug` NIE jest tym kluczem - rozjazd daje `null`", async () => {
    // Kontrola negatywna rozjazdu kluczy: stary klucz loadera liścia jest
    // PREFIKSEM nowego, więc pomyłka nie wywala się na typach ani na runtime -
    // tylko cicho odbiera klubowi publicznemu indeksowalność.
    const queryClient = klient();
    queryClient.setQueryData(clubKeys.bySlug(SLUG), clubViewRow({ visibility: "public" }));

    await expect(clubHeadLoader(queryClient, SLUG, Promise.resolve())).resolves.toEqual({
      club: null,
    });
  });

  it("karta INNEGO klubu nie wycieka - klucz niesie slug z parametru", async () => {
    const queryClient = klient();
    queryClient.setQueryData(clubKeys.bySlugViewer("inny-klub", null), clubViewRow());

    await expect(clubHeadLoader(queryClient, SLUG, Promise.resolve())).resolves.toEqual({
      club: null,
    });
  });

  it("CZEKA na loader rodzica, zanim sięgnie do cache'u", async () => {
    // Bez tego oczekiwania cache jest w chwili odczytu jeszcze pusty (loadery
    // łańcucha startują równolegle), a nagłówek schodzi na `noindex` mimo
    // sprawnego backendu. Obietnica rodzica wypełnia tu cache DOPIERO przy
    // rozwiązaniu - loader, który jej nie czeka, dostanie `null`.
    const queryClient = klient();
    const row = clubViewRow({ visibility: "public" });
    const rodzic = Promise.resolve().then(() => {
      queryClient.setQueryData(clubKeys.bySlugViewer(SLUG, null), row);
    });

    await expect(clubHeadLoader(queryClient, SLUG, rodzic)).resolves.toEqual({
      club: toClubHeadSource(row),
    });
  });

  it("PUSTY cache (układ zdegradował) daje `null`, a nie własne zapytanie", async () => {
    // `null` to bezpieczny domysł `noindex`. Gdyby loader „dociągał" kartę
    // sam, wróciłby round-trip, który F09 właśnie zdjął - dowodem jest brak
    // NOWEGO wpisu w cache'u po wywołaniu.
    const queryClient = klient();

    await expect(clubHeadLoader(queryClient, SLUG, Promise.resolve())).resolves.toEqual({
      club: null,
    });
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("czysty `null` w cache'u (klub usunięty) też daje `null`, bez wyjątku", async () => {
    const queryClient = klient();
    queryClient.setQueryData(clubKeys.bySlugViewer(SLUG, null), null);

    await expect(clubHeadLoader(queryClient, SLUG, Promise.resolve())).resolves.toEqual({
      club: null,
    });
  });

  it("odczyt NIE dokłada ani jednego wpisu do cache'u", async () => {
    // Loader nagłówka jest CZYTELNIKIEM: każdy dodatkowy wpis znaczy, że ktoś
    // wrócił do `ensureQueryData` i zapłacił round-tripem na dokument.
    const queryClient = klient();
    queryClient.setQueryData(clubKeys.bySlugViewer(SLUG, null), clubViewRow());

    await clubHeadLoader(queryClient, SLUG, Promise.resolve());
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it("do nagłówka jedzie WĄSKA projekcja, bez pól autorytetu dostępu", async () => {
    // `ClubHeadSource` ma sześć pól z premedytacją: im mniej, tym mniejsza
    // szansa, że do `head()` (a stąd do HTML-a każdego dokumentu) trafi coś,
    // czego czytelnik nie ma prawa zobaczyć.
    const queryClient = klient();
    queryClient.setQueryData(clubKeys.bySlugViewer(SLUG, null), clubViewRow());

    const { club } = await clubHeadLoader(queryClient, SLUG, Promise.resolve());
    expect(club).not.toBeNull();
    expect(Object.keys(club ?? {}).sort()).toEqual([
      "coverImageUrl",
      "nameEn",
      "namePl",
      "taglineEn",
      "taglinePl",
      "visibility",
    ]);
  });
});
