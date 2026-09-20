// UKŁAD JEDNEGO KLUBU (`/club/$clubSlug`) - miejsce, w którym karta klubu jest
// czytana RAZ na dokument.
//
// CO TEN PLIK DOWODZI. Ta trasa powstała 2026-09-20 (audyt CWV, F09) i jest
// jedynym round-tripem dokumentu klubowego. Czternaście tras liściowych robiło
// wcześniej własne `ensureQueryData` na `club_view` PRZED PIERWSZYM BAJTEM,
// a ich wynik zasilał wyłącznie `head()`; komponent czytał INNY klucz, więc to
// samo RPC leciało DRUGI raz po hydratacji, a SSR oddawał szkielet. Układ
// zbiera te odczyty w jeden - i dokłada cztery decyzje, których żadna czysta
// funkcja nie dosięga:
//
//   1. KLUCZ. Rozgrzewka idzie pod `clubKeys.bySlugViewer(slug, null)`, czyli
//      pod DOKŁADNIE tym kluczem, który czyta komponent dla widza anonimowego
//      (a dokument SSR jest anonimowy z konstrukcji - sesja mieszka
//      w localStorage). Rozjazd klucza znosi całą oszczędność po cichu: strona
//      się rysuje, tylko płaci drugim RPC i mrugnięciem szkieletu.
//   2. BUDŻET I JEGO DOMKNIĘCIE. Karta ma 800 ms, a zdegradowany render nie ma
//      prawa trafić na brzeg (`private, no-store`) ani zostawić po sobie wpisu
//      w cache'u: `useClubBySlug` to zwykłe `useQuery`, dla którego `data ===
//      null` znaczy „klubu nie ma" i rysuje kartę „klub nie istnieje". Zasiany
//      przez `loadResilient` fallback zamieniałby więc KAŻDĄ czkawkę bazy
//      w komunikat o usuniętym klubie - stąd `removeQueries`.
//   3. 404 WYŁĄCZNIE Z CZYSTEGO ODCZYTU. Zdegradowany odczyt nie ma prawa
//      wypisać żywego klubu z indeksu; 404 jest prawdą tylko wtedy, gdy baza
//      odpowiedziała i wiersza NIE MA (klub `secret` bez dostępu nie zdradza,
//      że istnieje).
//   4. HINT LCP TYLKO TAM, GDZIE OKŁADKA JEST ELEMENTEM LCP. Reguła mieszka
//      w `clubCoverPreload` (hub za bramką dostępu) i ma tu dwa nośniki naraz:
//      nagłówek `Link` odpowiedzi i `<link>` w `head().links`. Obie drogi
//      muszą nieść TĘ SAMĄ wartość, bo inaczej przeglądarka pobierze plik
//      dwa razy zamiast raz.
//
// JAK. Loader jest wołany JAKO FUNKCJA, bez montowania drzewa (ta sama
// doktryna, co `archiveLoaderResilience.test.ts`): przedmiotem dowodu są
// skutki uboczne loadera - nagłówki odpowiedzi, stan cache'u i rzut `notFound`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁY PRELOADU: `clubCoverPreload.test.ts` (czysta funkcja). Tutaj
//   dowodzimy, że układ ją WOŁA ze ścieżką żądania i kartą klubu oraz że
//   respektuje `null`.
// - `loadResilient` / `notFoundIfClean`: mają własne zakresy w `src/lib/ssr`.
// - ODCZYTU LIŚCI: `clubHeadLoader` ma własny plik, a każda trasa liściowa -
//   swój test montujący ją w izolacji.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** Wiersz `club_view`; `null` = baza odpowiedziała, wiersza nie ma. */
  club: null as unknown,
  /** Odczyt odrzuca - degradacja przez błąd transportu. */
  fetchThrows: false,
  /** Odczyt nigdy się nie rozstrzyga - degradacja przez budżet 800 ms. */
  fetchHangs: false,
  /** Slugi, z jakimi loader poszedł do `club_view` (kontrakt parametru). */
  fetchSlugs: [] as string[],
  /** Nagłówki `Cache-Control` ustawione przez loader. */
  cacheControl: [] as string[],
  /** Wartości nagłówka `Link` dołożone przez loader. */
  linkHeaders: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

