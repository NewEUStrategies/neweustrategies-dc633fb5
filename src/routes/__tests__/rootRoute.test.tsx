// KORZEŃ DRZEWA TRAS - loader, `head()` i sklejenie powłoki.
//
// Do 2026-09-01 ten plik miał 0 z 124 pokrytych linii i 0 z 48 funkcji, mimo że
// POSIADA OBA BUDŻETY ROZGRZEWKI SSR. Próg globalny tego nie widział, bo jest
// agregatem po całym `src/`.
//
// CO TEN PLIK DOWODZI - cztery rzeczy, każda z ceną awarii:
//
//  1. ZASIEW RODZI SIĘ PRZETERMINOWANY (`dataUpdatedAt === 0`). Bez tego jedna
//     czkawka bazy w oknie fali 1 przypina WBUDOWANE DOMYŚLNE w cache'u klienta
//     na 5-10 minut (`staleTime`), a klient nigdy nie dociąga prawdziwej
//     wartości. Dla `site_settings` skutek jest najostrzejszy: `Header` zwraca
//     `null` przy pustym `builder_data`, czyli czytelnik oglądałby stronę BEZ
//     NAGŁÓWKA do końca wizyty. Doktryna była w repo o jedną trasę dalej
//     (`routes/index.tsx`) i tu jej brakowało.
//  2. DEKORACJA NIGDY NIE WYWRACA SERWISU. Loader korzenia biegnie na KAŻDEJ
//     trasie, więc nie może być pojedynczym punktem awarii całego serwisu:
//     `allSettled` + budżet + `try/catch`, a awaria ustawień kończy się `null`,
//     nie rzutem.
//  3. DRUGA FALA MA WŁASNY, KRÓTKI BUDŻET (`CHROME_WARM_BUDGET_MS`). Wcześniej
//     miała ten sam 2 500 ms co fala 1, a startuje po jej rozstrzygnięciu -
//     czyli korzeń mógł trzymać dokument 5 s BEZ JEDNEGO BAJTU HTML-a, na każdej
//     trasie publicznej.
//  4. STRAŻNIK ZAPYTAŃ MENU USUWA TYLKO TE, KTÓRE NIE MOGĄ SIĘ ROZSTRZYGNĄĆ.
//     Szerszy predykat (samo `pending`) usuwał też zapytanie, któremu wyczerpał
//     się budżet, ale które nadal leci - czyli był aktywną ścieżką UTRATY DANYCH.
//
// Loader wołamy jako funkcję, bez runtime'u routera - to ten sam kod, który
// wykona framework, tylko bez kosztu całego drzewa (ta sama doktryna co
// `archiveRoutes.test.ts`). `src/test/routeHarness.tsx` nie da się tu użyć: buduje
// własny, atrapowy korzeń i wiesza trasę pliku jako jego dziecko, więc prawdziwy
// `__root` nigdy nie zostaje korzeniem.
import { readChromeWarmup } from "@/lib/ssr/chromeWarmup";
import { chromeDegradedCacheControl } from "@/lib/http/cachePolicy";
import { QueryClient } from "@tanstack/react-query";
import { createBackgroundScope } from "@/lib/backgroundScope";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GA4_MEASUREMENT_ID } from "@/lib/analytics/ga4Client";
import { homeSsrDeadline } from "@/lib/ssr/homeSsrBudget";
import { stripLangPrefix } from "@/lib/i18n/localePath";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  origin: "https://neweuropeanstrategies.com",
  chrome: true,
  server: false,
  cacheControl: [] as string[],
  canonicalCalls: 0,
  i18nSyncCalls: 0,
  /** Adresy, z którymi wołano `syncI18nToRequest` (publicHref z prefiksem języka). */
  i18nSyncHrefs: [] as (string | undefined)[],
  linkHeaders: [] as string[],
  settings: {} as Record<string, unknown>,
  settingsHangs: false,
  settingsFails: false,
  prefetch: [] as { budget: number }[],
  ticker: [] as unknown[],
  menus: [] as string[],
  menusHang: false,
  cancelMenus: false,
  social: [] as unknown[],
  brand: [] as unknown[],
  ads: [] as string[],
  adsHang: false,
  /** `syncI18nToRequest` odrzuca - awaria warstwy językowej żądania. */
  i18nSyncFails: false,
  /** Fabryka opcji menu rzuca - rozgrzewka menu odrzuca JESZCZE przed falą 1. */
  menusThrow: false,
  /** Fabryka opcji tickera rzuca - awaria WEWNĄTRZ bloku rozgrzewki chrome'u. */
  tickerThrows: false,
  /** Nazwa chunku rdzenia słownika, którą build podstawia w `LOCALE_CHUNK_URLS`. */
  dictionaryChunk: null as string | null,
  /** Hinty chunków widgetów, które build podstawia w `WIDGET_CHUNK_URLS`. */
  widgetHints: [] as string[],
  /** Montaże atrapy banera zgód (P1.3): props `takeover` z każdego renderu. */
  bannerMounts: [] as unknown[],
  /** Pobrania tabeli rozmiarów czcionek (P3.8 #1) i jej zawieszenie. */
  fontScaleFetches: 0,
  fontScaleHangs: false,
  /** Rozgrzewki sygnału „brak aktywnych popupów" (P3.8 #4a). */
  popupWarms: 0,
  /** Sesja zespołu redakcji (`useAuth().isStaff`). */
  staff: false,
}));

