// POWIERZCHNIE RATUNKOWE I PRELOAD OKŁADKI trasy łapiącej wszystko
// (`src/routes/$.tsx`) - czyli KAŻDEJ strony i KAŻDEGO wpisu CMS-a.
//
// PO CO OSOBNY PLIK OBOK `publicResolverRoute.test.tsx`. Tamten dowodzi
// GRAMATYKI ADRESU: że loader woła czyste funkcje z `lib/routing` i zamienia
// ich deskryptory na `notFound()` / `redirect()` / nagłówek cache. Ten plik
// dowodzi drugiej połowy tej samej trasy - tego, CO WIDZI CZYTELNIK I ROBOT,
// kiedy adres już się rozstrzygnął:
//
//   * `errorComponent` (`PublicErrorComponent`) - ostatnia linia obrony trasy,
//     na którą spada KAŻDY nieprzechwycony rzut z drzewa treści. Zmierzone
//     przed napisaniem tego pliku: `3/31` funkcji `$.tsx` było kiedykolwiek
//     wywołanych, więc ekran błędu każdej strony CMS-a nie był renderowany
//     ANI RAZU - a to on decyduje, czy czytelnik dostanie zdanie po ludzku,
//     czy wyciek diagnostyki;
//   * `notFoundComponent` / `pendingComponent` - dwie pozostałe powierzchnie
//     podpięte w `Route.options`, sprawdzane PRZEZ TRASĘ, a nie przez import
//     komponentu, bo przedmiotem dowodu jest właśnie PODPIĘCIE (rozpięte
//     `errorComponent` nie wywala żadnego typu, tylko cicho oddaje surowy
//     ekran frameworka);
//   * `head()` na wpisie - preload obrazu LCP, tagi Highwire i kolejność
//     okruszków w JSON-LD;
//   * `buildCoverPreload` przez LOADER - jedyna droga, bo funkcja nie jest
//     eksportowana, a jest regułą wydajnościową (jeden pobrany kandydat
//     obrazu, nie dwa).
//
// CZEGO TEN PLIK ŚWIADOMIE NIE ROBI: nie renderuje `PublicPage`/`ResolvedPage`.
// Uzasadnienie i pomiar - w komentarzu przy końcu pliku, nad blokiem
// `Route.options.component`.
//
// Zero sieci: cała warstwa Supabase to atrapa łańcucha z `@/test/supabaseChain`,
// wszystkie adresy w `example.com`, dane treści syntetyczne.
import { QueryClient } from "@tanstack/react-query";
import { isNotFound } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, supabaseFromStub } from "@/test/supabaseChain";
import { routeHead, type RouteHeadResult } from "@/test/routeHarness";

const h = vi.hoisted(() => ({
  /** Język renderu - wstrzykiwany do `currentLang`, patrz atrapa niżej. */
  lang: "pl" as "pl" | "en",
  /** Liczba wywołań `router.invalidate()` z przycisku „spróbuj ponownie". */
  invalidateCalls: 0,
  /** Wartości `setCacheControlHeader(...)` w kolejności wywołań. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` - tu ląduje preload obrazu LCP. */
  linkHeaders: [] as string[],
  /** Adres żądania widziany przez `getRequestUrl()` (SSR: nagłówki, klient: URL). */
  requestUrl: "",
  /** Kontekst, z jakim loader rozgrzewa zapytania silnika bloków. */
  blocksPrefetchCtx: [] as Record<string, unknown>[],
  /** Pierwsze argumenty `console.error(...)` - patrz wyciszenie w bloku ekranu błędu. */
  consoleErrors: [] as unknown[],
  /** Gdy ustawione, KAŻDE wywołanie RPC oddaje ten błąd (awaria bazy). */
  rpcError: null as { message: string } | null,
  /** Gdy `true`, KAŻDE wywołanie RPC WISI - baza przyjęła zapytanie i milczy. */
  rpcHang: false,
  /**
   * Czy loader biegnie na SERWERZE. Wstrzykiwane, a nie dziedziczone po
   * środowisku testowym: od tej jednej wartości zależy, czy trasa zakłada
   * wspólny termin żądania, czy czeka na dane bez ograniczenia (nawigacja SPA).
   */
  isServer: true,
  /**
   * KOLEJNOŚĆ STARTÓW round-tripów - tabela albo `rpc:<nazwa>`. To jest jedyny
   * sposób, żeby zobaczyć, że rozgrzewki niezależne od treści RUSZAJĄ PRZED
   * fazą główną, a nie po niej (stan cache'u mówi tylko, że kiedyś ruszyły).
   */
  zapytania: [] as string[],
  /** Wywołania `widgetPreloadHeaders(doc, n)` z loadera - liczba sekcji i limit. */
  widgetPreloads: [] as Array<{ sekcje: number; ile: number }>,
  /** Jak ma się zachować rozgrzewka bloków. */
  blocksPrefetch: "ok" as "ok" | "reject" | "hang" | "degraded",
  /** Języki, z jakimi loader zawołał rozgrzewkę sekcji nad zgięciem. */
  aboveFoldLangs: [] as string[],
  /** Czy rozgrzewka nad zgięciem ma oddać sygnał degradacji (rozstrzygnięta SUKCESEM). */
  aboveFoldDegraded: false,
}));

// JĘZYK RENDERU JAKO WSTRZYKIWANE WEJŚCIE, nie jako stan globalny.
// PRAWDZIWY `currentLang` jest `createIsomorphicFn()` i w środowisku testowym
// rozstrzyga się na gałąź SERWEROWĄ, w której `getRequest()` rzuca poza
// zasięgiem żądania h3, a `catch` oddaje `DEFAULT_LANG` - czyli `setClientLang`
// go NIE PRZESTAWIA i asercja „wersja angielska" mierzyłaby polski render pod
// angielską nazwą (ta sama pułapka jest opisana w
// `components/error/__tests__/FriendlyErrorPage.test.tsx` i w `src/test/i18nReal.ts`).
// Atrapa jest CZĄSTKOWA: podmienia wyłącznie `currentLang`, więc mapowanie
// język -> słownik w `errorCopy` i język -> prefiks trasy zostają prawdziwe.
vi.mock("@/lib/i18n/localeRuntime", async (o) => ({
  ...(await o<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));

// `useRouter()` czyta kontekst routera, którego goły render nie ma
// (`TypeError: Cannot read properties of null (reading 'isServer')`). Atrapa
// jest cząstkowa i dotyczy JEDNEGO haka - `createFileRoute`, `notFound`
// i `redirect` zostają prawdziwe, bo to na nich stoi cała trasa.
vi.mock("@tanstack/react-router", async (o) => ({
  ...(await o<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({
    invalidate: () => {
      h.invalidateCalls += 1;
      return Promise.resolve();
    },
  }),
}));

// ŚRODOWISKO WYKONANIA LOADERA JAKO WSTRZYKIWANE WEJŚCIE. Trasa zakłada
// wspólny termin żądania WYŁĄCZNIE pod `isServer` (w przeglądarce jeden
// `QueryClient` żyje całą sesję, więc termin z pierwszej nawigacji unieważniłby
// wszystkie kolejne). Bez tej atrapy wynik zależałby od warunków rozwiązywania
// modułów w vitest, a nie od przedmiotu dowodu - ten sam wzór stoi
// w `rootRoute.test.tsx` i `homeRoute.test.tsx`.
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return h.isServer;
  },
}));

// Hinty modułów widgetów. Prawdziwa mapa `WIDGET_CHUNK_URLS` jest PUSTA poza
// buildem serwerowym (podmieniana, gdy znane są nazwy chunków przeglądarki),
// więc prawdziwa funkcja oddałaby tu zawsze `[]` i dowód byłby pusty.
// Przedmiotem dowodu jest kontrakt TRASY: że woła hinty dla dokumentu treści
// i przepuszcza KAŻDY z nich przez nagłówek `Link`.
const HINT_WIDGETU = '</assets/widget-hero-abc.js>; rel="modulepreload"; crossorigin';

vi.mock("@/lib/seo/widgetPreloads", async (o) => ({
  ...(await o<typeof import("@/lib/seo/widgetPreloads")>()),
  widgetPreloadHeaders: (doc: { sections?: unknown[] }, ile: number) => {
    h.widgetPreloads.push({ sekcje: doc.sections?.length ?? 0, ile });
    return [HINT_WIDGETU];
  },
}));

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      h.zapytania.push(table);
      return stub.from(table);
    },
    // `resolve_path` i `get_entity_content` - w tym pliku treść wchodzi do
    // cache'u zapytań WPROST (patrz `runLoader`), więc RPC domyślnie odpowiada
    // pusto. Awaria bazy ma własny przypadek i włącza się przez `h.rpcError`,
    // a ZAWIESZENIE (najczęstszy kształt awarii) przez `h.rpcHang`.
    rpc: (name: string) => {
      h.zapytania.push(`rpc:${name}`);
      if (h.rpcHang) return new Promise(() => {});
      return Promise.resolve(
        h.rpcError ? { data: null, error: h.rpcError } : { data: null, error: null },
      );
    },
  },
}));

// Nagłówki odpowiedzi jako REJESTR, nie jako efekt uboczny h3: prawdziwy
// `appendLinkHeader` sięga po obiekt żądania serwera, którego test nie stawia,
// a jego wartość JEST tu przedmiotem dowodu (preload LCP z nagłówków startuje
// przed parsowaniem HTML - droga do 103 Early Hints).
vi.mock("@/lib/http/responseHeaders", async (o) => ({
  ...(await o<typeof import("@/lib/http/responseHeaders")>()),
  setCacheControlHeader: (value: string) => {
    h.cacheControl.push(value);
  },
  appendLinkHeader: (value: string) => {
    h.linkHeaders.push(value);
  },
}));