vi.mock("@/lib/clubs/publicClub", () => ({
  fetchClubBySlug: (slug: string) => {
    h.fetchSlugs.push(slug);
    if (h.fetchThrows) return Promise.reject(new Error("club_view padło"));
    if (h.fetchHangs) return new Promise(() => undefined);
    return Promise.resolve(h.club);
  },
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { clubKeys } from "@/lib/clubs/queryKeys";
import { toClubHeadSource } from "@/lib/clubs/clubHead";
import { clubCoverPreload } from "@/lib/clubs/clubCoverPreload";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { imagePreloadLink, imagePreloadLinkHeaderValue } from "@/lib/seo/meta";
import { routeHead } from "@/test/routeHarness";
import { clubViewRow } from "@/test/clubs/fixtures";
import { Route as LayoutRoute } from "@/routes/club.$clubSlug";

const SLUG = "klub-energetyczny";
const HUB = `/club/${SLUG}`;
const NO_STORE = "private, no-store";
const OKLADKA = "https://projekt.supabase.co/storage/v1/object/public/media/klub/okladka.jpg";

/** Ładunek loadera układu - dokładnie to, co czyta `head()` i trasy liściowe. */
interface LayoutLoaderData {
  readonly club: ReturnType<typeof toClubHeadSource>;
  readonly coverPreload: ReturnType<typeof clubCoverPreload>;
}

type Loader = (ctx: {
  context: { queryClient: QueryClient };
  location: { pathname: string };
  params: { clubSlug: string };
}) => Promise<LayoutLoaderData>;

/** STRAŻNIK, nie rzutowanie: brak loadera ma być błędem testu. */
function loaderOf(): Loader {
  const loader = LayoutRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: układ nie ma loadera");
  return loader as unknown as Loader;
}

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function uruchom(
  queryClient: QueryClient,
  pathname: string = HUB,
  slug: string = SLUG,
): Promise<LayoutLoaderData> {
  return loaderOf()({
    context: { queryClient },
    location: { pathname },
    params: { clubSlug: slug },
  });
}

/** Wpis cache'u pod kluczem, który grzeje układ - `undefined` = go nie ma. */
function wCache(queryClient: QueryClient, slug: string = SLUG): unknown {
  return queryClient.getQueryData(clubKeys.bySlugViewer(slug, null));
}

beforeEach(() => {
  h.club = clubViewRow();
  h.fetchThrows = false;
  h.fetchHangs = false;
  h.fetchSlugs = [];
  h.cacheControl = [];
  h.linkHeaders = [];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

// --- czysty odczyt ---------------------------------------------------------

describe("układ klubu - czysty odczyt karty", () => {
  it("oddaje WĄSKĄ projekcję karty i zostaje przy polityce treści", async () => {
    const row = clubViewRow({ visibility: "public" });
    h.club = row;
    const queryClient = klient();

    const data = await uruchom(queryClient);

    expect(data.club).toEqual(toClubHeadSource(row));
    expect(h.cacheControl).toEqual([contentCacheControl()]);
  });

  it("grzeje DOKŁADNIE klucz widza anonimowego i pyta RAZ", async () => {
    // Ten sam klucz czyta `useClubBySlug` dla anonima, więc SSR oddaje KARTĘ
    // KLUBU, a nie szkielet. Rozjazd = drugi round-trip po hydratacji.
    const queryClient = klient();

    await uruchom(queryClient);

    expect(h.fetchSlugs).toEqual([SLUG]);
    expect(wCache(queryClient)).toEqual(h.club);
    expect(queryClient.getQueryData(clubKeys.bySlug(SLUG))).toBeUndefined();
  });

  it("czyta slug Z PARAMETRU, nie ze ścieżki żądania ani ze stałej", async () => {
    const queryClient = klient();

    await uruchom(queryClient, "/club/inny-klub", "inny-klub");

    expect(h.fetchSlugs).toEqual(["inny-klub"]);
    expect(wCache(queryClient, "inny-klub")).toEqual(h.club);
  });

  it("czysty `null` to 404 - slug, którego w bazie nie ma, nie renderuje powłoki", async () => {
    // To PRZYPINA stan faktyczny loadera (`notFoundIfClean`), a nie ocenia go:
    // dwa przypadki niżej pokazują, czego ta reguła nie umie odróżnić.
    h.club = null;
    let rzucone: unknown;

    await uruchom(klient(), "/club/nie-ma", "nie-ma").catch((error: unknown) => {
      rzucone = error;
    });

    expect(isNotFound(rzucone)).toBe(true);
  });

  // --- DWA DEFEKTY UJAWNIONE PRZEZ TEN PLIK --------------------------------
  //
  // Oba dotyczą KODU PRODUKCYJNEGO (`src/routes/club.$clubSlug.tsx`), więc nie
  // są tu naprawiane - są OPISANE jako `it.fails` z konsekwencją dla człowieka
  // (ta sama konwencja, co w `publicContent.test.ts`). Gdy łatka wejdzie, oba
  // trzeba przełączyć na zwykłe `it`.

  it.fails(
    "ZERO WIERSZY DLA ANONIMA NIE ZNACZY „KLUBU NIE MA” - członek klubu zamkniętego dostaje 404",
    async () => {
      // `club_view` (migracja 20260808210000, predykat pozytywny) oddaje
      // ANONIMOWI wyłącznie kluby `public` + `active`. Dokument SSR jest
      // z konstrukcji anonimowy (sesja mieszka w localStorage), więc czysty
      // odczyt karty klubu `members`/`private`/`secret`/`draft` ZAWSZE daje
      // `null` - a `notFoundIfClean` zamienia to w twarde HTTP 404 na CAŁYM
      // poddrzewie `/club/<slug>/*`.
      //
      // KONSEKWENCJA: członek klubu zamkniętego, który otwiera link z maila,
      // z LinkedIna albo z zakładki (czyli ZIMNY dokument), dostaje „nie
      // znaleziono" zamiast swojego klubu. Przed F09 loadery liściowe robiły
      // `.catch(() => null)` i nie 404-owały nigdy: dokument oddawał powłokę,
      // a `useClubBySlug` dociągał kartę KLUCZEM Z WIDZEM po hydratacji.
      //
      // ŁATKA: układ nie ma prawa rozstrzygać istnienia klubu z odczytu
      // anonimowego - `const club = card.data;` zamiast `notFoundIfClean(card)`.
      // Rozstrzygnięcie „klub nie istnieje" należy do `ClubHubRoute`, który
      // czyta klucz z widzem i ma już na to gałąź (`club.reason.not_found`).
      h.club = null;
      await expect(uruchom(klient(), HUB)).resolves.toEqual({ club: null, coverPreload: null });
    },
  );

  it.fails("404 NIE POWINIEN ZAMARZAĆ NA BRZEGU - należy mu się `no-store`", async () => {
    // Nagłówek jest ustawiany PRZED rzutem, więc 404 wychodzi z polityką
    // treści (`public, s-maxage=900`). Doktryna repo jest odwrotna i stoi
    // wprost w `category.$slug.tsx`: `resilientCacheControl(degraded ||
    // archive.data === null)` - „slug bywa publikowany minutę po tym, jak
    // crawler go odwiedził".
    //
    // KONSEKWENCJA: 404 na adresie klubu utrwala się na brzegu na 15 minut
    // (plus dobę okna `stale-while-revalidate`), więc klub opublikowany albo
    // otwarty minutę później dalej podaje „nie znaleziono" kolejnym
    // czytelnikom - i crawlerowi, dla którego 404 jest wyrokiem na URL-a.
    //
    // ŁATKA: `setCacheControlHeader(resilientCacheControl(card.degraded ||
    // card.data === null))` w `src/routes/club.$clubSlug.tsx`.
    h.club = null;
    await uruchom(klient(), "/club/nie-ma", "nie-ma").catch(() => undefined);
    expect(h.cacheControl).toEqual([NO_STORE]);
  });
});

// --- hint LCP --------------------------------------------------------------

describe("układ klubu - preload okładki tylko tam, gdzie jest elementem LCP", () => {
  const ZA_BRAMKA = { can_read: false, cover_image_url: OKLADKA };

  it("hub za bramką dostępu dostaje hint NAGŁÓWKIEM i w `head().links`", async () => {
    // Nagłówek `Link` wyprzedza parsowanie dokumentu (i bywa odtworzony jako
    // 103 Early Hint), a `<link>` działa przy nawigacji po stronie klienta.
    // Obie drogi muszą nieść TĘ SAMĄ wartość, żeby przeglądarka rozstrzygnęła
    // JEDNO pobranie - dlatego asercja idzie przeciw tym samym funkcjom, z
    // których korzysta trasa, a nie przeciw wymyślonym napisom.
    h.club = clubViewRow(ZA_BRAMKA);
    // STRAŻNIK, nie asercja niepustości: gdyby reguła przestała uznawać hub za
    // miejsce preloadu, test ma paść TUTAJ, z czytelnym komunikatem.
    const oczekiwany = clubCoverPreload(ZA_BRAMKA, HUB);
    if (oczekiwany === null) throw new Error("test: hub za bramką powinien dostać hint okładki");

    const data = await uruchom(klient());

    expect(data.coverPreload).toEqual(oczekiwany);
    expect(h.linkHeaders).toEqual([imagePreloadLinkHeaderValue(oczekiwany)]);
    expect(routeHead(LayoutRoute, { loaderData: data }).links).toEqual([
      imagePreloadLink(oczekiwany),
    ]);
  });

  it("KLUB OTWARTY nie dostaje hintu - hub rysuje wtedy widok bez obrazu nad zgięciem", async () => {
    h.club = clubViewRow({ can_read: true, cover_image_url: OKLADKA });

    const data = await uruchom(klient());

    expect(data.coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
    expect(routeHead(LayoutRoute, { loaderData: data }).links).toEqual([]);
  });

  it("POWIERZCHNIA POD HUBEM nie dostaje hintu, choć karta jest ta sama", async () => {
    // Reguła liczy się ze ŚCIEŻKI ŻĄDANIA, nie z karty: baner rysuje też
    // `ClubWorkspaceLayout`, ale to ślepy zaułek dla czytelnika bez dostępu.
    h.club = clubViewRow(ZA_BRAMKA);

    const data = await uruchom(klient(), `${HUB}/members`);

    expect(data.coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });

  it("`head()` bez ładunku loadera oddaje PUSTE `links`, a nie wyjątek", async () => {
    // Degradacja i nawigacja po stronie klienta potrafią zawołać `head()`
    // zanim ładunek istnieje - pusta lista jest tu jedyną bezpieczną odpowiedzią.
    expect(routeHead(LayoutRoute, {}).links).toEqual([]);
  });
});

// --- degradacja ------------------------------------------------------------

describe("układ klubu - degradacja nie wypisuje klubu z indeksu ani z brzegu", () => {
  it("BŁĄD ODCZYTU daje pustą kartę, `no-store` i NIE rzuca 404", async () => {
    // 404 na żywym, zaindeksowanym klubie to wyrok na URL-a: wyszukiwarka
    // wyrzuca go z indeksu, a powrót zajmuje dni.
    h.fetchThrows = true;
    const queryClient = klient();

    const data = await uruchom(queryClient);

    expect(data.club).toBeNull();
    expect(h.cacheControl).toEqual([NO_STORE]);
  });

  it("BŁĄD ODCZYTU zostawia cache PUSTY - `removeQueries`, nie zasiany `null`", async () => {
    // `useClubBySlug` to zwykłe `useQuery`: `data === null` znaczy dla niego
    // „klubu nie ma" i rysuje kartę „klub nie istnieje". Zasiany fallback
    // zamieniłby każdą czkawkę bazy w komunikat o usuniętym klubie.
    h.fetchThrows = true;
    const queryClient = klient();

    await uruchom(queryClient);

    expect(wCache(queryClient)).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: clubKeys.bySlugViewer(SLUG, null) })).toBe(
      undefined,
    );
  });

  it("ZWIS PONAD BUDŻET 800 ms degraduje tak samo jak błąd", async () => {
    // Budżet jest świadomie KRÓTKI: karta jest jedynym round-tripem dokumentu,
    // a jej brak nie blokuje renderu (komponent dociągnie ją po hydratacji).
    // Lepiej oddać dokument w 800 ms z pustą kartą niż trzymać czytelnika
    // 4 s na domyślnym budżecie loadera.
    vi.useFakeTimers();
    try {
      h.fetchHangs = true;
      const queryClient = klient();
      const bieg = uruchom(queryClient);

      await vi.advanceTimersByTimeAsync(800);
      const data = await bieg;

      expect(data.club).toBeNull();
      expect(data.coverPreload).toBeNull();
      expect(h.cacheControl).toEqual([NO_STORE]);
      expect(wCache(queryClient)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("zdegradowany odczyt NIE emituje hintu okładki", async () => {
    // Preload pliku, którego dokument i tak nie namaluje, to czysta strata
    // pasma na ścieżce krytycznej - a zdegradowany render nie zna okładki.
    h.fetchThrows = true;

    const data = await uruchom(klient());

    expect(data.coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });
});