vi.mock("@/lib/i18n/localeRuntime", async (o) => ({
  ...(await o<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));
vi.mock("@/lib/seo/request", async (o) => ({
  ...(await o<typeof import("@/lib/seo/request")>()),
  getOrigin: () => h.origin,
}));
vi.mock("@/lib/http/canonicalRedirect", () => ({
  enforceCanonicalHost: () => void h.canonicalCalls++,
}));
vi.mock("@/lib/i18n", async (o) => ({
  ...(await o<typeof import("@/lib/i18n")>()),
  syncI18nToRequest: async (publicHref?: string) => {
    h.i18nSyncCalls++;
    h.i18nSyncHrefs.push(publicHref);
    if (h.i18nSyncFails) throw new Error("i18n zadania padlo");
  },
  getRenderI18n: () => ({}),
}));
// Nazwy chunków słownika i widgetów powstają dopiero w BUILDZIE serwerowym
// (`scripts/lib/localeChunkPlugin.ts`), a w źródłach stoją puste - bez atrapy
// obie gałęzie „build podstawił nazwę" byłyby w teście nieosiągalne.
vi.mock("@/lib/seo/localeChunks", () => ({
  LOCALE_CHUNK_URLS: {
    get pl() {
      return h.dictionaryChunk;
    },
    get en() {
      return h.dictionaryChunk;
    },
  },
}));
vi.mock("@/lib/seo/widgetPreloads", () => ({
  widgetPreloadHeaders: () => h.widgetHints,
}));
vi.mock("@/lib/http/responseHeaders", () => ({
  appendLinkHeader: (v: string) => h.linkHeaders.push(v),
  setCacheControlHeader: (v: string) => h.cacheControl.push(v),
}));
// Atrapa interaktywnego banera zgód (P1.3): dowodem jest MOMENT i SPOSÓB
// montażu przez `ConsentSurface` (kolejka P0.3, tor pilny, zapis decyzji), a nie
// wygląd banera - ten ma własne testy (`ConsentBanner.test.tsx`). Atrapa woła
// `onReady` z efektu warstwy, jak prawdziwy baner.
vi.mock("@/components/ConsentBanner", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    ConsentBanner: (props: { takeover?: unknown; onReady?: () => void }) => {
      useLayoutEffect(() => {
        props.onReady?.();
      }, [props]);
      h.bannerMounts.push(props.takeover);
      return <div data-testid="consent-banner-stub" />;
    },
  };
});
// Most rejestru RODO: zapis decyzji zalogowanego idzie do funkcji serwerowej -
// poza tym plikiem (testy mostu w `lib/consent/__tests__`).
vi.mock("@/lib/consent/registryBridge", () => ({
  syncCmpDecisionToRegistry: async () => undefined,
  backfillRegistryOnLogin: async () => undefined,
  syncGpcSignalToRegistry: async () => undefined,
}));
// `HeadContent`/`Scripts` czytają kontekst routera, którego goły render powłoki
// dokumentu nie ma (wzorzec `rootShellRender.test.tsx`) - tylko na potrzeby
// testu kolejności skryptów w `<head>` (P1.3). Reszta modułu prawdziwa.
vi.mock("@tanstack/react-router", async (o) => ({
  ...(await o<typeof import("@tanstack/react-router")>()),
  HeadContent: () => null,
  Scripts: () => null,
}));
vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return h.server;
  },
}));
vi.mock("@/lib/routing/siteChrome", () => ({ showsSiteChrome: () => h.chrome }));
vi.mock("@/lib/useSiteSetting", async (o) => ({
  ...(await o<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site-settings"],
    queryFn: () =>
      h.settingsHangs
        ? new Promise(() => {})
        : h.settingsFails
          ? Promise.reject(new Error("ustawienia padly"))
          : Promise.resolve(h.settings),
  },
}));
vi.mock("@/lib/builder/designTokens", async (o) => ({
  ...(await o<typeof import("@/lib/builder/designTokens")>()),
  designTokensQueryOptions: { queryKey: ["design-tokens"], queryFn: async () => null },
}));
vi.mock("@/hooks/useGlobalColors", async (o) => ({
  ...(await o<typeof import("@/hooks/useGlobalColors")>()),
  globalColorsQueryOptions: { queryKey: ["global-colors"], queryFn: async () => null },
}));
// Tabela rozmiarów czcionek (P3.8 #1): ten sam wiersz co tokeny, osobny klucz.
vi.mock("@/hooks/useFontScale", async (o) => ({
  ...(await o<typeof import("@/hooks/useFontScale")>()),
  fontScaleQueryOptions: {
    queryKey: ["font-scale"],
    queryFn: () => {
      h.fontScaleFetches += 1;
      return h.fontScaleHangs ? new Promise(() => {}) : Promise.resolve({ h1: 40 });
    },
  },
}));
// Sygnał „brak aktywnych popupów" (P3.8 #4a): atrapa zapisuje to, co prawdziwa
// projekcja przy pustym wyniku - pustą listę pod kluczem `useActivePopups`.
vi.mock("@/lib/builder/popups", async (o) => ({
  ...(await o<typeof import("@/lib/builder/popups")>()),
  warmNoActivePopups: async (qcArg: QueryClient) => {
    h.popupWarms += 1;
    qcArg.setQueryData(["builder-popups-active"], []);
  },
}));
vi.mock("@/hooks/useAuth", async (o) => {
  const actual = await o<typeof import("@/hooks/useAuth")>();
  return {
    ...actual,
    useAuth: () => {
      const real = actual.useAuth();
      return h.staff ? { ...real, isStaff: true } : real;
    },
  };
});
vi.mock("@/lib/menus/queries", () => ({
  menuWithItemsQueryOptions: (key: string) => {
    if (h.menusThrow) throw new Error("modul menu padl");
    return {
      queryKey: ["menu-with-items", key],
      queryFn: () =>
        h.menusHang ? new Promise(() => {}) : Promise.resolve((h.menus.push(key), [])),
    };
  },
}));
// DRUGA ATRAPA MENU - na funkcji serwerowej POD `menus/queries`, nie zamiast
// tamtej. Korzeń importuje `menus/queries` DYNAMICZNIE i DWA RAZY na loader
// (`void warmMenus()` przed falą 1 i ta sama funkcja w fali chrome). Vitest
// dzieli jedną tablicę `callstack` między wszystkie importy modułu i na czas
// rozwiązywania atrapy z fabryką dopisuje do niej id atrapy; drugi import,
// który trafi w to okno, jest brany za „samo-import" atrapy i dostaje
// ORYGINALNY `queries.ts` (zmierzone: w 30 z 48 przypadków tego pliku). Jego
// `queryFn` woła prawdziwy `createServerFn`, a ten poza runtime'em Startu rzuca
// „No Start context found in AsyncLocalStorage". Ta atrapa sprawia, że oryginał
// zachowuje się DOKŁADNIE jak atrapa wyżej - żadna ścieżka tego pliku nie może
// już dotknąć prawdziwej funkcji serwerowej.
vi.mock("@/lib/menus/menu.functions", () => ({
  getMenuWithItems: ({ data }: { data: { key: string } }) =>
    h.menusThrow
      ? Promise.reject(new Error("modul menu padl"))
      : h.menusHang
        ? new Promise(() => {})
        : Promise.resolve((h.menus.push(data.key), [])),
  listMenus: () => Promise.resolve([]),
}));
// Placementy reklamowe: atrapa oddaje TEN SAM klucz, co produkcja (fabryka
// `adPlacementsQueryOptions`), więc test dowodzi też, że korzeń grzeje klucz,
// który naprawdę czyta `<AdZone>` w nagłówku.
vi.mock("@/lib/ads/queries", async (o) => ({
  ...(await o<typeof import("@/lib/ads/queries")>()),
  adPlacementsQueryOptions: (position: string, pageType: string, pageId?: string | null) => ({
    queryKey: ["ad_placements", position, pageType, pageId ?? null],
    queryFn: () =>
      h.adsHang
        ? new Promise(() => {})
        : Promise.resolve((h.ads.push(`${position}:${pageType}`), [])),
  }),
}));
vi.mock("@/lib/views/headerTickerQuery", async (o) => ({
  ...(await o<typeof import("@/lib/views/headerTickerQuery")>()),
  headerTickerQueryOptions: () => {
    if (h.tickerThrows) throw new Error("konfiguracja tickera padla");
    return {
      queryKey: ["header-ticker"],
      queryFn: async () => (h.ticker.push("warm"), []),
    };
  },
}));
vi.mock("@/lib/builder/prefetch", async (o) => ({
  ...(await o<typeof import("@/lib/builder/prefetch")>()),
  prefetchCachedRouteQueries: async (
    qcArg: QueryClient,
    _doc: unknown,
    _lang: unknown,
    budget: number,
  ) => {
    h.prefetch.push({ budget });
    // Odwzorowanie anulowania (HMR / zamiatanie serializacji przed prerenderem):
    // zapytanie zostaje `pending` + `fetchStatus: "idle"` + bez danych -
    // DOKŁADNIE ten stan, którego szuka strażnik zapytań menu w loaderze.
    if (h.cancelMenus) {
      // Czekamy, aż OBIE rozgrzewki menu wydadzą swoje `ensureQueryData`:
      // przedmiotem dowodu jest stan PO anulowaniu, więc nie może go już
      // nadpisać fetch startujący po dynamicznym imporcie. Czasu tego importu
      // NIE WOLNO zgadywać zegarem: gdy vitest podaje oryginalny moduł (atrapa
      // `menu.functions` wyżej), import kosztuje round-trip do procesu głównego,
      // a na shardzie CI pod pokryciem bywa on dłuższy niż dawne `setTimeout(20)`.
      // Wtedy spóźniona rozgrzewka startowała NOWY fetch na świeżo anulowanym
      // wpisie, strażnik go nie ruszał (`error`/`fetching`, nie `idle`) i test
      // padał. `dynamicImportSettled` czeka na faktyczne rozstrzygnięcie importu,
      // a `ensureQueryData` biegnie synchronicznie zaraz po nim.
      await vi.dynamicImportSettled();
      qcArg.removeQueries({ queryKey: ["menu-with-items"] });
      const wiszace = ["main", "footer"].map((key) =>
        qcArg
          .ensureQueryData({
            queryKey: ["menu-with-items", key],
            queryFn: () => new Promise(() => {}),
          })
          .catch(() => undefined),
      );
      await new Promise((r) => setTimeout(r, 0));
      // `revert` jest OPCJĄ anulowania, nie filtrem - drugi argument.
      await qcArg.cancelQueries({ queryKey: ["menu-with-items"] }, { revert: true });
      await Promise.allSettled(wiszace);
    }
  },
}));
vi.mock("@/lib/seo/socialDefaults", async (o) => ({
  ...(await o<typeof import("@/lib/seo/socialDefaults")>()),
  rememberSocialDefaults: (...a: unknown[]) => void h.social.push(a),
}));
vi.mock("@/lib/seo/brandDefaults", async (o) => ({
  ...(await o<typeof import("@/lib/seo/brandDefaults")>()),
  rememberBrandDefaults: (...a: unknown[]) => void h.brand.push(a),
}));

const {
  Route,
  ROOT_WARM_BUDGET_MS,
  CHROME_WARM_BUDGET_MS,
  ConsentShellSlot,
  ConsentSurface,
  useNoActivePopupsFromSsr,
  armCacheBusting,
} = await import("@/routes/__root");

type Loader = (a: {
  context: { queryClient: QueryClient };
  location: { pathname: string };
}) => Promise<unknown>;

function runLoader(qc: QueryClient, pathname = "/") {
  const loader = Route.options.loader as unknown as Loader;
  return loader({ context: { queryClient: qc }, location: { pathname } });
}

let qc: QueryClient;
beforeEach(() => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.linkHeaders = [];
  h.prefetch = [];
  h.ticker = [];
  h.menus = [];
  h.ads = [];
  h.adsHang = false;
  h.social = [];
  h.brand = [];
  h.canonicalCalls = 0;
  h.i18nSyncCalls = 0;
  h.i18nSyncHrefs = [];
  h.settings = {};
  h.settingsHangs = false;
  h.chrome = true;
  h.server = false;
  h.cacheControl = [];
  h.i18nSyncFails = false;
  h.menusThrow = false;
  h.tickerThrows = false;
  h.dictionaryChunk = null;
  h.widgetHints = [];
  h.fontScaleFetches = 0;
  h.fontScaleHangs = false;
  h.popupWarms = 0;
  h.staff = false;
});