vi.mock("@/lib/seo/request", async (o) => ({
  ...(await o<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

// Rozgrzewka zapytań silnika bloków przechwycona po to, żeby ZOBACZYĆ jej
// KONTEKST. To nie jest wyciszenie: klucze warstwy powiązanej (related / more
// posts / bio autora) są liczone z `authorId` + `categorySlugs` + `tagSlugs`,
// a jeśli loader poda tu inny zestaw niż klient w `useCurrentPostCtx`, wpisy
// rozgrzane na SSR MIJAJĄ SIĘ z zapytaniami po hydracji i robot widzi listy
// niezależne od kategorii. Prawdziwa funkcja tylko by je pobrała - nie
// powiedziałaby, CZYM je zapytała.
vi.mock("@/lib/queries/blocks", async (o) => ({
  ...(await o<typeof import("@/lib/queries/blocks")>()),
  prefetchBlockQueries: async (
    _client: unknown,
    _doc: unknown,
    _lang: unknown,
    ctx: Record<string, unknown> = {},
  ) => {
    h.blocksPrefetchCtx.push({ ...ctx });
    // TRZY ścieżki degradacji prefetchu wtórnego, wszystkie realne w produkcji:
    // odrzucenie (upstream oddał błąd), zawieszenie (budżet 3 000 ms mija)
    // oraz - najczęstsza i do 2026-09-13 NIEWIDOCZNA - rozstrzygnięcie
    // SUKCESEM z sygnałem `degraded`, bo prawdziwa funkcja pochłania awarie
    // pojedynczych bloków w `Promise.allSettled` i nigdy nie odrzuca.
    if (h.blocksPrefetch === "reject") throw new Error("blocks_data unreachable");
    if (h.blocksPrefetch === "hang") await new Promise(() => {});
    return { degraded: h.blocksPrefetch === "degraded" };
  },
}));

// Rozgrzewka sekcji NAD ZGIĘCIEM przechwycona tą samą metodą i dokładnie z tego
// samego powodu, co rozgrzewka bloków wyżej: prawdziwa funkcja NIGDY NIE
// ODRZUCA - ma własny budżet 2 500 ms i po jego przekroczeniu rozstrzyga się
// normalnie - więc jedynym sygnałem awarii jest pole `degraded` w wyniku
// ROZSTRZYGNIĘTYM SUKCESEM. Bez atrapy nie widać ani tego sygnału, ani samego
// faktu, że loader w ogóle zawołał rozgrzewkę i z jakim językiem.
vi.mock("@/lib/builder/prefetch", async (o) => ({
  ...(await o<typeof import("@/lib/builder/prefetch")>()),
  prefetchAboveFoldQueries: async (_client: unknown, _doc: unknown, lang: unknown) => {
    h.aboveFoldLangs.push(String(lang));
    return { degraded: h.aboveFoldDegraded };
  },
}));

// Stary adres wpisu: w tym pliku nie badamy przekierowań (robi to
// `publicResolverRoute.test.tsx`), a prawdziwa funkcja dokładałaby round-trip
// do atrapy Supabase w każdym przypadku „treści nie ma".
vi.mock("@/lib/routing/legacyPostPath", () => ({
  resolveLegacyPostPath: async () => null,
}));

import { errorCopy } from "@/lib/errorCopy";
import {
  resolvedContentQueryOptions,
  type PostData,
  type ResolvedContent,
} from "@/lib/queries/public";
import { adPlacementsQueryOptions } from "@/lib/ads/queries";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { splatToSegments } from "@/lib/routing/publicSegments";
import { routeSsrDeadline } from "@/lib/ssr/routeSsrDeadline";
import { Route } from "@/routes/$";

/**
 * Wspólny termin żądania tej trasy (`CONTENT_SSR_BUDGET_MS` w `$.tsx`).
 * Kopia LICZBY, nie import: stała nie jest eksportowana, a bramka
 * `check:ssr-budgets` wymaga, żeby budżety były literałami w pliku trasy.
 * Rozjazd łapie przypadek „ZAWIESZONA baza..." - przy podniesionym budżecie
 * loader nie zdąży zdegradować w tym oknie i test zapali się na czerwono.
 */
const TERMIN_ZADANIA_MS = 1_500;

// --- dane syntetyczne -------------------------------------------------------

/**
 * Okładka na ŚCIEŻCE MAGAZYNU Supabase, a nie dowolny adres: `buildImageSrcSet`
 * oddaje `""` dla URL-a, którego nie umie przeskalować (`cropSizes.ts:152`), więc
 * na adresie bez `/storage/v1/object/public/` cały dowód o kandydatach
 * responsywnych byłby pusty - preload wyszedłby bez `imagesrcset` i test
 * „przechodziłby" na braku danych.
 */
const COVER_URL = "https://media.example.com/storage/v1/object/public/covers/atom.jpg";

function postItem(overrides: Partial<PostData> = {}): PostData {
  return {
    id: "post-1",
    slug: "atom",
    title_pl: "Atom w Europie",
    title_en: "Atom in Europe",
    content_pl: null,
    content_en: null,
    excerpt_pl: "Zapowiedź analizy po polsku.",
    excerpt_en: "Analysis teaser in English.",
    editor: "richtext",
    builder_data: null,
    cover_image_url: COVER_URL,
    published_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    seo_title_pl: null,
    seo_title_en: null,
    seo_description_pl: null,
    seo_description_en: null,
    seo_canonical_url: null,
    seo_noindex: false,
    seo_og_image_url: null,
    og_image_generated_url: null,
    takeaways_pl: [],
    takeaways_en: [],
    takeaways_variant: null,
    read_minutes: 7,
    post_format: "standard",
    layout_overrides: null,
    custom_meta: null,
    related_override: null,
    author_id: "author-1",
    toc_override: null,
    audio_url_pl: null,
    audio_url_en: null,
    organization_id: null,
    organization_name: null,
    organization_logo_url: null,
    organization_website: null,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_advertiser_name: null,
    sponsored_advertiser_url: null,
    sponsored_payer_name: null,
    sponsored_note_pl: null,
    sponsored_note_en: null,
    sponsored_affiliate: false,
    sponsored_political: false,
    sponsored_political_process: null,
    sponsored_sponsor_controller: null,
    ...overrides,
  };
}

type ResolvedPost = Extract<ResolvedContent, { kind: "post" }>;

/**
 * Okruszki podane CELOWO W ODWROTNEJ KOLEJNOŚCI GŁĘBOKOŚCI. `head()` sortuje je
 * po `depth`, a rezolwer nie obiecuje uporządkowania - test na już posortowanej
 * liście nie odróżniłby sortowania od jego braku.
 */
const CRUMBS_ODWROTNIE = [
  {
    id: "page-2",
    slug: "atom",
    title_pl: "Atom",
    title_en: "Atom",
    depth: 2,
    full_path: "analizy/atom",
  },
  {
    id: "page-1",
    slug: "analizy",
    title_pl: "Analizy",
    title_en: "Analyses",
    depth: 1,
    full_path: "analizy",
  },
];

function resolvedPost(overrides: Partial<ResolvedPost> = {}): ResolvedPost {
  return {
    kind: "post",
    item: postItem(),
    crumbs: CRUMBS_ODWROTNIE,
    parentPageId: "page-1",
    tags: [{ slug: "energia", name: "Energia" }],
    categories: [{ slug: "analizy", name_pl: "Analizy", name_en: "Analyses", color: null }],
    author: null,
    authors: [
      {
        id: "author-1",
        slug: "anna-nowak",
        display_name: "Anna Nowak",
        first_name: "Anna",
        last_name: "Nowak",
      },
    ],
    access: null,
    ...overrides,
  };
}

// --- zawężenia opcji trasy (strażniki, nie rzutowania) ----------------------

type ErrorScreen = (props: { error: Error; reset: () => void }) => React.ReactElement;

/**
 * `errorComponent` trasy jako funkcja. `unknown` W DEKLARACJI ze strażnikiem
 * `typeof`, a nie `as unknown as` w zwrocie: wygenerowane typy trasy opisują tę
 * opcję pełnym kontekstem routera, którego test nie stawia, ale zejście przez
 * `unknown` z jawnym sprawdzeniem w runtime jest zwykłym zawężeniem. Brak opcji
 * to BŁĄD TESTU, nie `undefined` - test, który „przechodzi" na rozpiętym ekranie
 * błędu, nie dowodzi niczego.
 */
function errorScreen(): ErrorScreen {
  const fn: unknown = Route.options.errorComponent;
  if (typeof fn !== "function") throw new Error("test: trasa `/$` nie ma `errorComponent`");
  return fn as ErrorScreen;
}

/** `notFoundComponent` / `pendingComponent` - to samo zawężenie, ta sama zasada. */
function bezpropsowyEkran(
  nazwa: "notFoundComponent" | "pendingComponent",
): () => React.ReactElement {
  const fn: unknown = Route.options[nazwa];
  if (typeof fn !== "function") throw new Error(`test: trasa \`/$\` nie ma \`${nazwa}\``);
  return fn as () => React.ReactElement;
}

type Loader = (args: {
  params: { _splat?: string };
  context: { queryClient: QueryClient };
}) => Promise<unknown>;

function loader(): Loader {
  const fn: unknown = Route.options.loader;
  if (typeof fn !== "function") throw new Error("test: trasa `/$` nie ma loadera");
  return fn as Loader;
}

/** Wynik loadera w części, której dotyczą asercje tego pliku. */
interface WynikLoadera {
  kind?: unknown;
  degraded?: unknown;
  coverPreload?: { href?: unknown; imageSrcSet?: unknown; imageSizes?: unknown } | null;
}

/**
 * Uruchamia loader na świeżym kliencie zapytań, z treścią WSTRZYKNIĘTĄ do
 * cache'u pod kluczem, którego loader użyje.
 *
 * PO CO ZASIEW, A NIE PRZEJŚCIE PRZEZ SUPABASE. Rezolucja adresu w treść to
 * ~10 round-tripów (`resolve_path`, wiersz wpisu, gated body, tagi, kategorie,
 * współautorzy, okruszki, reguła dostępu) i ma WŁASNY dowód
 * (`lib/queries/__tests__/publicContent.test.ts`). Tutaj przedmiotem dowodu jest
 * to, co loader robi PO rozstrzygnięciu treści: preload okładki, kontekst
 * rozgrzewki bloków i nagłówki. `ensureQueryData` na świeżym wpisie (staleTime
 * 10 min) oddaje go bez fetcha, czyli dokładnie tak, jak w produkcji na trafionym
 * cache'u dokumentów.
 */
async function runLoader(
  splat: string,
  tresc?: ResolvedContent,
  {
    ustawieniaSerwisu = true,
    zuzytyTermin,
  }: { ustawieniaSerwisu?: boolean; zuzytyTermin?: number } = {},
): Promise<{ wynik: unknown; queryClient: QueryClient }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // TERMIN ZAŁOŻONY PRZED LOADEREM = „część budżetu żądania już poszła".
  // To nie jest sztuczka testowa, tylko PRODUKCYJNY kształt tej trasy: zegar
  // mieszka pod `QueryClient`em żądania i zakłada go PIERWSZY wołający -
  // czasem loader korzenia, czasem ten loader (`lib/ssr/routeSsrDeadline.ts`).
  // Podanie tu 300 ms odtwarza stan „na fazę wtórną zostało 300 ms".
  if (zuzytyTermin !== undefined) routeSsrDeadline(queryClient, zuzytyTermin);
  if (tresc) {
    const opcje = resolvedContentQueryOptions(splatToSegments(splat));
    queryClient.setQueryData(opcje.queryKey, tresc);
  }
  // USTAWIENIA SERWISU ZASIANE DOMYŚLNIE, bo tak wygląda produkcja: fala 1
  // loadera korzenia (`__root.tsx:346-354`) rozgrzewa `siteSettingsQueryOptions`
  // RÓWNOLEGLE do loadera trasy, więc na czystym renderze ta trasa czyta je
  // z cache'u i nie płaci round-tripu. Bez zasiewu KAŻDY przypadek tego pliku
  // mierzyłby render ZDEGRADOWANY (od 2026-09-12 brak ustawień zdejmuje
  // `Cache-Control` wspólnego cache'u), czyli co innego, niż nazywa.
  if (ustawieniaSerwisu) {
    queryClient.setQueryData(siteSettingsQueryOptions.queryKey, { seo: null });
  }
  try {
    return {
      wynik: await loader()({ params: { _splat: splat }, context: { queryClient } }),
      queryClient,
    };
  } catch (thrown) {
    return { wynik: thrown, queryClient };
  }
}

/** Zawężenie wyniku loadera W RUNTIME - zamiast rzutowania na kształt. */
function jakoWynik(wynik: unknown): WynikLoadera {
  if (typeof wynik !== "object" || wynik === null) {
    throw new Error(`test: loader nie oddał ładunku treści (dostano ${String(wynik)})`);
  }
  return { ...wynik };
}

beforeEach(() => {
  stub.reset();
  h.lang = "pl";
  h.invalidateCalls = 0;
  h.cacheControl = [];
  h.linkHeaders = [];
  h.requestUrl = "";
  h.blocksPrefetchCtx = [];
  h.rpcError = null;
  h.rpcHang = false;
  h.isServer = true;
  h.zapytania = [];
  h.widgetPreloads = [];
  h.blocksPrefetch = "ok";
  h.aboveFoldLangs = [];
  h.aboveFoldDegraded = false;
  // Domyślnie: adres nie trafia w żadne archiwum taksonomii (gałąź „treści nie ma").
  stub.setResponse("categories", ok(null));
  stub.setResponse("tags", ok(null));
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// EKRAN BŁĘDU - najważniejsza powierzchnia tego pliku.
// ===========================================================================
//
// `errorComponent` trasy `/$` łapie rzuty z CAŁEGO drzewa treści: renderera
// bloków, powłoki buildera, paywalla, przypisów, reklam, powiązanych wpisów.
// Dla czytelnika i dla robota jest to więc ostatnia rzecz, jaką zobaczą, gdy
// strona nie wstanie - i jedyne miejsce, w którym może wyciec surowy komunikat
// błędu z serwera.
describe("PublicErrorComponent - ekran błędu każdej strony CMS-a", () => {
  // `console.error(error)` jest ZACHOWANIEM PRODUKCYJNYM tego ekranu, nie
  // przypadkiem: błąd MUSI zostać w konsoli przeglądarki. Przekierowujemy je
  // więc do rejestru (log suity nie ma wyglądać na czerwony) i PRZYWRACAMY po
  // każdym przypadku - a sam rejestr jest połową dowodu w przypadku
  // „diagnostyka tak, czytelnik nie".
  beforeEach(() => {
    h.consoleErrors = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      h.consoleErrors.push(args[0]);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Komunikat z NAJGORSZEGO realnego przypadku: ścieżka pliku na serwerze,
   * nazwa tabeli i fragment zapytania. Dokładnie tego rodzaju treść niosą błędy
   * PostgREST i rzuty z loadera, i dokładnie ona nie ma prawa dojść do
   * czytelnika (`$.tsx:549-550`).
   */
  const BLAD_Z_DIAGNOSTYKA = new Error(
    "permission denied for table posts_private (select id, body from posts_private) at /srv/app/src/lib/queries/public.ts:672",
  );

  it("renderuje się bez rzutu i pokazuje tytuł, treść i przycisk ze słownika", () => {
    const Ekran = errorScreen();
    const copy = errorCopy();
    expect(() => render(<Ekran error={new Error("boom")} reset={() => undefined} />)).not.toThrow();
    // Asercje idą po SŁOWNIKU (`errorCopy`), nie po polskich literałach:
    // przedmiotem dowodu jest, że ekran czyta wspólne źródło kopii warstwy
    // ratunkowej, a nie że ktoś nie poprawił copy.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(copy.errorTitle);
    expect(screen.getByText(copy.errorBody)).toBeTruthy();
    expect(screen.getByRole("button", { name: copy.tryAgain })).toBeTruthy();
  });

  it("SUROWEGO `error.message` nie pokazuje czytelnikowi, ale ODDAJE go do diagnostyki", () => {
    // To jest reguła prywatności/bezpieczeństwa, nie kosmetyka: komunikaty
    // błędów niosą ścieżki plików na serwerze, nazwy tabel i fragmenty zapytań.
    // Kontrakt ma DWIE POŁOWY i obie muszą stać w jednym przypadku - ekran bez
    // logowania byłby ciszą dla operatora, a ekran z komunikatem wyciekiem dla
    // czytelnika.
    const Ekran = errorScreen();
    render(<Ekran error={BLAD_Z_DIAGNOSTYKA} reset={() => undefined} />);

    // POŁOWA PIERWSZA: nic z komunikatu w dokumencie. Sprawdzamy `innerHTML`,
    // a nie `textContent`: wyciek atrybutem (`title`, `aria-label`, `data-*`)
    // też jest wyciekiem, a `textContent` by go nie zobaczył.
    const html = document.body.innerHTML;
    expect(html).not.toContain(BLAD_Z_DIAGNOSTYKA.message);
    expect(html).not.toContain("posts_private");
    expect(html).not.toContain("/srv/app/");
    // Ekran musi przy tym cokolwiek POWIEDZIEĆ - pusty dokument spełniłby
    // asercje wyżej i nie byłby ekranem błędu.
    expect(document.body.textContent).toContain(errorCopy().errorTitle);

    // POŁOWA DRUGA: błąd trafia do konsoli przeglądarki jako OBIEKT, nie jako
    // sklejony string - stos jest tam całą wartością diagnostyczną.
    expect(h.consoleErrors).toContain(BLAD_Z_DIAGNOSTYKA);
  });

  it("„spróbuj ponownie” woła I `router.invalidate()`, I `reset()` - jedno bez drugiego nie wraca", () => {
    // `reset()` czyści granicę błędu Reacta, `invalidate()` unieważnia dane
    // routera. Samo `reset()` odtworzyłoby drzewo na TYCH SAMYCH nieświeżych
    // danych (czyli natychmiast ten sam błąd), samo `invalidate()` zostawiłoby
    // granicę w stanie awarii. Dlatego asercja stoi na OBU atrapach.
    const Ekran = errorScreen();
    let resetCalls = 0;
    render(<Ekran error={new Error("boom")} reset={() => (resetCalls += 1)} />);
    expect(h.invalidateCalls).toBe(0);
    expect(resetCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: errorCopy().tryAgain }));

    expect(h.invalidateCalls).toBe(1);
    expect(resetCalls).toBe(1);
  });

  it("mówi w języku renderu - PL i EN idą z tego samego słownika", () => {
    // Trasa `/$` obsługuje oba prefiksy językowe, więc ekran błędu musi mówić
    // w języku strony, na której padł. Asercja porównuje DWA RENDERY, a nie
    // literały: gdyby `errorCopy()` przestało czytać język, oba dałyby ten sam
    // napis i ten test padłby na `not.toBe`.
    const Ekran = errorScreen();

    h.lang = "pl";
    const pl = errorCopy();
    render(<Ekran error={new Error("boom")} reset={() => undefined} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(pl.errorTitle);
    expect(screen.getByRole("button", { name: pl.tryAgain })).toBeTruthy();
    cleanup();

    h.lang = "en";
    const en = errorCopy();
    render(<Ekran error={new Error("boom")} reset={() => undefined} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(en.errorTitle);
    expect(screen.getByRole("button", { name: en.tryAgain })).toBeTruthy();

    expect(en.errorTitle).not.toBe(pl.errorTitle);
    expect(en.tryAgain).not.toBe(pl.tryAgain);
  });

  it("renderuje się też na SERWERZE - granica błędu obowiązuje w SSR, nie tylko po hydracji", () => {
    // `renderToStaticMarkup` idzie tą samą drogą, którą naprawdę idzie SSR.
    // Efekt (`console.error`) tam NIE BIEGNIE i to jest poprawne: na serwerze
    // rzut raportuje warstwa serwerowa. Dowodem jest, że sam ekran wychodzi
    // jako HTML - inaczej odpowiedź 500 byłaby pusta dla robota i czytelnika.
    const Ekran = errorScreen();
    const html = renderToStaticMarkup(<Ekran error={BLAD_Z_DIAGNOSTYKA} reset={() => undefined} />);
    expect(html).toContain(errorCopy().errorTitle);
    expect(html).not.toContain("posts_private");
  });
});

// ===========================================================================
// POZOSTAŁE POWIERZCHNIE PODPIĘTE W `Route.options`.
// ===========================================================================
//
// Sprawdzane PRZEZ TRASĘ, a nie przez import komponentu: same komponenty mają
// własne testy, a tutaj przedmiotem dowodu jest PODPIĘCIE. Rozpięte
// `notFoundComponent` nie psuje żadnego typu - trasa po cichu oddaje wtedy
// domyślny ekran frameworka (biały „Not Found" bez powłoki i bez skrótów).
describe("Route.options - powierzchnie 404 i oczekiwania trasy `/$`", () => {
  it("`notFoundComponent` to publiczny ekran 404, gotowy w SSR", () => {
    const Ekran = bezpropsowyEkran("notFoundComponent");
    const html = renderToStaticMarkup(<Ekran />);
    // Robot dostaje treść 404 w PIERWSZEJ odpowiedzi, nie po hydracji - dlatego
    // dowód idzie przez render serwerowy, a nie przez `render()` z DOM-em.
    expect(html).toContain(errorCopy().notFoundTitle);
    expect(html).toContain("404");
  });

  it("`pendingComponent` to szkielet artykułu, DEKORACYJNY dla czytnika ekranu", () => {
    const Ekran = bezpropsowyEkran("pendingComponent");
    render(<Ekran />);
    // `aria-hidden` jest tu KONTRAKTEM DOSTĘPNOŚCI, nie detalem wyglądu:
    // nawigację ogłasza pasek postępu trasy, więc szkielet nie może dokładać
    // czytnikowi ekranu kilkunastu pustych regionów do przeczytania.
    const szkielet = document.querySelector('[aria-hidden="true"]');
    expect(szkielet).not.toBeNull();
    // Szkielet nie udaje treści: żadnego tekstu do zindeksowania.
    expect(document.body.textContent?.trim()).toBe("");
  });
});

// ===========================================================================
// `head()` NA WPISIE - preload LCP, cytowania, kolejność okruszków.
// ===========================================================================
//
// `publicResolverRoute.test.tsx` sprawdza `head()` na STRONIE (kanoniczny adres
// i gałąź bez danych loadera). Wpis to inne gałęzie tej samej funkcji: preload
// okładki, tagi Highwire z listy autorów i sortowanie okruszków - i to one
// decydują o LCP oraz o tym, jak wpis wygląda w Google Scholar i w okruszkach
// wyniku wyszukiwania.
describe("head() trasy `/$` - wpis", () => {
  it.each(["pl", "en"] as const)(
    "keeps localized metadata and generated social-card dimensions in %s",
    (lang) => {
      h.requestUrl = `https://example.org/${lang === "en" ? "en/" : ""}analizy/atom`;
      const data = resolvedPost({
        item: postItem({
          cover_image_url: null,
          og_image_generated_url: "https://example.org/card.png",
        }),
      });
      const result = head(data);
      expect(result.meta).toEqual(
        expect.arrayContaining([
          { name: "citation_title", content: lang === "en" ? "Atom in Europe" : "Atom w Europie" },
          { property: "og:image:width", content: "1200" },
          { property: "og:image:height", content: "630" },
        ]),
      );
      expect(jsonLdOTypie(result, "NewsArticle")).toMatchObject({
        headline: lang === "en" ? "Atom in Europe" : "Atom w Europie",
        description: lang === "en" ? "Analysis teaser in English." : "Zapowiedź analizy po polsku.",
      });
    },
  );
  it.each(["pl", "en"] as const)(
    "uses the other language for missing editorial metadata in %s",
    (lang) => {
      h.requestUrl = `https://example.org/${lang === "en" ? "en/" : ""}analizy/atom`;
      const data = resolvedPost();
      data.item[lang === "en" ? "title_en" : "title_pl"] = "";
      data.item[lang === "en" ? "excerpt_en" : "excerpt_pl"] = null;
      data.crumbs = [
        {
          ...CRUMBS_ODWROTNIE[1],
          title_pl: lang === "pl" ? "" : "Sekcja PL",
          title_en: lang === "en" ? "" : "Section EN",
        },
      ];
      expect(jsonLdOTypie(head(data), "NewsArticle")).toMatchObject({
        headline: lang === "en" ? "Atom w Europie" : "Atom in Europe",
        description: lang === "en" ? "Zapowiedź analizy po polsku." : "Analysis teaser in English.",
        articleSection: lang === "en" ? "Sekcja PL" : "Section EN",
      });
    },
  );
  it("tolerates a sparse legacy payload without inventing citations or breadcrumbs", () => {
    const data = { kind: "post", item: postItem({ title_pl: "", title_en: "" }), tags: null };
    const result = routeHead(Route, { loaderData: data, params: {} });
    expect(result.meta?.find((m) => m.name === "citation_title")?.content).toBe("Strona");
    expect(result.meta?.filter((m) => m.name === "citation_author")).toEqual([]);
    expect(jsonLdOTypie(result, "NewsArticle").articleSection).toBeUndefined();
  });
  it("supports page metadata without post-only excerpt columns", () => {
    const { excerpt_pl: _pl, excerpt_en: _en, ...item } = postItem();
    const result = head({ kind: "page", item, crumbs: [] });
    expect(result.meta?.find((m) => m.property === "og:type")?.content).toBe("website");
    expect(result.meta?.filter((m) => m.name === "citation_title")).toEqual([]);
  });
  /** Ładunek loadera dla wpisu: treść + deskryptor preloadu, tak jak go oddaje loader. */
  function ladunekWpisu(): Record<string, unknown> {
    return {
      ...resolvedPost(),
      coverPreload: {
        href: COVER_URL,
        imageSrcSet: `${COVER_URL}?width=640 640w`,
        imageSizes: "100vw",
      },
    };
  }

  function head(loaderData: unknown, splat = "analizy/atom"): RouteHeadResult {
    return routeHead(Route, { loaderData, params: { _splat: splat } });
  }

  /**
   * Graf JSON-LD danego typu, WYPARSOWANY z wyniku `head()`.
   *
   * Wybór po `@type`, a nie po indeksie w `scripts`: dowód dotyczy TREŚCI
   * danych strukturalnych, a nie kolejności dwóch elementów `<script>`.
   * `safeJsonLd` escapuje wyłącznie `<`, `>` i `&` sekwencjami `\uXXXX`, które
   * są poprawnym JSON-em, więc `JSON.parse` czyta dokładnie to, co dostanie
   * robot. Brak grafu to BŁĄD TESTU - `undefined` przepuściłby cichy regres.
   */
  function jsonLdOTypie(result: RouteHeadResult, typ: string): Record<string, unknown> {
    for (const script of result.scripts ?? []) {
      const raw: unknown = JSON.parse(script.children ?? "null");
      if (typeof raw !== "object" || raw === null) continue;
      const graf: Record<string, unknown> = { ...raw };
      if (graf["@type"] === typ) return graf;
    }
    throw new Error(`test: head() nie wyemitował grafu JSON-LD typu "${typ}"`);
  }

  /**
   * Pozycje okruszków BEZ strony głównej, którą `breadcrumbListJsonLd` dokłada
   * z siebie. Odsianie jej trzyma asercję na tym, co pochodzi z tej trasy.
   */
  function pozycjeOkruszkow(graf: Record<string, unknown>): { name: unknown; position: unknown }[] {
    const lista = graf.itemListElement;
    if (!Array.isArray(lista)) throw new Error("test: BreadcrumbList bez `itemListElement`");
    return lista
      .map((wpis: unknown) => {
        const el: Record<string, unknown> =
          typeof wpis === "object" && wpis !== null ? { ...wpis } : {};
        return { name: el.name, position: el.position };
      })
      .filter((el) => el.position !== 1);
  }

  it("emituje preload obrazu okładki z TYMI SAMYMI kandydatami, co render", () => {
    // Reguła wydajnościowa, nie ozdoba: preload bez `imagesrcset`/`imagesizes`
    // każe przeglądarce pobrać INNEGO kandydata niż ten, który finalnie maluje
    // `<img>` - czyli dwa pobrania obrazu LCP zamiast jednego.
    h.requestUrl = "https://przyklad.example.com/analizy/atom";
    const links = head(ladunekWpisu()).links ?? [];
    const preload = links.find((l) => l.rel === "preload" && l.as === "image");
    expect(preload).toBeTruthy();
    expect(preload?.href).toBe(COVER_URL);
    expect(preload?.imageSrcSet).toBe(`${COVER_URL}?width=640 640w`);
    expect(preload?.imageSizes).toBe("100vw");
    expect(preload?.fetchPriority).toBe("high");
  });

  it("bez deskryptora okładki NIE emituje preloadu - pusty preload to zmarnowane pasmo", () => {
    const ladunek = ladunekWpisu();
    ladunek.coverPreload = null;
    const links = head(ladunek).links ?? [];
    expect(links.find((l) => l.rel === "preload" && l.as === "image")).toBeUndefined();
    // Kanoniczny adres zostaje - to nie jest gałąź „bez nagłówka".
    expect(links.find((l) => l.rel === "canonical")).toBeTruthy();
  });

  it("emituje tagi Highwire dla KAŻDEGO autora wpisu - to wejście dla Scholara i Zotero", () => {
    h.requestUrl = "https://przyklad.example.com/analizy/atom";
    const ladunek = ladunekWpisu();
    ladunek.authors = [
      {
        id: "a1",
        slug: "anna-nowak",
        display_name: "Anna Nowak",
        first_name: "Anna",
        last_name: "Nowak",
      },
      {
        id: "a2",
        slug: "jan-kowal",
        display_name: "Jan Kowal",
        first_name: "Jan",
        last_name: "Kowal",
      },
    ];
    const meta = head(ladunek).meta ?? [];
    const autorzy = meta.filter((m) => m.name === "citation_author").map((m) => m.content);
    // DWÓCH autorów, nie jeden: współautorstwo jest w tym repozytorium
    // pierwszorzędnym stanem danych (`post_authors` + kolejność z loadera),
    // a pojedynczy tag `citation_author` przypisałby całość autorowi głównemu.
    expect(autorzy).toHaveLength(2);
    expect(autorzy.join(" ")).toContain("Nowak");
    expect(autorzy.join(" ")).toContain("Kowal");
  });

  it("STRONA nie dostaje tagów cytowań - Highwire opisuje publikację, nie stronę serwisu", () => {
    const meta =
      head({
        kind: "page",
        item: postItem({ cover_image_url: null }),
        crumbs: [],
        coverPreload: null,
      }).meta ?? [];
    expect(meta.filter((m) => m.name === "citation_author")).toEqual([]);
  });

  it("okruszki w JSON-LD idą OD KORZENIA W DÓŁ, a wpis zamyka ścieżkę", () => {
    // Kolejność `BreadcrumbList` jest treścią tych danych: `position` czyta
    // Google i rysuje z niego ścieżkę pod wynikiem. Rezolwer nie obiecuje
    // uporządkowania, więc wejście tego testu jest CELOWO odwrotne
    // (patrz `CRUMBS_ODWROTNIE`), a wynik ma być ułożony od korzenia w dół.
    h.requestUrl = "https://przyklad.example.com/analizy/atom";
    const okruszki = jsonLdOTypie(head(ladunekWpisu()), "BreadcrumbList");
    const elementy = pozycjeOkruszkow(okruszki);
    // Pierwsza pozycja to strona główna (dokłada ją `breadcrumbListJsonLd`),
    // potem rodzice od najpłytszego, a na końcu SAM WPIS - i to on jest
    // pozycją bez `item`, bo strona bieżąca nie linkuje do siebie.
    expect(elementy.map((e) => e.name)).toEqual(["Analizy", "Atom", "Atom w Europie"]);
    expect(elementy.map((e) => e.position)).toEqual([2, 3, 4]);
  });

  it("`articleSection` bierze NAJGŁĘBSZEGO rodzica wpisu, nie pierwszy wiersz z rezolwera", () => {
    // Tu mieszka sortowanie po `depth` (`$.tsx:459`). Sekcja artykułu to
    // odpowiedź na „gdzie ten materiał należy" - z listy podanej w odwrotnej
    // kolejności NIEsortowany odczyt oddałby „Analizy" (depth 1) zamiast
    // najgłębszego rodzica, czyli podpisałby wpis pod nadrzędnym działem.
    h.requestUrl = "https://przyklad.example.com/analizy/atom";
    const artykul = jsonLdOTypie(head(ladunekWpisu()), "NewsArticle");
    expect(artykul.articleSection).toBe("Atom");
  });

  it("tagi wpisu wchodzą do nagłówka jako słowa kluczowe - nazwami, nie slugami", () => {
    h.requestUrl = "https://przyklad.example.com/analizy/atom";
    const ladunek = ladunekWpisu();
    ladunek.tags = [
      { slug: "energia", name: "Energia" },
      { slug: "atom", name: "Atom" },
    ];
    // Slug jest identyfikatorem adresu, a `keywords` czyta CZŁOWIEK i robot -
    // stąd asercja na nazwach, nie na slugach.
    expect(jsonLdOTypie(head(ladunek), "NewsArticle").keywords).toBe("Energia, Atom");
  });
});

// ===========================================================================
// LOADER PO ROZSTRZYGNIĘCIU TREŚCI - `buildCoverPreload` i kontekst rozgrzewki.
// ===========================================================================
//
// `buildCoverPreload` (`$.tsx:184`) NIE JEST eksportowana, więc jedyną drogą do
// niej jest loader. Nie jest to obejście: funkcja istnieje po to, żeby preload
// z `head()` opisywał DOKŁADNIE ten kandydat obrazu, który namaluje
// `PostLayoutRenderer` - a to zależy od aktywnego layoutu, czyli od danych,
// które loader dopiero czyta.
describe("loader trasy `/$` - preload okładki wpisu", () => {
  it("wpis z okładką dostaje deskryptor preloadu ORAZ nagłówek HTTP `Link`", async () => {
    const { wynik } = await runLoader("analizy/atom", resolvedPost());
    const preload = jakoWynik(wynik).coverPreload;
    expect(preload).toBeTruthy();
    expect(preload?.href).toBe(COVER_URL);
    // Kandydaty responsywne MUSZĄ być niepuste - inaczej przeglądarka
    // pobierze oryginał i drugi raz właściwy wariant.
    expect(String(preload?.imageSrcSet)).toContain("640w");
    expect(preload?.imageSizes).toBe("100vw");

    // Nagłówek HTTP `Link` to druga połowa tej samej reguły: fetch obrazu
    // startuje z NAGŁÓWKÓW, przed sparsowaniem pierwszego bajtu HTML (i to on
    // odtwarza się jako 103 Early Hints na brzegu).
    expect(h.linkHeaders).toHaveLength(1);
    expect(h.linkHeaders[0]).toContain('rel="preload"');
    expect(h.linkHeaders[0]).toContain('as="image"');
    expect(h.linkHeaders[0]).toContain("imagesrcset=");

    // Treść ROZSTRZYGNIĘTA znaczy cache brzegowy, a nie `no-store` (ten jest
    // zarezerwowany dla 404 i przekierowań - patrz `publicResolverRoute`).
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(false);
  });

  it("wpis BEZ okładki nie dostaje ani deskryptora, ani nagłówka `Link`", async () => {
    const { wynik } = await runLoader(
      "analizy/atom",
      resolvedPost({ item: postItem({ cover_image_url: null }) }),
    );
    expect(jakoWynik(wynik).coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });

  it("layout BEZ obrazu wyróżniającego nie dostaje preloadu - preload czegoś, czego nie widać", async () => {
    // Layout 9 (`cover: "none"`, `header: "no-cover"`) nie maluje okładki.
    // Preload byłby wtedy pobraniem obrazu, którego czytelnik nigdy nie
    // zobaczy - czyli zmarnowanym pasmem NA ŚCIEŻCE KRYTYCZNEJ, i to na
    // najcięższym zasobie strony.
    const { wynik } = await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({ layout_overrides: { layout: "layout-9" } }),
      }),
    );
    expect(jakoWynik(wynik).coverPreload).toBeNull();
    expect(h.linkHeaders).toEqual([]);
  });

  it("STRONA nie idzie ścieżką okładki wpisu - jej hero mieszka w dokumencie buildera", async () => {
    const { wynik } = await runLoader("o-nas", {
      kind: "page",
      item: postItem({ cover_image_url: COVER_URL }),
      crumbs: [],
      parentPageId: "page-1",
      access: null,
    });
    // Ta sama kolumna `cover_image_url` jest wypełniona, a preloadu NIE MA:
    // dla stron pierwszy malowany obraz wyznacza `builderHeroPreload`
    // z dokumentu buildera (tu pustego), nie okładka wiersza.
    expect(jakoWynik(wynik).coverPreload).toBeNull();
  });
});

describe("loader trasy `/$` - kontekst rozgrzewki silnika bloków", () => {
  it.each(["pl", "en"] as const)(
    "warms page blocks with page context under the %s URL",
    async (lang) => {
      h.requestUrl = `https://example.org/${lang === "en" ? "en/" : ""}section`;
      stub.setResponse("posts", ok([]));
      const { wynik, queryClient } = await runLoader("section", {
        kind: "page",
        parentPageId: "root",
        crumbs: [],
        access: null,
        item: {
          ...postItem(),
          template_type: "archive_listing",
          blocks_data: {
            pl: { version: 1, blocks: [{ id: "related", type: "related-posts", data: {} }] },
          },
        },
      });
      expect(jakoWynik(wynik).kind).toBe("page");
      expect(h.blocksPrefetchCtx).toEqual([
        {
          postId: null,
          publishedAt: "2026-01-01T00:00:00.000Z",
          authorId: null,
          categorySlugs: [],
          tagSlugs: [],
        },
      ]);
      expect(queryClient.getQueryData(["archive-listing", "post-1"])).toEqual([]);
      queryClient.clear();
    },
  );
  it("rozgrzewa bloki KLUCZEM WPISU: autor, kategorie i tagi bieżącej treści", async () => {
    // Bez tego wpisy rozgrzane na SSR mijają się z zapytaniami po hydracji:
    // widoki „powiązane"/„więcej"/„bio autora" liczą klucz z tego samego
    // trójkąta, a robot dostaje listy niezależne od kategorii wpisu.
    await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
            en: { version: 1, blocks: [] },
          },
        }),
        author: null,
        categories: [
          { slug: "analizy", name_pl: "Analizy", name_en: "Analyses", color: null },
          { slug: "energia", name_pl: "Energia", name_en: "Energy", color: null },
        ],
        tags: [
          { slug: "atom", name: "Atom" },
          { slug: "oze", name: "OZE" },
        ],
      }),
    );
    expect(h.blocksPrefetchCtx).toHaveLength(1);
    const ctx = h.blocksPrefetchCtx[0];
    expect(ctx.postId).toBe("post-1");
    expect(ctx.publishedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(ctx.categorySlugs).toEqual(["analizy", "energia"]);
    expect(ctx.tagSlugs).toEqual(["atom", "oze"]);
  });

  it("pusty dokument bloków NIE kosztuje rozgrzewki", async () => {
    await runLoader("analizy/atom", resolvedPost());
    expect(h.blocksPrefetchCtx).toEqual([]);
  });
});

