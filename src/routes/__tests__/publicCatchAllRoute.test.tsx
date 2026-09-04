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

const stub = supabaseFromStub();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => stub.from(table),
    // `resolve_path` i `get_entity_content` - w tym pliku treść wchodzi do
    // cache'u zapytań WPROST (patrz `runLoader`), więc RPC domyślnie odpowiada
    // pusto. Awaria bazy ma własny przypadek i włącza się przez `h.rpcError`.
    rpc: () =>
      Promise.resolve(h.rpcError ? { data: null, error: h.rpcError } : { data: null, error: null }),
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
import { splatToSegments } from "@/lib/routing/publicSegments";
import { Route } from "@/routes/$";

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
): Promise<{ wynik: unknown; queryClient: QueryClient }> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (tresc) {
    const opcje = resolvedContentQueryOptions(splatToSegments(splat));
    queryClient.setQueryData(opcje.queryKey, tresc);
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

  it("RZUT z zapytania o TREŚĆ daje 404, a nie surowy 500", async () => {
    // Awaria bazy przy rezolucji ścieżki (`resolve_path` oddaje błąd, a fetcher
    // go RZUCA - `queries/public.ts:675`) jest tu pochłaniana i sprowadzana do
    // „treści nie ma": czytelnik dostaje ekran 404 z powłoką i ze skrótami,
    // robot dostaje status 404, i nikt nie dostaje strony błędu z diagnostyką.
    // To ta jedna gałąź odróżnia „adresu nie ma" od „nie udało się sprawdzić".
    h.rpcError = { message: "resolve_path: connection reset" };
    const { wynik } = await runLoader("analizy/atom");
    expect(isNotFound(wynik)).toBe(true);
    // Odpowiedź 404 z AWARII nie może wejść do cache'u brzegowego: adres
    // zaczyna działać, gdy baza wróci, a nie po wygaśnięciu TTL.
    expect(h.cacheControl).not.toEqual([]);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
  });

  it("brak treści pod adresem daje 404 bez żadnego rzutu z bazy", async () => {
    // Kontrola dla przypadku wyżej: ta sama odpowiedź (404 + `no-store`) dla
    // adresu, którego po prostu nie ma. Bez tej pary asercja wyżej nie
    // pokazywałaby, że badana jest gałąź AWARII, a nie zwykłego pudła.
    const { wynik } = await runLoader("analizy/atom");
    expect(isNotFound(wynik)).toBe(true);
    expect(h.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
  });
});

// ===========================================================================
// CZEGO TEN PLIK NIE MONTUJE - i dlaczego to jest decyzja, nie przeoczenie.
// ===========================================================================
//
// `Route.options.component` (`PublicPage` -> `ResolvedPage`, `$.tsx:571` i `:582`)
// ZOSTAJE NIEZAMONTOWANY. Nie z powodu braku atrapy routera - `renderRoute`
// z `src/test/routeHarness.tsx` postawiłby prawdziwy `RouterProvider` - ale
// dlatego, że `ResolvedPage` to ~800 linii kompozycji nad ~60 importami
// (renderer treści, powłoka buildera, paywall, metering, prezenty, przypisy,
// reklamy śródtekstowe, powiązane wpisy, komentarze, słownik, audio, layouty).
// Montaż tego drzewa oznacza atrapy kilkunastu modułów naraz, a każda z nich
// jest wtedy WŁASNYM źródłem fałszywej czerwieni przy następnej zmianie
// któregokolwiek z tych importów - i wtedy plik przestaje mierzyć trasę,
// a zaczyna mierzyć zestaw atrap.
//
// Jest przy tym drugie ustalenie, ZMIERZONE, a nie założone: gałąź
// `if (!data) return <PublicNotFound />` w `PublicPage` (`$.tsx:578`) jest
// z routera NIEOSIĄGALNA. Loader, który dostanie z cache'u `null`, wchodzi
// w gałąź „treści nie ma" i RZUCA `notFound()` (`$.tsx:245`), więc komponent
// nigdy nie zobaczy pustego wyniku - to strażnik obronny, a nie stan
// produkcyjny. Sprawdzenie tego renderem wymagałoby rozejścia klucza zapytania
// między loaderem i komponentem, czego trasa nie robi.
//
// Render drzewa treści ma więc zostać osobną pracą, z osobnym plikiem i osobnym
// budżetem atrap; ścieżkę użytkownika pokrywają dziś testy e2e i bramki SSR
// (`publicSurfacesSsrContent.test.tsx`).