describe("__root loader", () => {
  it("does not cancel shared theme requests on non-home routes", async () => {
    h.server = true;
    h.settingsHangs = true;
    const cancel = vi.spyOn(qc, "cancelQueries");
    await runLoader(qc, "/blog");
    expect(cancel).not.toHaveBeenCalled();
    expect(qc.getQueryState(["site-settings"])?.fetchStatus).toBe("fetching");
    await qc.cancelQueries();
    cancel.mockRestore();
  });

  // Loader dostaje `location.pathname` PO rewrite `input` routera (ta sama
  // funkcja: `stripLangPrefix`), więc "/en" i "/en/" docierają jako "/" -
  // dowód na prawdziwym routerze: `lib/i18n/__tests__/urlLanguageNavigation.test.tsx`.
  it.each(["/", "/en", "/en/"])(
    "bounds homepage theme waiting and disables cache at %s",
    async (path) => {
      h.server = true;
      h.settingsHangs = true;
      const started = performance.now();
      await runLoader(qc, stripLangPrefix(path).pathname);
      expect(performance.now() - started).toBeLessThan(900);
      expect(qc.getQueryState(["site-settings"])).toMatchObject({
        status: "success",
        fetchStatus: "idle",
        dataUpdatedAt: 0,
      });
      expect(h.cacheControl).toContain("private, no-store");
    },
  );

  // DOKUMENT BEZ SERWEROWEGO RENDERU (`/admin`, `ssr: false`).
  //
  // Panel nie renderuje na serwerze ANI treści (trasa wyłącza SSR), ANI chrome'u
  // (`showsSiteChrome` jest tam fałszem), a jego dokumenty są na deny-liście
  // NES Edge Cache - czyli każde twarde wejście płaciło pełne 2 500 ms fali 1
  // za dane, z których nie powstaje ani jeden piksel przed hydratacją. Te trzy
  // przypadki przypinają nowy kontrakt i jego GRANICE.
  it("ścina falę 1 na dokumencie bez serwerowego renderu (`/admin`)", async () => {
    h.server = true;
    h.chrome = false;
    h.settingsHangs = true;
    const started = performance.now();
    await runLoader(qc, "/admin");
    // Z terminem: rzędu CLIENT_ONLY_WARM_BUDGET_MS. Bez niego: 2 500 ms.
    expect(performance.now() - started).toBeLessThan(900);
    // Zasiew rodzi się PRZETERMINOWANY, więc klient dociąga prawdziwe
    // ustawienia natychmiast po hydratacji - tą samą drogą, co resztę panelu.
    expect(qc.getQueryState(["site-settings"])).toMatchObject({ dataUpdatedAt: 0 });
    await qc.cancelQueries();
  });

  it("panel NIE anuluje wspólnych zapytań motywu - to kontrakt wyłącznie strony głównej", async () => {
    h.server = true;
    h.chrome = false;
    h.settingsHangs = true;
    const cancel = vi.spyOn(qc, "cancelQueries");
    await runLoader(qc, "/admin");
    expect(cancel).not.toHaveBeenCalled();
    // Zapytanie NADAL LECI: jeśli zdąży przed zamiataniem cache'u, jego dane
    // pojadą do klienta. Termin ogranicza CZEKANIE, nie odbiera wyniku.
    expect(qc.getQueryState(["site-settings"])?.fetchStatus).toBe("fetching");
    await qc.cancelQueries();
    cancel.mockRestore();
  });

  it("nawigacja SPA po panelu zachowuje pełny budżet - termin jest WYŁĄCZNIE serwerowy", async () => {
    // KONTROLA NEGATYWNA tej zmiany, i dlatego kosztuje 2,5 s zegara. Termin
    // liczy się od `Date.now()` W MOMENCIE WYWOŁANIA LOADERA, co jest poprawne
    // dla żądania (jeden QueryClient na dokument) i byłoby błędem dla sesji
    // przeglądarki (jeden QueryClient na całe życie karty). Bramką jest
    // `isServer` - ten test pilnuje, żeby nie zniknęła.
    h.server = false;
    h.chrome = false;
    h.settingsHangs = true;
    const started = performance.now();
    await runLoader(qc, "/admin/posts");
    expect(performance.now() - started).toBeGreaterThan(2_000);
    await qc.cancelQueries();
  });

  it("zwraca wyłącznie strumień GA4 dla tagu Google - mapa ustawień nie jedzie do payloadu drugi raz", async () => {
    const data = await runLoader(qc);
    expect(data).toEqual({ ga4: { measurementId: GA4_MEASUREMENT_ID, enabled: true } });
    expect(Object.keys(data as object)).toEqual(["ga4"]);
  });

  it("wymusza kanoniczny host; języka NIE synchronizuje (robi to `beforeLoad`)", async () => {
    await runLoader(qc);
    expect(h.canonicalCalls).toBe(1);
    // Loader korzenia nie biegnie ponownie przy nawigacji klienta - synchronizacja
    // tutaj nie dosięgała „wstecz/dalej" (patrz `beforeLoad` niżej).
    expect(h.i18nSyncCalls).toBe(0);
  });

  it("dokłada nagłówki HTTP `Link` dla języka żądania (fonty startują przed HTML-em)", async () => {
    h.lang = "pl";
    await runLoader(qc);
    const pl = h.linkHeaders.join(" ");
    expect(pl).toContain('rel="preload"');
    h.linkHeaders = [];
    h.lang = "en";
    await runLoader(new QueryClient());
    expect(h.linkHeaders.length).toBeGreaterThan(0);
    h.lang = "pl";
  });

  it("zasiewa PRZETERMINOWANE domyślne, gdy fala 1 nic nie dowiozła", async () => {
    h.settingsHangs = true;
    h.fontScaleHangs = true;
    await runLoader(qc);
    const st = qc.getQueryState(["site-settings"]);
    expect(qc.getQueryData(["site-settings"])).toEqual({});
    expect(st?.dataUpdatedAt).toBe(0);
    expect(qc.getQueryState(["design-tokens"])?.dataUpdatedAt).toBe(0);
    expect(qc.getQueryState(["global-colors"])?.dataUpdatedAt).toBe(0);
    // P3.8 #1: tabela rozmiarów BEZ zasiewu - brak wpisu daje w SSR i w
    // hydratacji ten sam pusty arkusz, a klient pobiera go przy montażu tak samo
    // jak zasiew z `updatedAt: 0`; zasiew dokładałby tylko wpis do stanu SSR.
    expect(qc.getQueryData(["font-scale"])).toBeUndefined();
    await qc.cancelQueries();
  });

  // ── TABELA ROZMIARÓW CZCIONEK W FALI 1 (P3.8 #1) ──────────────────────────
  //
  // Bez rozgrzewki wpisu `site_font_scale` nie było w stanie SSR: serwer
  // renderował `:root` z pustą tabelą, a klient pobierał wiersz
  // `site_design_tokens` zaraz po hydratacji (GET + preflight na każdej trasie).
  it("fala 1 grzeje tabelę rozmiarów czcionek - wpis jedzie w stanie SSR", async () => {
    await runLoader(qc, "/blog");
    expect(h.fontScaleFetches).toBe(1);
    expect(qc.getQueryData(["font-scale"])).toEqual({ h1: 40 });
    expect(qc.getQueryState(["font-scale"])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("strona główna anuluje zawieszoną tabelę rozmiarów jak tokeny - bez wpisu w stanie SSR", async () => {
    h.server = true;
    h.fontScaleHangs = true;
    const cancel = vi.spyOn(qc, "cancelQueries");
    await runLoader(qc, "/");
    expect(cancel).toHaveBeenCalledWith({ queryKey: ["font-scale"], exact: true });
    // Anulowane zapytanie bez danych nie przechodzi `shouldDehydrateQuery`
    // (status `success`), więc dokument go nie niesie, a klient pobiera tabelę
    // przy montażu - jak przy każdej porażce fali 1.
    expect(qc.getQueryData(["font-scale"])).toBeUndefined();
    expect(qc.getQueryState(["font-scale"])?.status).not.toBe("success");
    expect(h.cacheControl).toContain("private, no-store");
    cancel.mockRestore();
  });

  it("prawdziwa tabela rozmiarów zostaje w cache'u tak, jak przyszła z bazy", async () => {
    await runLoader(qc);
    expect(qc.getQueryData(["font-scale"])).toEqual({ h1: 40 });
  });

  // ── ZASIEW UKŁADU TREŚCI - bez rozgrzewki sieciowej, ale MUSI BYĆ ─────────
  //
  // Defekt zgłoszony w recenzji PR #314 (P2): wyrzucając `postLayoutSettings`
  // z fali 1 wyleciał razem z nim ZASIEW DOMYŚLNYCH. Wtedy kosztowało to
  // pierwsze malowanie - `ContentAreaStyle` miał gałąź `return null` i bez wpisu
  // emitował w SSR zero bajtów.
  //
  // UZASADNIENIE PRZEPISANE 2026-09-20: tamta gałąź już nie istnieje (naprawa
  // F29a - bez wiersza komponent emituje blok z `defaultPostLayoutSettings()`,
  // wzorzec `ThemeFontSizesStyle`), więc zasiew nie ratuje już odstępów
  // akapitów. Zostaje jako PARYTET SSR/KLIENT na jednej i tej samej stałej:
  // serwer i pierwszy render klienta czytają ten sam wpis zamiast rozchodzić
  // się na `data === undefined`.
  //
  // Ten przypadek pilnuje OBU połów naprawy: że zasiew jest, i że rodzi się
  // przeterminowany - inaczej domyślne przypięłyby się na 5-10 minut i wartości
  // najemcy nigdy by nie doszły.
  it("zasiewa domyślny układ treści, i to PRZETERMINOWANY", async () => {
    await runLoader(qc);
    const state = qc.getQueryState(["post-layout-settings"]);
    expect(state, "bez zasiewu SSR i klient rozchodzą się na tym kluczu").toBeTruthy();
    expect(state?.dataUpdatedAt).toBe(0);
  });

  it("zasiew układu treści NIE nadpisuje wartości, którą ktoś już rozgrzał", async () => {
    // `/$` grzeje ten klucz sam; zasiew korzenia nie może mu wejść w drogę.
    const own = { list_style: "disc" };
    qc.setQueryData(["post-layout-settings"], own);
    await runLoader(qc);
    expect(qc.getQueryData(["post-layout-settings"])).toBe(own);
    expect(qc.getQueryState(["post-layout-settings"])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("NIE nadpisuje prawdziwych ustawień zasiewem", async () => {
    h.settings = { header: { builder_data: { sections: [] } } };
    await runLoader(qc);
    expect(qc.getQueryData(["site-settings"])).toEqual(h.settings);
    expect(qc.getQueryState(["site-settings"])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("bez chrome'u NIE grzeje ani menu, ani tickera, ani widgetów", async () => {
    h.chrome = false;
    await runLoader(qc, "/admin");
    expect(h.menus).toEqual([]);
    expect(h.ticker).toEqual([]);
    expect(h.prefetch).toEqual([]);
  });

  it("z chrome'em grzeje menu main + footer RÓWNOLEGLE z falą 1", async () => {
    h.chrome = true;
    await runLoader(qc);
    await vi.dynamicImportSettled();
    expect(h.menus.sort()).toEqual(["footer", "main"]);
  });

  it("grzeje ticker tylko gdy header ma sekcje (inaczej płaci się za nic)", async () => {
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    expect(h.ticker).toHaveLength(1);
  });

  it("nie grzeje tickera, gdy header jest pusty", async () => {
    h.settings = { header: { builder_data: { sections: [] } } };
    await runLoader(qc);
    expect(h.ticker).toHaveLength(0);
  });

  it("prefetch chrome'u dostaje KRÓTKI budżet drugiej fali, nie budżet fali 1", async () => {
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    // Budżet jest IMPORTOWANYM KONTRAKTEM, nie powtórzonym literałem: gdyby
    // test wpisywał 500, każda zmiana w źródle nadal by przechodziła.
    expect(h.prefetch.map((p) => p.budget)).toContain(CHROME_WARM_BUDGET_MS);
    // I jest ISTOTNIE KRÓTSZY od fali 1 - to jest cała treść naprawy punktu 1.
    expect(CHROME_WARM_BUDGET_MS).toBeLessThan(ROOT_WARM_BUDGET_MS);
  });

  // ── BANER `header_banner` W FALI CHROME (audyt CWV, F26) ────────────────
  //
  // `AdZone` zwraca `null` bez danych, a `AdContainer` rezerwuje wtedy ZERO
  // pikseli - 90 px banera nad treścią dojeżdżało po hydratacji i spychało
  // stronę w dół (~0,11 CLS). Rozgrzewka w korzeniu maluje go już w SSR.
  it("grzeje baner nagłówka dla typu strony, który rozstrzyga sam adres", async () => {
    // Serwerowo, bo tylko tam korzeń AWAITUJE falę chrome - a dowodem jest
    // wpis w cache'u, który pojedzie do klienta dehydratacją.
    h.server = true;
    await runLoader(qc, "/blog");
    expect(h.ads).toEqual(["header_banner:archive"]);
    // KLUCZ MUSI BYĆ TEN SAM, który czyta `<AdZone>` i `useHeaderSkeletonProps`.
    expect(qc.getQueryData(["ad_placements", "header_banner", "archive", null])).toEqual([]);
  });

  it.each([
    ["/", "home"],
    ["/category/geopolityka", "category"],
    ["/events/szczyt", "event"],
  ])("typ strony %s -> %s", async (path, pageType) => {
    await runLoader(qc, path);
    expect(h.ads).toEqual([`header_banner:${pageType}`]);
  });

  it("NIE grzeje banera, gdy typ strony rozstrzyga dopiero loader trasy", async () => {
    // Pod tym adresem stoi catch-all `$` (wpis albo strona), a jego typ wynika
    // z `loaderData` - korzeń widziałby tu wyłącznie "all" i rozgrzałby klucz,
    // którego NIKT nie czyta: round-trip za nic na najczęściej odwiedzanej
    // powierzchni serwisu. Ten klucz grzeje `$.tsx`.
    await runLoader(qc, "/analiza-o-czyms");
    expect(h.ads).toEqual([]);
  });

  it("nierozgrzany baner NIE degraduje dokumentu - reklama jest dekoracją", async () => {
    // Gdyby klucz banera trafił do `chromeQueryKeys`, brak sprzedanej emisji
    // (albo jedna czkawka bazy) zbijałby na brzegu KAŻDY taki render.
    h.server = true;
    h.adsHang = true;
    await runLoader(qc, "/blog");
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(h.cacheControl).not.toContain("private, no-store");
    await qc.cancelQueries();
  });

  it("zapamiętuje domyślne karty społecznościowej i marki dla synchronicznego head()", async () => {
    h.settings = { seo: { default_og_image_url: "https://x/y.png" } };
    await runLoader(qc);
    expect(h.social).toHaveLength(1);
    expect(h.brand).toHaveLength(1);
  });

  it("wiszące, ale NADAL LECĄCE menu ZOSTAJE - usunięcie go byłoby utratą danych", async () => {
    h.menusHang = true;
    await runLoader(qc);
    await vi.dynamicImportSettled();
    expect(qc.getQueryState(["menu-with-items", "main"])?.fetchStatus).toBe("fetching");
    h.menusHang = false;
  });

  it("ANULOWANE menu (pending + idle + bez danych) JEST usuwane - inaczej seroval czeka na martwą obietnicę", async () => {
    h.menusHang = true;
    h.cancelMenus = true;
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    await runLoader(qc);
    expect(qc.getQueryState(["menu-with-items", "main"])).toBeUndefined();
    expect(qc.getQueryState(["menu-with-items", "footer"])).toBeUndefined();
    h.menusHang = false;
    h.cancelMenus = false;
  });

  // ── AWARIE, KTÓRYCH LOADER KORZENIA NIE MA PRAWA PODNIEŚĆ ───────────────
  //
  // Ten loader biegnie na KAŻDEJ trasie serwisu, więc każdy rzut, który z niego
  // wyjdzie, jest awarią CAŁEGO serwisu - także tam, gdzie zawiodła wyłącznie
  // dekoracja. Poniżej niezależne miejsca, w których coś realnie potrafi
  // paść, i dowód, że żadne z nich nie wychodzi na zewnątrz (awaria warstwy
  // językowej - patrz `__root beforeLoad`).
  it("awaria modułu menu NIE wywraca loadera - menu dociągnie klient", async () => {
    // Rozgrzewka menu startuje PRZED falą 1 (`void warmMenus()`), czyli poza
    // jakimkolwiek `await` loadera. Bez `.catch()` przy starcie jej odrzucenie
    // byłoby NIEOBSŁUŻONE i wywróciłoby proces renderu, a nie tylko nagłówek.
    h.menusThrow = true;

    await expect(runLoader(qc)).resolves.toBeTruthy();
    await vi.dynamicImportSettled();

    expect(h.menus).toEqual([]);
  });

  it("awaria WEWNĄTRZ fali chrome'u odbiera dokumentowi brzeg, ale nie serwis", async () => {
    // Rozgrzewka chrome'u jest dekoracją, więc jej rzut łapie `try/catch` -
    // ale dokument, którego powłoka nie powstała, nie ma prawa utrwalić się
    // na brzegu dla kolejnych czytelników.
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    h.tickerThrows = true;

    await expect(runLoader(qc)).resolves.toBeTruthy();

    expect(h.cacheControl).toContain("private, no-store");
  });

  it("odrzucone anulowanie zapytania motywu nie wywraca renderu strony głównej", async () => {
    // `cancelQueries` odrzuca, gdy zapytanie zdąży wejść w stan, którego nie da
    // się anulować. To ostatnia operacja przed zasiewem - jej rzut kosztowałby
    // stronę główną CAŁY dokument, a nie jedno nieanulowane zapytanie.
    h.server = true;
    h.settingsHangs = true;
    const cancel = vi
      .spyOn(qc, "cancelQueries")
      .mockImplementation(() => Promise.reject(new Error("anulowanie padlo")));
    try {
      await expect(runLoader(qc, "/")).resolves.toBeTruthy();
      expect(h.cacheControl).toContain("private, no-store");
    } finally {
      cancel.mockRestore();
      await qc.cancelQueries();
    }
  });

  // ── HINTY, KTÓRE ISTNIEJĄ DOPIERO PO BUILDZIE ──────────────────────────
  //
  // `LOCALE_CHUNK_URLS` i `WIDGET_CHUNK_URLS` są w źródłach PUSTE - nazwy
  // chunków podstawia wtyczka builda serwerowego. Bez atrapy obie gałęzie
  // „nazwa jest" byłyby w teście nieosiągalne, a to one działają na produkcji.
  it("chunk rdzenia słownika jedzie WYŁĄCZNIE nagłówkiem `Link`, jako modulepreload", async () => {
    // Nigdy `<link>` w `<head>`: nazwa pliku jest znana tylko na serwerze, więc
    // węzeł w dokumencie rozjeżdżałby hydratację korzenia.
    h.dictionaryChunk = "/assets/locale-pl-abc123.js";

    await runLoader(qc);

    expect(h.linkHeaders).toContain('</assets/locale-pl-abc123.js>; rel="modulepreload"');
  });

  it("hinty chunków widgetów nagłówka jadą nagłówkiem `Link` tylko w SSR", async () => {
    // Powód jest ten sam co wyżej i dodatkowo: w przeglądarce nagłówka
    // odpowiedzi już nie ma komu dołożyć, a chunki i tak są w mapie modułów.
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    h.widgetHints = ['</assets/widget-menu.js>; rel="modulepreload"; crossorigin'];

    h.server = true;
    await runLoader(qc, "/blog");
    expect(h.linkHeaders).toContain('</assets/widget-menu.js>; rel="modulepreload"; crossorigin');

    h.linkHeaders = [];
    h.server = false;
    await runLoader(new QueryClient({ defaultOptions: { queries: { retry: false } } }), "/blog");
    expect(h.linkHeaders).not.toContain(
      '</assets/widget-menu.js>; rel="modulepreload"; crossorigin',
    );
  });

  // ── POWIERZCHNIA Z CHROME'EM, ALE BEZ SERWEROWEJ TREŚCI ────────────────
  it("`/profile` czeka KRÓCEJ niż pełna fala 1 i nie utrwala się na brzegu", async () => {
    // Widok profilu rozstrzyga sesja z `localStorage` po hydratacji, więc fala
    // 1 maluje tu wyłącznie nagłówek i stopkę. Czekanie pełnych 2 500 ms na
    // dane, z których nie powstanie ani jeden piksel treści, było czystą stratą
    // TTFB - a dokument na domyślnych ustawieniach nie może pojechać na brzeg.
    h.server = true;
    h.settingsHangs = true;
    const started = performance.now();

    await runLoader(qc, "/profile/moje-konto");

    expect(performance.now() - started).toBeLessThan(2_000);
    expect(h.cacheControl).toContain("private, no-store");
    await qc.cancelQueries();
  });

  it("wyczerpany zegar żądania ZERUJE budżet fali chrome - nie zaczynamy pracy na nic", async () => {
    // Zegar jest WSPÓLNY dla loaderów jednego dokumentu (`routeSsrDeadline`
    // trzyma go na `QueryClient`), więc wolny loader trasy potrafi zjeść cały
    // budżet, zanim korzeń dojdzie do fali chrome. Startowanie wtedy rozgrzewki
    // to round-tripy, których wynik i tak nie zdąży do HTML-a.
    h.server = true;
    // Ustawienia JUŻ SĄ w cache'u, więc pusta lista rozgrzewek niżej jest
    // skutkiem wyzerowanego budżetu, a nie braku konfiguracji nagłówka.
    qc.setQueryData(["site-settings"], { header: { builder_data: { sections: [{ id: "s" }] } } });
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() - 10_000);
    homeSsrDeadline(qc);
    clock.mockRestore();

    await runLoader(qc, "/");

    expect(h.ticker).toEqual([]);
    expect(h.prefetch).toEqual([]);
    // Nierozgrzana powłoka po wyczerpanym terminie to `failed`, nie krótka
    // świeżość wspólna - dokumentu nikt już nie dogrzeje.
    expect(h.cacheControl.at(-1)).toBe("private, no-store");
  });

  it("ANULOWANE menu jest usuwane TAKŻE po serwerowym domknięciu fali chrome", async () => {
    // Wariant serwerowy tej samej reguły co niżej: korzeń AWAITUJE falę chrome,
    // więc strażnik ogląda stan PO anulowaniu, a nie przed jego powstaniem.
    // Zapytanie `pending` + `idle` + bez danych w dehydratowanym payloadzie
    // zawiesza klienta na strumieniu, który już nie wróci.
    h.server = true;
    h.menusHang = true;
    h.cancelMenus = true;
    h.settings = { header: { builder_data: { sections: [{ id: "s" }] } } };
    try {
      await runLoader(qc, "/blog");

      expect(qc.getQueryState(["menu-with-items", "main"])).toBeUndefined();
      expect(qc.getQueryState(["menu-with-items", "footer"])).toBeUndefined();
    } finally {
      h.menusHang = false;
      h.cancelMenus = false;
      await qc.cancelQueries();
    }
  });

  it("awaria ustawień NIE wywraca loadera - dekoracja nie może zabrać serwisu", async () => {
    h.settingsFails = true;
    await expect(runLoader(qc)).resolves.toEqual({
      ga4: { measurementId: GA4_MEASUREMENT_ID, enabled: true },
    });
    h.settingsFails = false;
  });
});

describe("__root head()", () => {
  it("niesie viewport, meta marki i reguły spekulacji", async () => {
    const head = Route.options.head as unknown as () => {
      meta: Record<string, unknown>[];
      links: Record<string, unknown>[];
      scripts: { type?: string; children?: string; src?: string; async?: boolean }[];
    };
    const r = head();
    expect(r.meta[0]).toEqual({
      name: "viewport",
      content:
        "width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content",
    });
    expect(r.meta.length).toBeGreaterThan(1);
    expect(r.links.some((l) => l.rel === "stylesheet")).toBe(true);
    // Tag Google w SSR: zgoda domyślna PRZED konfiguracją strumienia; reguły
    // spekulacji zamykają listę.
    const snippet = r.scripts[0]?.children ?? "";
    expect(snippet).toContain("gtag('consent','default'");
    expect(snippet).toContain(`gtag('config',"${GA4_MEASUREMENT_ID}",{send_page_view:false})`);
    expect(snippet.indexOf("gtag('consent','default'")).toBeLessThan(
      snippet.indexOf("gtag('config'"),
    );
    // ŻADNEGO `<script src>` DO OBCEGO ORIGINU W `<head>` (audyt CWV, F20).
    // gtag.js był jedynym takim zasobem, bez `preconnect`, ~90 KB parse+execute
    // w oknie hydratacji - dociąga go teraz `ConsentScriptInjector` po
    // bezczynności. Asercja jest na CAŁEJ liście, nie na jednym indeksie:
    // przywrócenie tagu gdziekolwiek w `scripts` ma zapalić ten test.
    expect(r.scripts.some((script) => typeof script.src === "string")).toBe(false);
    expect(r.scripts.at(-1)?.type).toBe("speculationrules");
  });
});

describe("__root wiring", () => {
  it("ma powłokę, komponent, 404 i ekran błędu", () => {
    // `shellComponent` nie jest w publicznym typie `RouteOptions` korzenia
    // (framework czyta je z opcji dynamicznie), więc czytamy przez zawężenie -
    // NIE przez `any`, którego ten repozytorium zakazuje.
    const opts = Route.options as unknown as Record<string, unknown>;
    expect(typeof opts["shellComponent"]).toBe("function");
    expect(typeof Route.options.component).toBe("function");
    expect(typeof Route.options.notFoundComponent).toBe("function");
    expect(typeof Route.options.errorComponent).toBe("function");
  });
});

// JĘZYK RENDERU IDZIE ZA ADRESEM PRZY KAŻDEJ NAWIGACJI. Synchronizacja stała
// w loaderze, a loader korzenia przy nawigacji klienta nie biegnie ponownie
// (dopasowanie korzenia „zostaje") - po „wstecz" z /en/x na /y strona
// o polskim adresie kanonicznym renderowała się po angielsku. Zachowanie na
// prawdziwym routerze: `lib/i18n/__tests__/urlLanguageNavigation.test.tsx`.
describe("__root beforeLoad", () => {
  type BeforeLoad = (a: { location: { publicHref: string } }) => Promise<unknown>;
  const runBeforeLoad = (publicHref: string) =>
    (Route.options.beforeLoad as unknown as BeforeLoad)({ location: { publicHref } });

  it("synchronizuje i18n z adresem ŁADOWANEJ lokalizacji - publicHref, z prefiksem języka", async () => {
    // `location.pathname` jest już bez prefiksu (rewrite `input` routera) -
    // język niesie wyłącznie `publicHref`.
    await runBeforeLoad("/en/o-nas?x=1#h");
    expect(h.i18nSyncHrefs).toEqual(["/en/o-nas?x=1#h"]);
  });

  it("awaria synchronizacji i18n NIE wywraca nawigacji", async () => {
    // `syncI18nToRequest` sięga po słowniki; jego awaria (zimny izolat, brak
    // chunku) zostawia render na dotychczasowym języku - ale zostawia RENDER.
    h.i18nSyncFails = true;
    await expect(runBeforeLoad("/o-nas")).resolves.toBeUndefined();
    expect(h.i18nSyncCalls).toBe(1);
  });
});

describe("root chrome gate uses real query freshness", () => {
  it("pending chrome before the shell flushes = KRÓTKA świeżość wspólna, nie no-store (F02)", async () => {
    // Do 2026-09-20 stało tu `private, no-store`: każdy dokument, którego menu
    // dostrumieniowało się po flushu shella, był niecache'owalny, więc zimny
    // izolat nigdy nie zasiewał L1/L2. Rozgrzewka biegnie, dokument będzie
    // kompletny - wolno go współdzielić przez `CHROME_DEGRADED_S_MAXAGE`.
    // `no-store` zostaje dla `failed` (test niżej: wyczerpany termin).
    h.menusHang = true;
    try {
      await runLoader(qc, "/cookies");
      let suspended: unknown;
      try {
        readChromeWarmup(qc);
      } catch (value) {
        suspended = value;
      }
      expect(suspended).toBeInstanceOf(Promise);
      expect(h.cacheControl.at(-1)).toBe(chromeDegradedCacheControl());
      await suspended;
      expect(() => readChromeWarmup(qc)).not.toThrow();
    } finally {
      h.menusHang = false;
      qc.clear();
    }
  });
  it("does not delay a home shell after the shared deadline expires", async () => {
    h.server = true;
    h.menusHang = true;
    try {
      await runLoader(qc);
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
      try {
        expect(() => readChromeWarmup(qc)).not.toThrow();
        expect(h.cacheControl.at(-1)).toBe("private, no-store");
      } finally {
        clock.mockRestore();
      }
    } finally {
      h.menusHang = false;
      qc.clear();
    }
  });
  it("registers configured header and footer widget queries for freshness checking", async () => {
    const doc = {
      version: 1,
      sections: [
        {
          id: "s",
          kind: "section",
          children: [
            {
              id: "c",
              kind: "column",
              children: [{ id: "w", kind: "widget", type: "menu", content: { menu_key: "main" } }],
            },
          ],
        },
      ],
    };
    h.settings = { header: { builder_data: doc }, footer: { builder_data: doc } };
    await runLoader(qc);
    await vi.dynamicImportSettled();
    expect(() => readChromeWarmup(qc)).not.toThrow();
    expect(qc.getQueryData(["menu-with-items", "main"])).toEqual([]);
    expect(h.prefetch).toHaveLength(2);
  });

  // ── SYGNAŁ „BRAK AKTYWNYCH POPUPÓW" (P3.8 #4a) ───────────────────────────
  it("SSR z chrome'em grzeje sygnał „brak aktywnych popupów” w fali chrome", async () => {
    h.server = true;
    await runLoader(qc, "/blog");
    expect(h.popupWarms).toBe(1);
    expect(qc.getQueryData(["builder-popups-active"])).toEqual([]);
  });

  it("nawigacja klienta NIE grzeje sygnału popupów - bramka czyta go tylko z SSR", async () => {
    h.server = false;
    await runLoader(qc, "/blog");
    await vi.dynamicImportSettled();
    expect(h.popupWarms).toBe(0);
  });

  it("dokument bez chrome'u NIE grzeje sygnału popupów (host montuje się jak dotąd)", async () => {
    h.server = true;
    h.chrome = false;
    await runLoader(qc, "/blog");
    await vi.dynamicImportSettled();
    expect(h.popupWarms).toBe(0);
    expect(qc.getQueryData(["builder-popups-active"])).toBeUndefined();
  });
});

describe("__root loader -> tag Google w SSR", () => {
  type HeadWithData = (ctx: { loaderData: unknown }) => {
    scripts: { type?: string; children?: string; src?: string }[];
  };
  const headWithData = () => Route.options.head as unknown as HeadWithData;

  it("strumień GA4 z panelu analityki trafia do loaderData, a head() emituje go w snippecie", async () => {
    h.settings = { analytics: { ga4_measurement_id: "G-PANEL00001" } };

    const data = await runLoader(qc);

    expect(data).toEqual({ ga4: { measurementId: "G-PANEL00001", enabled: true } });
    const r = headWithData()({ loaderData: data });
    expect(r.scripts[0]?.children).toContain(
      `gtag('config',"G-PANEL00001",{send_page_view:false})`,
    );
    // Pieczątka dla bootstrapu klienckiego zastępuje nieobecny `<script src>`:
    // to po niej `ssrGtagId()` wie, że strumień jest już skonfigurowany, i nie
    // wypycha drugiego kompletu poleceń.
    expect(r.scripts[0]?.children).toContain(`window.__nesGa4SsrTag="G-PANEL00001"`);
    expect(r.scripts.some((script) => script.src?.includes("googletagmanager"))).toBe(false);
  });

  it("loaderData BEZ strumienia GA4 spada na stałą wdrożenia, a nie na pusty tag", () => {
    // `head()` bywa wołane bez loaderData korzenia (render błędu, 404), a jego
    // pole `ga4` może być `null` po zdegradowanym loaderze. Obie ścieżki mają
    // dać TEN SAM, ważny strumień - tag bez identyfikatora konfigurowałby
    // `gtag` na pustce i gasił pomiar całego serwisu po cichu.
    const bezStrumienia = headWithData()({ loaderData: { ga4: null } });
    expect(bezStrumienia.scripts[0]?.children).toContain(`gtag('config',"${GA4_MEASUREMENT_ID}"`);
  });

  it("strumień o złym KSZTAŁCIE w loaderData jest odrzucany razem z `enabled`", () => {
    // Kontrakt jest na PARĘ pól: sam identyfikator bez `enabled` (albo
    // identyfikator, który nie jest napisem) to ładunek spoza tego loadera -
    // wpuszczenie go znaczyłoby, że dowolny kształt `loaderData` steruje
    // tagiem Google w publicznym HTML-u.
    const zlyKsztalt = headWithData()({ loaderData: { ga4: { measurementId: 7, enabled: true } } });
    expect(zlyKsztalt.scripts[0]?.children).toContain(`gtag('config',"${GA4_MEASUREMENT_ID}"`);

    const bezFlagi = headWithData()({ loaderData: { ga4: { measurementId: "G-PANEL00001" } } });
    expect(bezFlagi.scripts[0]?.children).toContain(`gtag('config',"${GA4_MEASUREMENT_ID}"`);
  });

  it("wpis o złym kształcie (np. klucz API) nie trafia do HTML - zostaje stała wdrożenia", async () => {
    h.settings = { analytics: { ga4_measurement_id: "AIzaSyFakeKey" } };

    await expect(runLoader(qc)).resolves.toEqual({
      ga4: { measurementId: GA4_MEASUREMENT_ID, enabled: true },
    });
  });

  it("Odłącz GA4 w panelu (ga4_enabled: false) wyłącza tag Google w SSR", async () => {
    h.settings = { analytics: { ga4_measurement_id: "G-PANEL00001", ga4_enabled: false } };

    const data = await runLoader(qc);

    expect(data).toEqual({ ga4: { measurementId: "", enabled: false } });
    const r = headWithData()({ loaderData: data });
    expect(r.scripts.some((s) => s.src?.includes("googletagmanager"))).toBe(false);
    expect(r.scripts.some((s) => s.children?.includes("gtag("))).toBe(false);
    expect(r.scripts.at(-1)?.type).toBe("speculationrules");
  });
});

// ── POWŁOKA I BANER ZGÓD (P1.3) ─────────────────────────────────────────────
//
// CO TO DOWODZI:
//  1. `CONSENT_INIT_SCRIPT` stoi w `<head>` ZARAZ PO `THEME_INIT_SCRIPT`, przed
//     `<body>` - decyzja jest rozstrzygnięta przed pierwszym malowaniem.
//  2. HYDRATACJA GNIAZDA: przeglądarka bez kodu powłoki zostawia HTML serwera
//     nietknięty (bez błędu hydratacji, te same węzły po re-renderze rodzica);
//     kontrola negatywna - gniazdo bez migawki traci powłokę.
//  3. MOMENT MONTAŻU BANERA: nie przed interakcją; po `pointerdown` czeka do
//     `click` (strażnik gestu P0.3), potem podmienia powłokę w jednym commicie;
//     intencja „Dostosuj” i `requestConsentPreferences()` - od razu (tor
//     pilny); fokus z kontrolki powłoki przechodzi do banera.
//  4. DECYZJA Z POWŁOKI PO BOOCIE idzie drogą banera (`applyShellDecision`),
//     bez znacznika „do domknięcia".
//  5. KOORDYNATOR NAKŁADEK zna stan powłoki od hydratacji: widoczna powłoka =
//     brama zamknięta; decyzja w powłoce ją otwiera.
//  6. `PopupHost` bez montażu wyłącznie przy odwodnionej PUSTEJ liście popupów.
//  7. CACHE-BUSTING (`armCacheBusting`): moduł NIE jest importowany przed punktem
//     ciszy; chunk-load error sprzed ciszy ściąga go od razu i oddaje mu błąd,
//     każdy inny błąd - nic (filtr = `looksLikeChunkLoadError`); sprzątanie
//     zdejmuje nasłuchy i zapis ciszy.
//  8. Powłoka UKRYTA bez decyzji (GPC) i powłoka z ZASIEWU ustawień: baner
//     montuje się bez czekania na interakcję.
//  9. ODSŁONIĘCIE (P1.3b): skrypt odsłonięcia to OSTATNIE dziecko gniazda
//     serwera (za kartą, także przy wyłączonym banerze) i ustawia
//     `html[data-consent-parsed]`; gniazdo, w którym się nie wykonał, daje
//     baner bez czekania na interakcję.
describe("__root - powłoka i baner zgód (P1.3)", () => {
  const consentMods = async () => ({
    init: await import("@/lib/consent/consentInitScript"),
    consent: await import("@/lib/ads/consent"),
    queue: await import("@/lib/performance/postInteractionQueue"),
    first: await import("@/lib/performance/firstInteraction"),
    quiet: await import("@/lib/performance/whenQuiescent"),
    coordinator: await import("@/lib/overlayCoordinator"),
    rtl: await import("@testing-library/react"),
  });

  const scriptClicks: EventListener[] = [];

  /** Uruchamia skrypt inline jak przeglądarka w `<head>` (nasłuch `click` na dokumencie). */
  async function runInitScript(): Promise<void> {
    const { init } = await consentMods();
    const realAdd = document.addEventListener.bind(document);
    const spy = vi.spyOn(document, "addEventListener").mockImplementation(((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === "click" && typeof listener === "function") scriptClicks.push(listener);
      realAdd(type, listener, options);
    }) as typeof document.addEventListener);
    try {
      new Function(init.CONSENT_INIT_SCRIPT)();
    } finally {
      spy.mockRestore();
    }
  }

  async function resetConsentWorld(): Promise<void> {
    const { queue, first, quiet, coordinator, rtl } = await consentMods();
    rtl.cleanup();
    for (const listener of scriptClicks.splice(0)) document.removeEventListener("click", listener);
    queue.__resetPostInteractionQueueForTests();
    first.__resetFirstInteractionForTests();
    quiet.__resetQuiescenceForTests();
    coordinator.__resetOverlayCoordinator();
    document.documentElement.removeAttribute("data-consent-decided");
    document.documentElement.removeAttribute("data-consent-intent");
    document.documentElement.removeAttribute("data-consent-js");
    document.documentElement.removeAttribute("data-consent-gpc");
    document.documentElement.removeAttribute("data-consent-parsed");
    Reflect.deleteProperty(navigator, "globalPrivacyControl");
    document.body.innerHTML = "";
    window.localStorage.clear();
    // Ciasteczko decyzji przeżywa `localStorage.clear()` - a `readLocal` z niego
    // odtwarza decyzję. Bez tego test „przed decyzją" widziałby decyzję
    // poprzedniego przypadku.
    document.cookie = "nes_cookie_consent=; path=/; max-age=0";
    h.bannerMounts = [];
  }

  /**
   * Render korzenia zgód. `parse: true` (domyślnie) odtwarza parser: wykonuje
   * skrypt odsłonięcia z gniazda (React klienta wstawia `<script>` bez
   * wykonania), zanim partner skryptu wystartuje - jak w przeglądarce, gdzie
   * gniazdo stoi w HTML-u przed modułem bootu.
   */
  async function mountSurface(
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    { parse = true }: { parse?: boolean } = {},
  ) {
    const { rtl } = await consentMods();
    const { QueryClientProvider } = await import("@tanstack/react-query");
    const view = rtl.render(
      <QueryClientProvider client={client}>
        <ConsentSurface />
      </QueryClientProvider>,
    );
    const reveal = document.querySelector("[data-consent-shell-slot] > script");
    if (parse && reveal?.textContent) new Function(reveal.textContent)();
    // Efekt korzenia dociąga prymitywy P0.3 i koordynator `import()`.
    await rtl.act(async () => {
      await vi.dynamicImportSettled();
    });
    return view;
  }

  const shellButton = (action: string) =>
    document.querySelector<HTMLElement>(`[data-consent-shell] [data-consent-action="${action}"]`);
  const banner = () => document.querySelector('[data-testid="consent-banner-stub"]');

  beforeEach(async () => {
    await resetConsentWorld();
  });
  afterEach(async () => {
    await resetConsentWorld();
  });

  it("`CONSENT_INIT_SCRIPT` stoi w `<head>` zaraz po `THEME_INIT_SCRIPT` (render powłoki dokumentu)", async () => {
    const { init } = await consentMods();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { THEME_INIT_SCRIPT } = await import("@/lib/theme/themeInitScript");
    const { DOCK_RESERVE_INIT_SCRIPT } = await import("@/lib/dock/reservedSpace");
    // `shellComponent` nie jest w publicznym typie `RouteOptions` (framework
    // czyta je dynamicznie) - wzorzec `rootShellRender.test.tsx`.
    const opts = Route.options as unknown as Record<string, unknown>;
    const Shell = opts["shellComponent"] as (p: {
      children: React.ReactNode;
    }) => React.ReactElement;
    const html = renderToStaticMarkup(<Shell>{null}</Shell>);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const scripts = [...doc.head.querySelectorAll("script")];
    const theme = scripts.findIndex((el) => el.textContent === THEME_INIT_SCRIPT);
    expect(theme).toBeGreaterThanOrEqual(0);
    const consent = scripts[theme + 1];
    expect(consent?.hasAttribute("data-consent-init")).toBe(true);
    expect(consent?.textContent).toBe(init.CONSENT_INIT_SCRIPT);
    expect(scripts[theme + 2]?.textContent).toBe(DOCK_RESERVE_INIT_SCRIPT);
    // W `<head>`, nie w `<body>`: decyzja rozstrzygnięta przed parsowaniem powłoki.
    expect(doc.body.querySelector("script[data-consent-init]")).toBeNull();
  });

  it("hydratacja gniazda: HTML serwera zostaje, bez błędu, te same węzły po re-renderze", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { act, useState } = await import("react");
    const Server = () => (
      <div role="dialog" aria-label="Powłoka" data-consent-shell="">
        <button type="button" data-consent-action="accept">
          Akceptuj
        </button>
      </div>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <>
        <span>0</span>
        <ConsentShellSlot server={Server} />
      </>,
    );
    document.body.append(container);
    const before = container.querySelector("[data-consent-shell]");
    expect(before).not.toBeNull();

    let bump: (n: number) => void = () => {};
    function ClientTree() {
      const [n, setN] = useState(0);
      bump = setN;
      return (
        <>
          <span>{n}</span>
          <ConsentShellSlot server={null} />
        </>
      );
    }
    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, <ClientTree />, { onRecoverableError: (e) => errors.push(e) });
    });
    await act(async () => bump(1));
    expect(errors).toEqual([]);
    expect(container.querySelector("span")?.textContent).toBe("1");
    // TEN SAM węzeł - React nie przepisał `innerHTML` gniazda.
    expect(container.querySelector("[data-consent-shell]")).toBe(before);
  });

  it("gniazdo serwera: skrypt odsłonięcia stoi ZA kartą (ostatnie dziecko) i ustawia `data-consent-parsed`", async () => {
    const { init } = await consentMods();
    const { renderToStaticMarkup } = await import("react-dom/server");
    const Server = () => <div data-consent-shell="">powłoka</div>;
    const doc = new DOMParser().parseFromString(
      renderToStaticMarkup(<ConsentShellSlot server={Server} />),
      "text/html",
    );
    const slot = doc.querySelector("[data-consent-shell-slot]");
    const children = [...(slot?.children ?? [])];
    expect(children.map((el) => el.tagName)).toEqual(["DIV", "SCRIPT"]);
    expect(children[0].hasAttribute("data-consent-shell")).toBe(true);
    expect(children[1].textContent).toBe(init.CONSENT_SHELL_REVEAL_SCRIPT);
    expect(document.documentElement.hasAttribute("data-consent-parsed")).toBe(false);
    new Function(children[1].textContent ?? "")();
    expect(document.documentElement.hasAttribute("data-consent-parsed")).toBe(true);

    // Baner wyłączony (powłoka = `null`): skrypt zostaje - „parser minął gniazdo".
    const empty = new DOMParser().parseFromString(
      renderToStaticMarkup(<ConsentShellSlot server={() => null} />),
      "text/html",
    );
    const emptySlot = empty.querySelector("[data-consent-shell-slot]");
    expect([...(emptySlot?.children ?? [])].map((el) => el.tagName)).toEqual(["SCRIPT"]);
  });

  it("kontrola negatywna: gniazdo klienta bez migawki traci powłokę przy hydratacji", async () => {
    const { renderToString } = await import("react-dom/server");
    const { hydrateRoot } = await import("react-dom/client");
    const { act } = await import("react");
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <div data-consent-shell-slot="" className="contents">
        <div data-consent-shell="">powłoka</div>
      </div>,
    );
    document.body.append(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => {
      hydrateRoot(container, <div data-consent-shell-slot="" className="contents" />, {
        onRecoverableError: (e) => errors.push(e),
      });
    });
    consoleError.mockRestore();
    expect(container.querySelector("[data-consent-shell]")).toBeNull();
  });

  it("baner NIE montuje się bez interakcji; po `pointerdown` czeka na `click`, potem zastępuje powłokę", async () => {
    const { rtl } = await consentMods();
    await runInitScript();
    await mountSurface();
    expect(shellButton("accept")).not.toBeNull();
    expect(banner()).toBeNull();

    rtl.fireEvent.pointerDown(document.body);
    await rtl.act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    // Strażnik gestu: w trakcie dotknięcia powłoka zostaje (klik nie zgubi celu).
    expect(banner()).toBeNull();
    expect(shellButton("accept")).not.toBeNull();

    rtl.fireEvent.pointerUp(document.body);
    rtl.fireEvent.click(document.body);
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    // Jeden commit: powłoki już nie ma, baner jest.
    expect(document.querySelector("[data-consent-shell]")).toBeNull();
    expect(h.bannerMounts.at(-1)).toEqual({ intent: null, focus: null });
  });

  it("„Dostosuj” w powłoce montuje baner OD RAZU (tor pilny) i przekazuje intencję", async () => {
    const { rtl } = await consentMods();
    await runInitScript();
    await mountSurface();
    const customize = shellButton("customize");
    customize?.focus();
    rtl.fireEvent.click(customize as HTMLElement);
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    expect(h.bannerMounts.at(-1)).toEqual({ intent: "customize", focus: "customize" });
    expect(document.documentElement.hasAttribute("data-consent-intent")).toBe(false);
    // Intencja to nie decyzja.
    expect(window.localStorage.getItem("consent:v2")).toBeNull();
  });

  it("intencja kliknięta PRZED bootem (atrybut na `<html>`) montuje baner przy starcie", async () => {
    const { rtl } = await consentMods();
    document.documentElement.setAttribute("data-consent-intent", "lang-en");
    await mountSurface();
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    expect(h.bannerMounts.at(-1)).toEqual({ intent: "lang-en", focus: null });
  });

  it("`requestConsentPreferences()` (link w stopce) montuje baner od razu; fokus z powłoki idzie za nim", async () => {
    const { rtl, consent } = await consentMods();
    await runInitScript();
    await mountSurface();
    shellButton("reject")?.focus();
    rtl.act(() => consent.requestConsentPreferences());
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    expect(h.bannerMounts.at(-1)).toEqual({ intent: null, focus: "reject" });
  });

  it("decyzja w powłoce PO boocie idzie drogą banera: rekord, brak znacznika, powłoka ukryta", async () => {
    const { rtl, consent } = await consentMods();
    await runInitScript();
    await mountSurface();
    rtl.fireEvent.click(shellButton("reject") as HTMLElement);
    const stored = JSON.parse(window.localStorage.getItem("consent:v2") ?? "null") as {
      categories: Record<string, boolean>;
      source: string;
    } | null;
    expect(stored?.categories).toEqual({
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
    });
    expect(stored?.source).toBe("local");
    expect(window.localStorage.getItem(consent.SHELL_PENDING_KEY)).toBeNull();
    expect(document.documentElement.hasAttribute("data-consent-decided")).toBe(true);
  });

  it("koordynator nakładek: widoczna powłoka zamyka bramę od hydratacji, decyzja w powłoce ją otwiera", async () => {
    const { rtl, coordinator } = await consentMods();
    await runInitScript();
    await mountSurface();
    const granted = vi.fn();
    void coordinator.requestOverlaySlot("dialog", { marketing: false }).then(granted);
    await rtl.act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(granted).not.toHaveBeenCalled();
    rtl.fireEvent.click(shellButton("accept") as HTMLElement);
    await rtl.waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
  });

  it("decyzja zapisana przed wejściem: brama nakładek otwarta od hydratacji, bez montażu banera", async () => {
    const { rtl, coordinator } = await consentMods();
    window.localStorage.setItem(
      "consent:v2",
      JSON.stringify({
        version: 2,
        ts: 1,
        categories: { necessary: true, functional: true, analytics: true, marketing: true },
      }),
    );
    await mountSurface();
    const granted = vi.fn();
    void coordinator.requestOverlaySlot("popup", { marketing: true }).then(granted);
    await rtl.waitFor(() => expect(granted).toHaveBeenCalledTimes(1));
    expect(banner()).toBeNull();
    expect(document.documentElement.hasAttribute("data-consent-decided")).toBe(true);
  });

  it("`PopupHost` bez montażu WYŁĄCZNIE przy odwodnionej pustej liście aktywnych popupów", async () => {
    const { rtl } = await consentMods();
    const { QueryClientProvider } = await import("@tanstack/react-query");
    const probe = (client: QueryClient) =>
      rtl.renderHook(() => useNoActivePopupsFromSsr(), {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }).result.current;
    const none = new QueryClient();
    expect(probe(none)).toBe(false);
    const empty = new QueryClient();
    empty.setQueryData(["builder-popups-active"], []);
    expect(probe(empty)).toBe(true);
    const some = new QueryClient();
    some.setQueryData(["builder-popups-active"], [{ id: "p1" }]);
    expect(probe(some)).toBe(false);
    // Zespół redakcji montuje host zawsze (P3.8): popup aktywowany w panelu da
    // się obejrzeć od razu, mimo zamrożonego sygnału z dokumentu.
    h.staff = true;
    const staff = new QueryClient();
    staff.setQueryData(["builder-popups-active"], []);
    expect(probe(staff)).toBe(false);
  });

  it("siatka cache-bustingu: chunk-load error sprzed ciszy przeładowuje raz, inny błąd - nic", async () => {
    const { handleChunkLoadFailure } = await import("@/lib/cacheBusting");
    const replace = vi.fn();
    const location = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { href: "https://neweuropeanstrategies.com/a", replace },
    });
    try {
      window.sessionStorage.clear();
      handleChunkLoadFailure(new Error("Something else"));
      expect(replace).not.toHaveBeenCalled();
      handleChunkLoadFailure(new TypeError("Failed to fetch dynamically imported module: /x.js"));
      expect(replace).toHaveBeenCalledTimes(1);
      handleChunkLoadFailure("ChunkLoadError: Loading chunk 7 failed");
      expect(replace).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: location });
      window.sessionStorage.clear();
    }
  });

  it("skrypt odsłonięcia się nie wykonał (powłoka ukryta): baner po boocie BEZ interakcji", async () => {
    const { rtl } = await consentMods();
    await runInitScript();
    await mountSurface(undefined, { parse: false });
    expect(document.documentElement.hasAttribute("data-consent-parsed")).toBe(false);
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    expect(h.bannerMounts.at(-1)).toEqual({ intent: null, focus: null });
  });

  it("GPC: powłoka ukryta, baner (z notą) montuje się po boocie BEZ interakcji", async () => {
    const { rtl } = await consentMods();
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    await runInitScript();
    expect(document.documentElement.hasAttribute("data-consent-gpc")).toBe(true);
    await mountSurface();
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
    expect(window.localStorage.getItem("consent:v2")).toBeNull();
  });

  it("powłoka z ZASIEWU ustawień: gdy dojadą prawdziwe, baner przejmuje kartę od razu", async () => {
    const { rtl } = await consentMods();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["site-settings"], {}, { updatedAt: 0 });
    await runInitScript();
    await mountSurface(client);
    await rtl.act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(banner()).toBeNull();
    rtl.act(() => {
      client.setQueryData(["site-settings"], { privacy: { cookie_banner: false } });
    });
    await rtl.waitFor(() => expect(banner()).not.toBeNull());
  });
});