describe("loader trasy `/$` - degradacja zapytań pobocznych", () => {
  it("padnięte ustawienia serwisu NIE wywracają strony - nagłówek jedzie na domyślnych", async () => {
    // `site_settings` zasila sufiks tytułu, `twitter:site` i logo wydawcy.
    // Rzut z tego zapytania zabiłby CAŁĄ trasę publiczną z powodu ozdoby
    // nagłówka, dlatego loader go pochłania - a treść wychodzi mimo to.
    stub.setResponse("site_settings", fail("site_settings unreachable"));
    const { wynik } = await runLoader("analizy/atom", resolvedPost());
    expect(jakoWynik(wynik).kind).toBe("post");
    expect(jakoWynik(wynik).coverPreload).toBeTruthy();
  });

  // ------------------------------------------------------------------------
  // NAGŁÓWEK CACHE'U BRAMKOWANY CZYSTOŚCIĄ RENDERU (punkt A4.5 / definicja
  // ukończenia 10 zlecenia `docs/PROMPT_SSR_PIERWSZE_WCZYTANIE.md`).
  //
  // Do 2026-09-12 `setCacheControlHeader(contentCacheControl())` było w tym
  // loaderze PRZED prefetchem wtórnym, więc render niepełny wychodził
  // z nagłówkiem pozwalającym trzymać go na brzegu przez 15 minut świeżości
  // plus dobę okna stale. Trzy przypadki niżej to trzy sposoby, na jakie ten
  // render bywa niepełny; kontrola pozytywna („treść rozstrzygnięta znaczy
  // cache brzegowy") stoi w bloku preloadu okładki wyżej.
  // ------------------------------------------------------------------------

  it("ODRZUCONA odnoga prefetchu wtórnego zdejmuje cache wspólny", async () => {
    h.blocksPrefetch = "reject";
    await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
            en: { version: 1, blocks: [] },
          },
        }),
      }),
    );
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("REGRES P1: odnoga ROZSTRZYGNIĘTA SUKCESEM z sygnałem `degraded` zdejmuje cache wspólny", async () => {
    // NAJWAŻNIEJSZY z trzech przypadków i jedyny, którego pierwsza wersja tej
    // bramki NIE ŁAPAŁA (znalezisko P1 z recenzji PR #357). Żadna z pięciu
    // odnóg prefetchu wtórnego nie odrzuca: `prefetchQuery` pochłania błąd
    // z definicji, `prefetchBlockQueries` świadomie w `allSettled`,
    // a `prefetchAboveFoldQueries` ma WŁASNY budżet 2 500 ms i po nim wraca
    // NORMALNIE. Zewnętrzny budżet 3 000 ms nie zdążył więc minąć, wynik
    // wychodził `fulfilled` i render bez treści szedł na brzeg.
    //
    // Tu odnoga wraca SZYBKO i SUKCESEM - bez zawieszenia, bez odrzucenia -
    // a mimo to nagłówek musi być `no-store`. To dowodzi, że decyzja czyta
    // STAN ZAPYTAŃ, a nie kształt obietnicy.
    h.blocksPrefetch = "degraded";
    await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
            en: { version: 1, blocks: [] },
          },
        }),
      }),
    );
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("MINIĘTY budżet prefetchu wtórnego zdejmuje cache wspólny", async () => {
    // Zawieszony upstream nie odrzuca - on czeka, a `Promise.allSettled` nie
    // ma o czym powiedzieć. Bez odczytu lapsusu budżetu ta degradacja była
    // dla nagłówka NIEWIDOCZNA, a to jest najczęstszy kształt awarii bazy.
    vi.useFakeTimers();
    try {
      h.blocksPrefetch = "hang";
      const bieg = runLoader(
        "analizy/atom",
        resolvedPost({
          item: postItem({
            blocks_data: {
              pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
              en: { version: 1, blocks: [] },
            },
          }),
        }),
      );
      // `SECONDARY_PREFETCH_BUDGET_MS` = 1 500, a wspólny termin żądania
      // (`CONTENT_SSR_BUDGET_MS`) też 1 500 - faza wtórna nie może wisieć
      // dłużej niż KRÓTSZA z tych dwóch liczb.
      await vi.advanceTimersByTimeAsync(TERMIN_ZADANIA_MS + 1);
      await bieg;
    } finally {
      vi.useRealTimers();
    }
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("brak ustawień serwisu zdejmuje cache wspólny - `<head>` bez nich jest niepełny", async () => {
    // Sufiks tytułu, `twitter:site` i logo wydawcy wychodzą z tego zapytania.
    // Render bez nich nie wywraca strony (przypadek wyżej), ale NIE MOŻE być
    // serwowany kolejnym czytelnikom przez okno cache'u.
    stub.setResponse("site_settings", fail("site_settings unreachable"));
    await runLoader("analizy/atom", resolvedPost(), { ustawieniaSerwisu: false });
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("brak treści pod adresem daje 404 bez żadnego rzutu z bazy", async () => {
    // ODCZYT CZYSTY: `resolve_path` odpowiedział i nie znalazł nic. To JEDYNA
    // gałąź, której wolno wypisać adres z indeksu - kontrolą negatywną są dwa
    // przypadki w bloku „degradacja to nie 404" niżej.
    const { wynik } = await runLoader("analizy/atom");
    expect(isNotFound(wynik)).toBe(true);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
  });
});

// ===========================================================================
// DEGRADACJA TO NIE JEST 404 (audyt CWV F07 / W8).
// ===========================================================================
//
// Do 2026-09-20 loader tej trasy rozstrzygał po OBECNOŚCI danych
// (`getQueryData`), więc KAŻDY brak treści - miniony budżet, anulowanie przez
// watchdoga SSR, błąd PostgREST - wchodził do gałęzi „treści nie ma"
// i kończył się `notFound()`. Efekt: chora baza wypisywała ŻYWE wpisy
// z indeksu Google, a jedno żądanie kosztowało tygodnie odbudowy pozycji.
//
// Dzisiaj decyduje STAN ZAPYTANIA: 404 należy się wyłącznie odczytowi
// CZYSTEMU (`success` + `null`), a „nie wiemy" ma własną odpowiedź - HTTP 200
// z komunikatem, `private, no-store` i `noindex`.
describe("loader trasy `/$` - degradacja zamiast fałszywego 404", () => {
  const KLUCZ_TRESCI = () => resolvedContentQueryOptions(splatToSegments("analizy/atom")).queryKey;

  it("ZAWIESZONA baza po terminie daje render ZDEGRADOWANY, a nie `notFound()`", async () => {
    // Najczęstszy realny kształt awarii: połączenie stoi, nic nie rzuca.
    // Przed zmianą loader czekał tu sztywne 5 000 ms i kończył 404.
    vi.useFakeTimers();
    let wynik: unknown;
    let queryClient: QueryClient | undefined;
    try {
      h.rpcHang = true;
      const bieg = runLoader("analizy/atom");
      await vi.advanceTimersByTimeAsync(TERMIN_ZADANIA_MS + 1);
      ({ wynik, queryClient } = await bieg);
    } finally {
      vi.useRealTimers();
    }

    expect(isNotFound(wynik)).toBe(false);
    expect(jakoWynik(wynik).degraded).toBe(true);
    expect(jakoWynik(wynik).kind).toBe("degraded");
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
    // Wpis MUSI zniknąć z cache'u: zapytanie w locie bez danych pojechałoby
    // w dehydratowanym ładunku jako wiszące, a klient ma dociągnąć treść świeżo.
    expect(queryClient?.getQueryState(KLUCZ_TRESCI())).toBeUndefined();
  });

  it("BŁĄD bazy przy rezolucji ścieżki też degraduje, zamiast wypisywać wpis z indeksu", async () => {
    // `resolve_path` oddaje błąd, a fetcher go RZUCA (`queries/public.ts`).
    // Rzut nie jest wiedzą o tym, że adresu nie ma - jest jej brakiem.
    h.rpcError = { message: "resolve_path: connection reset" };
    const { wynik, queryClient } = await runLoader("analizy/atom");

    expect(isNotFound(wynik)).toBe(false);
    expect(jakoWynik(wynik).degraded).toBe(true);
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
    expect(queryClient.getQueryState(KLUCZ_TRESCI())).toBeUndefined();
  });

  it("`head()` renderu zdegradowanego niesie `noindex` - komunikat nie ma prawa wejść do indeksu", () => {
    // Status jest 200 (inaczej CDN nie zapisze odpowiedzi, a monitory zgłoszą
    // serwis jako offline), więc `noindex` jest JEDYNĄ obroną indeksu przed
    // utrwaleniem „nie udało się załadować" pod adresem prawdziwego artykułu.
    const head = routeHead(Route, {
      loaderData: { kind: "degraded", degraded: true, seoSettings: null, coverPreload: null },
      params: { _splat: "analizy/atom" },
    });
    const robots = head.meta?.find((m) => m.name === "robots");
    expect(robots?.content).toContain("noindex");
    // Żadnego canonicala ani og:* - opis niekompletnego renderu byłby kłamstwem.
    expect(head.links ?? []).toEqual([]);
  });

  it("ROZGRZEWKI NIEZALEŻNE OD TREŚCI ruszają PRZED fazą główną", async () => {
    // Ustawienia układu i konfiguracja powiązanych nie potrzebują
    // rozstrzygniętego adresu. Dowód jest mocny właśnie dlatego, że treść
    // NIGDY się nie rozstrzyga: przed zmianą obie startowały dopiero po niej,
    // więc przy zawieszonej bazie nie ruszyłyby ANI RAZU.
    vi.useFakeTimers();
    try {
      h.rpcHang = true;
      const bieg = runLoader("analizy/atom");
      await vi.advanceTimersByTimeAsync(TERMIN_ZADANIA_MS + 1);
      await bieg;
    } finally {
      vi.useRealTimers();
    }

    expect(h.zapytania).toContain("post_layout_settings");
    expect(h.zapytania).toContain("rpc:get_related_posts_config");
    // I to PRZED pierwszym round-tripem rezolucji ścieżki, a nie tylko „kiedyś".
    expect(h.zapytania.indexOf("post_layout_settings")).toBeLessThan(
      h.zapytania.indexOf("rpc:resolve_path"),
    );
  });

  it("faza wtórna dostaje RESZTĘ wspólnego terminu, a nie własne pełne 1 500 ms", async () => {
    // Zegar żądania założony PRZED loaderem z 300 ms - czyli stan „treść
    // zjadła 1 200 z 1 500 ms". Przed zmianą faza wtórna startowała tu z
    // własnymi 3 000 ms i łańcuch sumował się do 13 000 ms przed pierwszym
    // bajtem. Dziś sufit fazy przycina wspólny termin.
    vi.useFakeTimers();
    try {
      h.blocksPrefetch = "hang";
      let gotowe = false;
      const bieg = runLoader(
        "analizy/atom",
        resolvedPost({
          item: postItem({
            blocks_data: {
              pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
              en: { version: 1, blocks: [] },
            },
          }),
        }),
        { zuzytyTermin: 300 },
      );
      void bieg.then(() => {
        gotowe = true;
      });

      await vi.advanceTimersByTimeAsync(299);
      expect(gotowe).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      await bieg;
      expect(gotowe).toBe(true);
    } finally {
      vi.useRealTimers();
    }
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("SERWER zakłada wspólny termin żądania pod `QueryClient`em", async () => {
    // Kontrola pozytywna do przypadku klienta niżej: zegar istnieje i jest
    // WSPÓLNY, więc kolejny wołający (loader korzenia) dostaje TEN SAM
    // znacznik zamiast nastawiać własny.
    const { queryClient } = await runLoader("analizy/atom", resolvedPost());
    expect(routeSsrDeadline(queryClient, 60_000) - Date.now()).toBeLessThanOrEqual(
      TERMIN_ZADANIA_MS,
    );
  });

  it("KLIENT nie zakłada terminu - nawigacja SPA nie ma TTFB do obrony", async () => {
    h.isServer = false;
    const { wynik, queryClient } = await runLoader("analizy/atom", resolvedPost());

    expect(jakoWynik(wynik).kind).toBe("post");
    // Gdyby loader kliencki założył zegar, ten wołający dostałby JEGO znacznik.
    // Sesja przeglądarki trzyma jeden `QueryClient`, więc taki zegar byłby
    // miniony dla KAŻDEJ kolejnej nawigacji i każda kończyłaby się degradacją.
    expect(routeSsrDeadline(queryClient, 60_000) - Date.now()).toBeGreaterThan(30_000);
  });

  it("KLIENT czeka na bazę zamiast degradować po budżecie", async () => {
    // Druga połowa tego samego kontraktu, tym razem po ZACHOWANIU: na kliencie
    // czytelnik patrzy na `pendingComponent` (ContentSkeleton), a nie na pusty
    // dokument - przerwanie oczekiwania dałoby mu komunikat o awarii tam, gdzie
    // wystarczyło poczekać.
    vi.useFakeTimers();
    try {
      h.isServer = false;
      h.rpcHang = true;
      let gotowe = false;
      void runLoader("analizy/atom").then(() => {
        gotowe = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(gotowe).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("loader trasy `/$` - hinty modułów widgetów treści", () => {
  it("strona z dokumentem buildera emituje hinty `modulepreload` w nagłówku `Link`", async () => {
    // Ta sama droga, którą korzeń emituje hinty widgetów NAGŁÓWKA: chunki
    // widgetów startują z NAGŁÓWKÓW odpowiedzi, zanim przeglądarka sparsuje
    // HTML (a NES Edge Cache odtwarza je na HIT/STALE).
    await runLoader(
      "o-nas",
      stronaZDokumentem({ version: 1, sections: [{ id: "s0", children: [] }] }),
    );

    expect(h.widgetPreloads).toEqual([{ sekcje: 1, ile: 3 }]);
    expect(h.linkHeaders).toContain(HINT_WIDGETU);
  });

  it("dokument BEZ sekcji nie emituje hintów - pusty hint to zmarnowany nagłówek", async () => {
    await runLoader("o-nas", stronaZDokumentem(null));

    expect(h.widgetPreloads).toEqual([]);
    expect(h.linkHeaders).not.toContain(HINT_WIDGETU);
  });

  it("na KLIENCIE hintów nie ma - nagłówki odpowiedzi nie istnieją po hydratacji", async () => {
    h.isServer = false;
    await runLoader(
      "o-nas",
      stronaZDokumentem({ version: 1, sections: [{ id: "s0", children: [] }] }),
    );

    expect(h.widgetPreloads).toEqual([]);
  });
});

// ===========================================================================
// KSZTAŁTY WEJŚCIA, KTÓRYCH NIE WIDAĆ NA SZCZĘŚLIWEJ ŚCIEŻCE.
// ===========================================================================
//
// Wszystkie przypadki niżej dotyczą tego samego loadera, ale karmią go tym, co
// przynosi PRODUKCJA, a czego nie przynosi wygodna fixture: dopasowaniem bez
// segmentu, wierszem z pustą kolumną, dokumentem bloków zapisanym w jednym
// języku i wpisem bez powiązań. Każdy z tych kształtów prowadzi do INNEJ
// gałęzi tego samego wyrażenia, a żadna z nich nie była dotąd odwiedzona.

/**
 * Loader wywołany BEZ pola `_splat`. To nie jest wymysł testu: dopasowanie
 * trasy łapiącej wszystko na pustym ogonie nie wstawia tego parametru w ogóle,
 * więc `params._splat` jest wtedy `undefined`, a nie pustym stringiem.
 * `runLoader` wyżej zawsze podaje to pole, więc zapas `?? ""` nie był dotąd
 * przez nic odwiedzony.
 */
async function runLoaderBezSplatu(): Promise<unknown> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    return await loader()({ params: {}, context: { queryClient } });
  } catch (thrown) {
    return thrown;
  }
}

/** Strona z dokumentem buildera - `sections` decyduje o rozgrzewce nad zgięciem. */
function stronaZDokumentem(builderData: unknown): ResolvedContent {
  return {
    kind: "page",
    item: postItem({ builder_data: builderData, cover_image_url: null }),
    crumbs: [],
    parentPageId: "page-1",
    access: null,
  };
}

describe("loader trasy `/$` - wejście bez segmentu i wiersz z pustą kolumną", () => {
  it("dopasowanie BEZ pola `_splat` daje 404, a nie rzut na pustym parametrze", async () => {
    const thrown = await runLoaderBezSplatu();

    // Gdyby zapas `?? ""` zniknął, `planPublicPath(undefined)` dostałby wartość
    // spoza swojego kontraktu - a jest to pierwsza instrukcja loadera KAŻDEJ
    // strony CMS-a, więc czytelnik zobaczyłby ekran błędu zamiast 404.
    expect(isNotFound(thrown)).toBe(true);
    // Pusty adres rozstrzyga sam kształt adresu - bez ani jednego round-tripu.
    expect(stub.chains).toEqual([]);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
  });

  it("wiersz BEZ jawnego formatu dostaje ten sam preload, co format `standard`", async () => {
    // Łańcuch `layout_overrides?.format ?? post_format ?? "standard"` stoi
    // w `$.tsx` TRZY RAZY: tutaj (preload okładki z loadera), w decyzji
    // `coverAboveBody` i w wyborze layoutu wpisu - a komentarz nad
    // `coverAboveBody` mówi wprost, że to MA BYĆ ta sama reguła. Ostatnie
    // ogniwo tego łańcucha nie było dotąd odwiedzone w żadnej z trzech kopii,
    // więc nic nie trzymało ich razem. Gdyby któraś zgubiła `?? "standard"`,
    // `pickLayoutId` dostałby `undefined`, preload wyszedłby z innego zestawu
    // kandydatów niż ten, który maluje `PostLayoutRenderer`, i przeglądarka
    // pobrałaby okładkę DWA RAZY - na najcięższym zasobie strony. Dowód jest
    // więc RÓWNOŚCIĄ obu deskryptorów, a nie samą prawdziwością jednego.
    const jawny = jakoWynik((await runLoader("analizy/atom", resolvedPost())).wynik).coverPreload;
    h.linkHeaders = [];
    const pusty = jakoWynik(
      (
        await runLoader(
          "analizy/atom",
          resolvedPost({ item: postItem({ post_format: undefined }) }),
        )
      ).wynik,
    ).coverPreload;

    expect(pusty).toEqual(jawny);
    expect(pusty?.href).toBe(COVER_URL);
    expect(h.linkHeaders).toHaveLength(1);
  });
});

describe("loader trasy `/$` - wybór językowej odmiany dokumentu bloków", () => {
  it("brak odmiany PL schodzi na odmianę EN, zamiast zrezygnować z rozgrzewki", async () => {
    // Redaktor, który zbudował stronę tylko po angielsku, zapisuje w
    // `blocks_data` wyłącznie klucz `en`. Bez zejścia po łańcuchu zapasów
    // polski render takiego wpisu NIE ROZGRZAŁBY żadnego zapytania widoku,
    // a robot dostałby HTML z pustymi listami - i to na dobę w cache'u brzegu.
    const { wynik } = await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            en: { version: 1, blocks: [{ id: "b-en", type: "related-posts", data: {} }] },
          },
        }),
      }),
    );

    expect(jakoWynik(wynik).kind).toBe("post");
    expect(h.blocksPrefetchCtx).toHaveLength(1);
    expect(h.blocksPrefetchCtx[0]?.postId).toBe("post-1");
  });

  it("dokument zapisany WYŁĄCZNIE w nieobsługiwanej odmianie nie grzeje niczego", async () => {
    // Koniec tego samego łańcucha zapasów: ładunek, w którym nie ma ani
    // bieżącego języka, ani PL, ani EN (import z obcego systemu). Ma zejść do
    // `null` i przejść obok rozgrzewki - a nie wywrócić loadera na
    // `blocksDoc.blocks` liczonym z `undefined`.
    const { wynik } = await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            de: { version: 1, blocks: [{ id: "b-de", type: "related-posts", data: {} }] },
          },
        }),
      }),
    );

    expect(jakoWynik(wynik).kind).toBe("post");
    expect(h.blocksPrefetchCtx).toEqual([]);
  });

  it("wpis BEZ kategorii i tagów grzeje bloki pustymi listami, a nie `undefined`", async () => {
    // Wiersz bez powiązań (świeży wpis, obcięty select) jest realny, a
    // `categorySlugs`/`tagSlugs` idą prosto do `.map(...)`. Gdyby zapasy `?? []`
    // zniknęły, rozgrzewka rzuciłaby TypeError wewnątrz `Promise.allSettled`,
    // a klucze warstwy powiązanej rozjechałyby się z tymi po hydracji.
    await runLoader(
      "analizy/atom",
      resolvedPost({
        item: postItem({
          blocks_data: {
            pl: { version: 1, blocks: [{ id: "b1", type: "related-posts", data: {} }] },
          },
        }),
        categories: undefined,
        tags: undefined,
      }),
    );

    expect(h.blocksPrefetchCtx).toHaveLength(1);
    const ctx = h.blocksPrefetchCtx[0];
    expect(ctx.categorySlugs).toEqual([]);
    expect(ctx.tagSlugs).toEqual([]);
  });
});