// ── CACHE-BUSTING W PUNKCIE CISZY (P1.3, TP-4) ──────────────────────────────
//
// `armCacheBusting` z atrapami OBU modułów (wstrzyknięte, bez `vi.mock` -
// reszta pliku używa prawdziwego punktu ciszy): rewersja do `whenIdle(…, 3000)`
// albo import bez filtra błędów wywraca te testy.
describe("__root - armCacheBusting (P1.3, TP-4)", () => {
  function harness() {
    const calls = { load: 0, start: 0, failures: [] as unknown[], stops: 0 };
    const quiet = {
      consumer: null as null | (() => unknown),
      priority: "",
      cancelled: false,
    };
    const module = {
      startCacheBusting: () => {
        calls.start += 1;
        return () => {
          calls.stops += 1;
        };
      },
      handleChunkLoadFailure: (reason: unknown) => {
        calls.failures.push(reason);
      },
    };
    const load = async () => {
      calls.load += 1;
      return module;
    };
    const loadQuiet = async () => ({
      onQuiescent: (task: () => unknown, options: { priority: string }) => {
        quiet.consumer = task;
        quiet.priority = options.priority;
        return () => {
          quiet.cancelled = true;
        };
      },
    });
    const background = createBackgroundScope();
    const router = { invalidate: () => undefined };
    const disarm = armCacheBusting(background, router, load, loadQuiet);
    const settle = () => new Promise((r) => setTimeout(r, 0));
    return { calls, quiet, background, disarm, settle };
  }

  const chunkError = () => new TypeError("Failed to fetch dynamically imported module: /a.js");

  it("bez błędu moduł NIE jest importowany przed punktem ciszy; konsument ciszy (klasa `overlays`) go importuje", async () => {
    const t = harness();
    await t.settle();
    expect(t.calls.load).toBe(0);
    expect(t.quiet.priority).toBe("overlays");
    await t.quiet.consumer?.();
    await t.settle();
    expect(t.calls.load).toBe(1);
    expect(t.calls.start).toBe(1);
    t.disarm();
    t.background.dispose();
    expect(t.calls.stops).toBe(1);
  });

  it("chunk-load error PRZED ciszą: import od razu i błąd trafia do `handleChunkLoadFailure`", async () => {
    const t = harness();
    await t.settle();
    const error = chunkError();
    window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
    await t.settle();
    await t.settle();
    expect(t.calls.load).toBe(1);
    expect(t.calls.failures).toEqual([error]);
    // Po starcie moduł ma własny nasłuch - wczesny jest zdjęty.
    window.dispatchEvent(new ErrorEvent("error", { error: chunkError() }));
    await t.settle();
    expect(t.calls.failures).toHaveLength(1);
    // Cisza po starcie nie importuje drugi raz.
    await t.quiet.consumer?.();
    expect(t.calls.load).toBe(1);
    t.disarm();
    t.background.dispose();
  });

  it("odrzucona obietnica z chunk-load error też ściąga moduł", async () => {
    const t = harness();
    await t.settle();
    const reason = new Error("error loading dynamically imported module");
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", { value: reason });
    window.dispatchEvent(event);
    await t.settle();
    await t.settle();
    expect(t.calls.load).toBe(1);
    expect(t.calls.failures).toEqual([reason]);
    t.disarm();
    t.background.dispose();
  });

  it("filtr wczesnych błędów = `looksLikeChunkLoadError` dla błędów przeglądarek i Vite (`Error`, napis)", async () => {
    const { looksLikeChunkLoadError } = await import("@/lib/cacheBusting");
    const corpus: Array<[string, unknown]> = [
      [
        "ResizeObserver",
        new Error("ResizeObserver loop completed with undelivered notifications."),
      ],
      ["fetch", new TypeError("Failed to fetch")],
      ["skrypt obcy", "Script error."],
      ["ChunkLoadError", new Error("ChunkLoadError: Loading chunk 12 failed.")],
      ["Loading chunk (napis)", "Loading chunk vendor-react failed"],
      ["Chrome", new TypeError("Failed to fetch dynamically imported module: https://x/a.js")],
      ["Safari", new TypeError("Importing a module script failed.")],
      ["Firefox", new Error("error loading dynamically imported module: /b.js")],
      ["null", null],
      ["pusty napis", ""],
    ];
    for (const [label, reason] of corpus) {
      const t = harness();
      await t.settle();
      window.dispatchEvent(new ErrorEvent("error", { error: reason }));
      await t.settle();
      await t.settle();
      expect(t.calls.load > 0, label).toBe(looksLikeChunkLoadError(reason));
      t.disarm();
      t.background.dispose();
    }
  });

  it("obiekt spoza `Error` nie ściąga modułu przed ciszą (świadomy brak - błędy chunków to zawsze `Error`)", async () => {
    const t = harness();
    await t.settle();
    window.dispatchEvent(new ErrorEvent("error", { error: { message: "Loading chunk 3 failed" } }));
    await t.settle();
    expect(t.calls.load).toBe(0);
    t.disarm();
    t.background.dispose();
  });

  it("sprzątanie zdejmuje nasłuch wczesnych błędów i zapis w punkcie ciszy", async () => {
    const t = harness();
    await t.settle();
    t.disarm();
    expect(t.quiet.cancelled).toBe(true);
    window.dispatchEvent(new ErrorEvent("error", { error: chunkError() }));
    await t.settle();
    expect(t.calls.load).toBe(0);
    t.background.dispose();
  });

  it("sprzątanie PRZED dociągnięciem prymitywu ciszy nie zostawia zapisu", async () => {
    const t = harness();
    t.disarm();
    await t.settle();
    expect(t.quiet.consumer).toBeNull();
    t.background.dispose();
  });
});

// LOADER BOOTU W `<head>` (P2.1). Manifest TanStack Start nie startuje już JS-a, więc dokument
// bez tego węzła nie ożyje nigdy (statyczny SSR, klasa incydentu 2026-07-20). Render powłoki
// dokumentu w teście biegnie gałęzią SERWEROWĄ `createIsomorphicFn` (stała z modułu loadera),
// a gałąź przeglądarki przepisuje tekst z węzła o tym samym atrybucie - stąd parytet nazwy.
describe("RootShell - loader bootu (P2.1)", () => {
  it("stoi w `<head>` ZARAZ PO sondzie bootu, z atrybutem i stałą z modułu loadera", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { BOOT_PROBE_SCRIPT } = await import("@/lib/observability/bootProbeScript");
    const { BOOT_LOADER_ATTR, BOOT_LOADER_SCRIPT } = await import("@/lib/boot/bootLoaderScript");
    const opts = Route.options as unknown as Record<string, unknown>;
    const Shell = opts["shellComponent"] as (p: {
      children: React.ReactNode;
    }) => React.ReactElement;
    const html = renderToStaticMarkup(<Shell>{null}</Shell>);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const scripts = [...doc.head.querySelectorAll("script")];
    const probe = scripts.findIndex((el) => el.textContent === BOOT_PROBE_SCRIPT);
    expect(probe).toBeGreaterThanOrEqual(0);
    // Sonda też jest stałą tylko serwerową: przeglądarka przepisuje tekst z węzła o tym
    // atrybucie (literał poza domknięciem bootu) - węzeł musi go nieść i być jedyny.
    expect(scripts[probe]?.hasAttribute("data-nes-probe")).toBe(true);
    expect(doc.querySelectorAll("script[data-nes-probe]")).toHaveLength(1);
    const loader = scripts[probe + 1];
    expect(loader?.hasAttribute(BOOT_LOADER_ATTR)).toBe(true);
    expect(loader?.textContent).toBe(BOOT_LOADER_SCRIPT);
    expect(doc.querySelectorAll(`script[${BOOT_LOADER_ATTR}]`)).toHaveLength(1);
    // Spike P2.1 wstrzykiwał zestaw i loader w renderze powłoki - rusztowanie usunięte:
    // zestaw wstrzykuje wyłącznie hak dehydratacji routera (`src/router.tsx`).
    expect(doc.getElementById("nes-boot-set")).toBeNull();
  });
});