describe("loader trasy `/$` - rozgrzewka sekcji nad zgięciem", () => {
  it("dokument buildera z sekcjami grzeje sekcje nad zgięciem w języku renderu", async () => {
    const { wynik } = await runLoader(
      "o-nas",
      stronaZDokumentem({ version: 1, sections: [{ id: "s0", children: [] }] }),
    );

    expect(jakoWynik(wynik).kind).toBe("page");
    expect(h.aboveFoldLangs).toEqual(["pl"]);
    // Rozgrzewka, która się udała, NIE zdejmuje cache'u wspólnego - inaczej
    // przypadek degradacji niżej nie odróżniałby się od zwykłego renderu.
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(false);
  });

  it("dokument BEZ sekcji nie kosztuje rozgrzewki nad zgięciem", async () => {
    // Kontrola dla przypadku wyżej: strona richtext (`builder_data: null`) nie
    // ma czego grzać, a wywołanie rozgrzewki byłoby tu czystym kosztem na
    // ścieżce pierwszego bajtu.
    const { wynik } = await runLoader("o-nas", stronaZDokumentem(null));

    expect(jakoWynik(wynik).kind).toBe("page");
    expect(h.aboveFoldLangs).toEqual([]);
  });

  it("REGRES: `degraded` z rozgrzewki nad zgięciem zdejmuje cache wspólny", async () => {
    // Ta sama klasa co znalezisko P1 przy rozgrzewce bloków, tylko na drugim
    // pomocniku: `prefetchAboveFoldQueries` ma WŁASNY budżet 2 500 ms i po nim
    // wraca ROZSTRZYGNIĘTA SUKCESEM, zostawiając zapytania w locie. Decyzja
    // o nagłówku musi czytać jej sygnał `degraded`, bo kształt obietnicy nic
    // tu nie powie - a treść nad zgięciem to CAŁA widoczna część strony.
    h.aboveFoldDegraded = true;
    await runLoader(
      "o-nas",
      stronaZDokumentem({ version: 1, sections: [{ id: "s0", children: [] }] }),
    );

    expect(h.aboveFoldLangs).toEqual(["pl"]);
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });
});

describe("loader trasy `/$` - rozgrzewka slotów reklamowych", () => {
  const BANER = { id: "ad-1", position: "header_banner", page_id: null };
  const NAD_TRESCIA = { id: "ad-2", position: "top_of_post", page_id: null };

  it("grzeje baner nagłówka I slot nad treścią JEDNYM zapytaniem", async () => {
    // Dwa round-tripy nie zmieściłyby się w fali wtórnej: ma 6 odnóg przy
    // sufcie 6 (`check:ssr-budgets`, twardy limit 6 podżądań runtime Workers).
    stub.setResponse("ad_placements", ok([BANER, NAD_TRESCIA]));

    const { queryClient } = await runLoader("analizy/atom", resolvedPost());

    expect(h.zapytania.filter((t) => t === "ad_placements")).toHaveLength(1);
    // Klucze DOKŁADNIE te, spod których czytają widoki: `Header` renderuje
    // `<AdZone position="header_banner">` BEZ `pageId`, a slot nad treścią
    // dostaje `pageId` wpisu. Rozjazd któregokolwiek z nich to round-trip
    // w SSR i drugi po hydratacji - czyli skok układu mimo rozgrzewki.
    expect(
      queryClient.getQueryData(adPlacementsQueryOptions("header_banner", "post").queryKey),
    ).toEqual([BANER]);
    expect(
      queryClient.getQueryData(adPlacementsQueryOptions("top_of_post", "post", "post-1").queryKey),
    ).toEqual([NAD_TRESCIA]);
  });

  it("STRONA grzeje te same pozycje pod swoim typem strony", async () => {
    stub.setResponse("ad_placements", ok([NAD_TRESCIA]));

    const { queryClient } = await runLoader("o-nas", stronaZDokumentem(null));

    expect(
      queryClient.getQueryData(adPlacementsQueryOptions("top_of_post", "page", "post-1").queryKey),
    ).toEqual([NAD_TRESCIA]);
  });

  it("NIE grzeje banera tam, gdzie powłoka liczy inny typ strony niż treść", async () => {
    // `SiteChrome` liczy typ strony banera z ADRESU
    // (`adPageTypeForLocation`), a nie z `kind` treści: pod `/publications/*`
    // to jest "archive", nie "page". Rozgrzewka pod kluczem "page" byłaby
    // wtedy round-tripem za nic, a wyrównanie drugim zapytaniem - siódmym
    // podżądaniem w szczycie.
    stub.setResponse("ad_placements", ok([NAD_TRESCIA]));
    h.requestUrl = "https://nes.example.com/publications/raport";

    const { queryClient } = await runLoader("publications/raport", stronaZDokumentem(null));

    expect(h.zapytania.filter((t) => t === "ad_placements")).toHaveLength(1);
    expect(
      queryClient.getQueryData(adPlacementsQueryOptions("top_of_post", "page", "post-1").queryKey),
    ).toEqual([NAD_TRESCIA]);
    expect(
      queryClient.getQueryData(adPlacementsQueryOptions("header_banner", "page").queryKey),
    ).toBeUndefined();
  });

  it("padnięta rozgrzewka reklam NIE zdejmuje cache'u wspólnego - reklama to dekoracja", async () => {
    // Brak banera degraduje wyłącznie rezerwację jego własnych pikseli. Gdyby
    // liczył się jak treść, jedna niesprzedana emisja kosztowałaby cache
    // WSPÓLNY całego dokumentu - ta sama doktryna, co przy `chromeQueryKeys`
    // w korzeniu.
    stub.setResponse("ad_placements", fail("permission denied", "42501"));

    const { wynik } = await runLoader("analizy/atom", resolvedPost());

    expect(jakoWynik(wynik).kind).toBe("post");
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(false);
  });
});

// ===========================================================================
// CZEGO TEN PLIK NIE MONTUJE - i dlaczego to jest decyzja, nie przeoczenie.
// ===========================================================================
//
// `Route.options.component` (`PublicPage` -> `ResolvedPage`, `$.tsx:571` i `:582`)
// ZOSTAJE NIEZAMONTOWANY. Nie z powodu braku atrapy routera - `renderRoute`
// z `src/test/routeHarness.tsx` postawiłby prawdziwy `RouterProvider` - ale
// dlatego, że `ResolvedPage` to 850 linii kompozycji (`$.tsx:582-1431`) nad 102
// deklaracjami importu ze 100 różnych modułów - liczby ZMIERZONE na tym HEAD,
// nie oszacowane (renderer treści, powłoka buildera, paywall, metering,
// prezenty, przypisy, reklamy śródtekstowe, powiązane wpisy, komentarze,
// słownik, audio, layouty).
// Montaż tego drzewa oznacza atrapy kilkunastu modułów naraz, a każda z nich
// jest wtedy WŁASNYM źródłem fałszywej czerwieni przy następnej zmianie
// któregokolwiek z tych importów - i wtedy plik przestaje mierzyć trasę,
// a zaczyna mierzyć zestaw atrap.
//
// Jest przy tym drugie ustalenie, i to ono jest tu ważniejsze: gałąź
// `if (!data) return <PublicNotFound />` w `PublicPage` (`$.tsx:578`) jest
// z routera NIEOSIĄGALNA. Przesłankę tego zdania sprawdza przypadek „brak
// treści pod adresem daje 404" wyżej w tym pliku: loader, który dostanie
// z cache'u pusty wynik, NIE ODDAJE `null` - wchodzi w gałąź „treści nie ma"
// i RZUCA `notFound()`. Skoro loader rzuca, komponent nigdy nie dostaje
// pustego wyniku, więc ta gałąź jest strażnikiem obronnym, a nie stanem
// produkcyjnym (i dlatego NIE jest tu zapisana jako defekt). Wymuszenie jej
// renderem wymagałoby rozejścia klucza zapytania między loaderem
// i komponentem, czego trasa nie robi.
//
// Render drzewa treści ma więc zostać osobną pracą, z osobnym plikiem i osobnym
// budżetem atrap; ścieżkę użytkownika pokrywają dziś testy e2e i bramki SSR
// (`publicSurfacesSsrContent.test.tsx`).
