// Strona główna `/` ZAMONTOWANA: loader, `head()`, trzy warianty treści,
// warstwa awaryjna i 404.
//
// CO TEN PLIK DOWODZI (nazwane po SKUTKU dla czytelnika i dla danych, nie po
// nazwach funkcji):
//
//  1. CZYTELNIK DOSTAJE TREŚĆ, NIE SZKIELET. Loader dogrzewa cache pod
//     DOKŁADNIE tym kluczem, z którego czyta komponent - rozjazd choćby
//     o rozmiar strony oznacza drugi fetch przy hydracji najczęściej
//     odwiedzanej trasy serwisu.
//  2. PUSTKA I AWARIA TO DWIE RÓŻNE POWIERZCHNIE. Redakcja bez kanwy widzi
//     zdanie „zajrzyj wkrótce” ze statusem 200; blip backendu daje ZDEGRADOWANY
//     render (ta sama powłoka, dane dosypie klient) i - to jest sedno - trasa
//     wtedy REZYGNUJE z cache'u współdzielonego, żeby awaria nie została
//     podana następnemu odwiedzającemu. Trzecia, osobna powierzchnia to błąd
//     RENDERU (`errorComponent`), a czwarta - 404 (`notFoundComponent`).
//  3. ADRES STRONY WYNIKÓW JEST KONTRAKTEM SEO. `?page=2` jest indeksowalne,
//     ale `noindex, follow`; canonical zawsze wskazuje czyste `/`.
//  4. STRONA STATYCZNA Z CMS-U JEST PEŁNOPRAWNYM OBYWATELEM SEO: własny
//     tytuł/opis/canonical/robots bije defaulty marki, a w trybie „najnowsze
//     wpisy" SEO ukrytej strony NIE przecieka do listy.
//  5. ROZGRZEWKA WIDGETÓW JEST INNA NA SERWERZE I NA KLIENCIE. SSR czeka na
//     tylko trzy sekcje nad zgięciem, tak samo jak nawigacja klientowa -
//     pomyłka tutaj to albo migający ekran po hydracji, albo przejście
//     zatrzymane na najwolniejszym zapytaniu spod zgięcia.
//  6. PODPOWIEDŹ LCP JEST BAJTOWO ZGODNA z malowanym obrazem (ten sam srcSet
//     i sizes), inaczej przeglądarka pobiera plik dwa razy.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
//  * CZYSTYCH DECYZJI ATOMÓW - `homeContent`/`homeBuilderSource`/
//    `homeTotalPages`/`homePageSearch` mają tabele przypadków w
//    `src/components/home/atoms/__tests__/homeAtoms.test.ts`, a `HomeSrHeading`
//    (w tym `it.fails` o literale i18n w nagłówku) w
//    `src/components/home/atoms/__tests__/HomeSrHeading.test.tsx`. Tutaj
//    sprawdzamy, że trasa je WOŁA i respektuje wynik.
//  * SIATKI ARCHIWUM I PAGINACJI LINKOWEJ - `PaginatedPostGrid` ma dowód na
//    trasach archiwum (`archiveRoutes.test.tsx`, `archiveRoutesRender.test.tsx`).
//  * BUDOWY NAGŁÓWKA - `buildContentHead`, `resolveSeoText`, `resolveRobotsMeta`,
//    `imagePreloadLink` i JSON-LD mają własne testy w `src/lib/seo/__tests__/`.
//    Tutaj asertujemy WYNIK dla tej trasy, nie reguły tych funkcji.
//  * ZAPYTAŃ PUBLICZNYCH (`homePageQueryOptions`, `blogArchiveQueryOptions`) -
//    to atrapy; ich kontrakt z bazą mają testy `lib/queries` i pgTAP.
//  * SŁOWNIKA AWARYJNEGO `lib/errorCopy.ts` - dwujęzyczny `Record<"pl"|"en">`
//    czytany przez `currentLang()` jest ŚWIADOMYM wyjątkiem od reguły „tekst
//    z klucza" (warstwa awaryjna renderuje się poza dostawcą i18next).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BlogArchiveResult, BlogListItem, HomepageMode, PageData } from "@/lib/queries/public";
import { CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
import { QueryClient } from "@tanstack/react-query";
import { HOME_SSR_BUDGET_MS, homeSsrDeadline } from "@/lib/ssr/homeSsrBudget";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  /** Język interfejsu widziany przez `useTranslation()`. */
  lang: "pl",
  /** Język renderu widziany przez `currentLang()` - czyta go warstwa awaryjna. */
  renderLang: "pl" as "pl" | "en",
  /** Adres żądania widziany przez `head()` (pusty = render bez originu). */
  requestUrl: "https://neweuropeanstrategies.com/",
  /** `true` = renderujemy jako SSR. */
  server: false,
  homePage: null as PageData | null,
  homePageFails: false,
  homePageHangs: false,
  homeMode: "" as HomepageMode,
  homeModeFails: false,
  settings: {} as Record<string, unknown>,
  settingsFails: false,
  archive: null as BlogArchiveResult | null,
  archiveFails: false,
  /** Która rozgrzewka widgetów pobiegła - to jest przedmiot dowodu, nie detal. */
  prefetch: [] as string[],
  /** Nagłówek `Cache-Control`, jaki trasa ustawiła na odpowiedzi SSR. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` dołożone przez trasę. */
  linkHeaders: [] as string[],
  /** Wymuszona awaria RENDERU kanwy - osobna powierzchnia od awarii DANYCH. */
  builderThrows: false,
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("@tanstack/router-core/isServer", () => ({
  get isServer() {
    return h.server;
  },
}));

// Język WARSTWY AWARYJNEJ. `currentLang()` jest funkcją izomorficzną i w środowisku
// testowym rozwiązuje się do gałęzi serwerowej, która bez kontekstu żądania zawsze
// oddaje język domyślny - czyli bez tej podmiany dwujęzyczności `lib/errorCopy.ts`
// nie da się w ogóle wywołać (test „przechodziłby" na PL i nie dowodził niczego).
vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.renderLang,
}));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => h.cacheControl.push(value),
  appendLinkHeader: (value: string) => h.linkHeaders.push(value),
}));

vi.mock("@/lib/queries/public", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/queries/public")>()),
  homePageQueryOptions: () => ({
    queryKey: ["public", "home-page"],
    queryFn: () =>
      h.homePageHangs
        ? new Promise<PageData | null>(() => {})
        : h.homePageFails
          ? Promise.reject(new Error("blip backendu: strona główna"))
          : Promise.resolve(h.homePage),
  }),
  homepageModeQueryOptions: () => ({
    queryKey: ["public", "home-mode"],
    queryFn: () =>
      h.homeModeFails
        ? Promise.reject(new Error("blip backendu: tryb strony głównej"))
        : Promise.resolve(h.homeMode),
  }),
  // Rozmiar strony NIE jest tu podmieniony - `resolvePostsPerPage` liczy się
  // z tej samej mapy ustawień w loaderze i w komponencie, więc klucz zapytania
  // musi wyjść IDENTYCZNY. Podmiana rozmiaru zamaskowałaby rozjazd kluczy.
  blogArchiveQueryOptions: (params: { page?: number; pageSize?: number }) => ({
    queryKey: ["public", "blog", "archive", { page: params.page, pageSize: params.pageSize }],
    queryFn: () =>
      h.archiveFails || h.archive === null
        ? Promise.reject(new Error("blip backendu: archiwum"))
        : Promise.resolve(h.archive),
  }),
}));

vi.mock("@/lib/useSiteSetting", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/useSiteSetting")>()),
  siteSettingsQueryOptions: {
    queryKey: ["site-settings"],
    queryFn: () =>
      h.settingsFails
        ? Promise.reject(new Error("ustawienia serwisu padły"))
        : Promise.resolve(h.settings),
  },
}));

vi.mock("@/lib/builder/prefetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/builder/prefetch")>()),
  prefetchCachedRouteQueries: async () => void h.prefetch.push("wszystkie-sekcje"),
  prefetchAboveFoldQueries: async () => void h.prefetch.push("nad-zgieciem"),
}));

vi.mock("@/components/builder/organisms/BuilderRenderer", () => ({
  BuilderRenderer: ({ lang, stream }: { lang: string; stream?: boolean }) => {
    if (h.builderThrows) throw new Error("kanwa nie umiała się wyrenderować");
    return <div data-testid="kanwa" data-lang={lang} data-stream={stream ? "1" : "0"} />;
  },
}));
vi.mock("@/components/ads/FooterSlideup", () => ({ FooterSlideup: () => null }));
vi.mock("@/components/ads/useInFeedAds", () => ({ useInFeedAds: () => () => null }));
vi.mock("@/components/AdSlot", () => ({ AdZone: () => null, AdSlotView: () => null }));
vi.mock("@/components/NewsletterForm", () => ({ NewsletterForm: () => null }));

const { renderRoute, routeMeta, routeSearchValidator } = await import("@/test/routeHarness");
const { Route: HomeRoute } = await import("@/routes/index");

/** Adres w kształcie storage Supabase - tylko dla takiego powstaje srcSet. */
const COVER = "https://przyklad.supabase.co/storage/v1/object/public/media/okladka.jpg";

function post(id: string, cover: string | null = null): BlogListItem {
  return {
    id,
    slug: id,
    title_pl: `Wpis ${id}`,
    title_en: `Post ${id}`,
    excerpt_pl: null,
    excerpt_en: null,
    cover_image_url: cover,
    published_at: "2026-08-01T10:00:00Z",
    parent_page_id: "page-1",
    href: `/post/${id}`,
    is_sponsored: false,
    sponsored_kind: null,
    sponsored_affiliate: null,
  };
}

/** Dokument kanwy z JEDNYM widgetem tekstowym (opcjonalnie z przypisem). */
function builderDoc(html = "Zdanie o Europie."): unknown {
  return {
    version: 1,
    sections: [
      {
        id: "s1",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            span: { desktop: 12 },
            children: [{ id: "w1", kind: "widget", type: "text", content: { html } }],
          },
        ],
      },
    ],
  };
}

function homePageData(overrides: Partial<PageData> = {}): PageData {
  return {
    id: "page-home",
    slug: "home",
    title_pl: "Strona główna",
    title_en: "Home",
    content_pl: null,
    content_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    editor: "builder",
    builder_data: builderDoc(),
    cover_image_url: null,
    published_at: "2026-01-01T00:00:00Z",
    updated_at: null,
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
    ...overrides,
  };
}

/** Tytuł dokumentu z `head()`. Strażnik, nie rzutowanie: czytamy tylko string. */
function metaTitle(meta: Record<string, unknown>[]): string | undefined {
  for (const entry of meta) if (typeof entry.title === "string") return entry.title;
  return undefined;
}

/** Wartość `content` wpisu `<meta name="...">`. */
function metaByName(meta: Record<string, unknown>[], name: string): string | undefined {
  for (const entry of meta) {
    if (entry.name === name && typeof entry.content === "string") return entry.content;
  }
  return undefined;
}

/** Wartość `content` wpisu `<meta property="...">` (Open Graph). */
function metaByProperty(meta: Record<string, unknown>[], property: string): string | undefined {
  for (const entry of meta) {
    if (entry.property === property && typeof entry.content === "string") return entry.content;
  }
  return undefined;
}

/** `href` wpisu `<link rel="...">`. */
function linkByRel(links: Record<string, unknown>[], rel: string): string | undefined {
  for (const entry of links) {
    if (entry.rel === rel && typeof entry.href === "string") return entry.href;
  }
  return undefined;
}

/** Deskryptor preloadu obrazu z `head()` (albo undefined, gdy go nie ma). */
function imagePreload(links: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return links.find((l) => l.rel === "preload" && l.as === "image");
}

/**
 * `@type` węzła JSON-LD wypisanego przez trasę. STRAŻNIK, nie rzutowanie:
 * `children` skryptu jest `unknown`, więc najpierw sprawdzamy w runtime, że to
 * string, potem że sparsowany JSON jest obiektem - dopiero wtedy czytamy pole.
 */
function jsonLdType(script: Record<string, unknown>): string {
  const children = script.children;
  if (typeof children !== "string") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(children);
  } catch {
    return "";
  }
  if (parsed === null || typeof parsed !== "object" || !("@type" in parsed)) return "";
  const type = parsed["@type"];
  return typeof type === "string" ? type : "";
}

async function mountHome(entry = "/") {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({ route: HomeRoute, path: "/", initialEntry: entry });
  });
  return view;
}

beforeEach(() => {
  h.lang = "pl";
  h.requestUrl = "https://neweuropeanstrategies.com/";
  h.server = false;
  h.homePage = null;
  h.homePageFails = false;
  h.homePageHangs = false;
  h.homeMode = "";
  h.homeModeFails = false;
  h.settings = { reading: { posts_per_page: 2 } };
  h.settingsFails = false;
  h.archive = null;
  h.archiveFails = false;
  h.prefetch = [];
  h.cacheControl = [];
  h.linkHeaders = [];
  h.builderThrows = false;
  h.renderLang = "pl";
});

afterEach(() => {
  cleanup();
});

describe("/ - strona statyczna z kanwy CMS-u", () => {
  beforeEach(() => {
    h.homeMode = "static_page";
    h.homePage = homePageData();
  });

  it("czytelnik widzi treść kanwy i DOKŁADNIE JEDEN nagłówek h1", async () => {
    const view = await mountHome();
    expect(screen.getByTestId("kanwa")).toBeTruthy();
    expect(view.container.querySelectorAll("h1")).toHaveLength(1);
  });

  it("przypis `[fn]` z widgetu tekstowego dostaje sekcję końcową, a nie dosłowny shortcode", async () => {
    // Bez tego przejścia shortcode trafiał do publicznego obiegu dosłownie
    // (ustalenie §2.3 audytu z 2026-07-25).
    h.homePage = homePageData({
      builder_data: builderDoc("Zdanie[fn]Źródło: raport 2026[/fn] dalej."),
    });
    const view = await mountHome();
    expect(view.container.querySelector("[data-footnotes-list]")).not.toBeNull();
    expect(view.container.textContent).toContain("Źródło: raport 2026");
    expect(view.container.textContent).not.toContain("[fn]");
  });

  it("dokument BEZ przypisów nie dokłada pustej sekcji końcowej", async () => {
    const view = await mountHome();
    expect(view.container.querySelector("[data-footnotes-list]")).toBeNull();
  });

  it("SEO strony statycznej BIJE defaulty marki (tytuł, opis, canonical, robots)", async () => {
    h.homePage = homePageData({
      seo_title_pl: "Własny tytuł redakcji",
      seo_description_pl: "Własny opis redakcji",
      seo_canonical_url: "https://neweuropeanstrategies.com/kanoniczny",
      seo_noindex: true,
    });
    const view = await mountHome();
    expect(metaTitle(view.meta())).toBe("Własny tytuł redakcji");
    expect(metaByName(view.meta(), "description")).toBe("Własny opis redakcji");
    expect(linkByRel(view.links(), "canonical")).toBe(
      "https://neweuropeanstrategies.com/kanoniczny",
    );
    expect(metaByName(view.meta(), "robots")).toBe("noindex, nofollow");
  });

  it("bez własnych nadpisań opis bierze ZAJAWKĘ strony, nie zdanie marki", async () => {
    h.homePage = homePageData({ excerpt_pl: "Zajawka strony głównej z panelu." });
    const view = await mountHome();
    expect(metaByName(view.meta(), "description")).toBe("Zajawka strony głównej z panelu.");
    expect(metaByName(view.meta(), "robots")).toContain("index, follow");
  });

  it("wersja angielska bierze zajawkę EN i tytuł EN", async () => {
    h.requestUrl = "https://neweuropeanstrategies.com/en";
    h.lang = "en";
    h.homePage = homePageData({ excerpt_pl: "PL", excerpt_en: "Homepage excerpt EN." });
    const view = await mountHome();
    expect(metaByName(view.meta(), "description")).toBe("Homepage excerpt EN.");
    expect(metaByProperty(view.meta(), "og:locale")).toBe("en_US");
    expect(screen.getByTestId("kanwa")).toHaveAttribute("data-lang", "en");
  });

  it("okładka strony statycznej ląduje w og:image", async () => {
    h.homePage = homePageData({ cover_image_url: COVER });
    const view = await mountHome();
    expect(metaByProperty(view.meta(), "og:image")).toBe(COVER);
  });

  // REGRESJA 2026-09-01. Do tej daty SSR strony głównej rozgrzewał CAŁY dokument
  // buildera (`prefetchCachedRouteQueries`, budżet 6 000 ms), więc pierwszy bajt
  // najważniejszej trasy serwisu wisiał na najwolniejszym zapytaniu SPOD
  // ZGIĘCIA - i to na każdym cache MISS. Dwa komentarze obiecywały przy tym, że
  // resztę „dostrumieniowuje ServerSectionGate", a `HomeBuilderContent`
  // renderował `<BuilderRenderer>` BEZ propa `stream` (domyślnie `false`).
  // Ten test pilnuje OBU połów naprawy naraz - inaczej wróciłaby ta sama
  // rozbieżność między obietnicą a kodem.
  it("i SSR, i nawigacja klientowa czekają TYLKO na sekcje nad zgięciem", async () => {
    await mountHome();
    expect(h.prefetch).toEqual(["nad-zgieciem"]);

    cleanup();
    h.prefetch = [];
    h.server = true;
    await mountHome();
    expect(h.prefetch).toEqual(["nad-zgieciem"]);
    expect(h.prefetch).not.toContain("wszystkie-sekcje");
  });

  it("kanwa strony głównej strumieniuje sekcje spod zgięcia", async () => {
    await mountHome();
    // Bez `stream` sekcja spod zgięcia, która nie zmieści się w budżecie,
    // ląduje w HTML-u jako PUSTY widget: bez szkieletu i bez dociągnięcia.
    expect(screen.getByTestId("kanwa")).toHaveAttribute("data-stream", "1");
  });

  it("PUSTA kanwa daje zdanie „zajrzyj wkrótce”, a nie pustą powłokę buildera", async () => {
    h.homePage = homePageData({ builder_data: { version: 1, sections: [] } });
    await mountHome();
    expect(screen.queryByTestId("kanwa")).toBeNull();
    expect(screen.getByText(/zajrzyj wkrótce/i)).toBeTruthy();
  });

  it("stan pusty mówi w języku renderu, a nie zawsze po polsku", async () => {
    // Anglojęzyczny czytelnik na pustej stronie głównej nie może dostać
    // polskiego zdania - to najbardziej widoczne miejsce w serwisie.
    h.lang = "en";
    h.homePage = homePageData({ builder_data: { version: 1, sections: [] } });
    await mountHome();
    expect(screen.getByText(/nothing here yet/i)).toBeTruthy();
  });

  it("strona w innym edytorze niż builder też trafia na stan pusty (nie na wyjątek)", async () => {
    h.homePage = homePageData({ editor: "richtext", builder_data: builderDoc() });
    await mountHome();
    expect(screen.queryByTestId("kanwa")).toBeNull();
    expect(screen.getByText(/zajrzyj wkrótce/i)).toBeTruthy();
    // Kanwa nie wchodzi do renderu, więc rozgrzewka widgetów nie ma po co startować.
    expect(h.prefetch).toEqual([]);
  });

  it("czysty render jest CACHE'OWALNY na krawędzi", async () => {
    await mountHome();
    expect(h.cacheControl.at(-1)).toContain("s-maxage");
  });

  it("strona główna niesie warstwę encji: wydawca, serwis i nawigacja stopki", async () => {
    // Google zaleca trzymać te encje WYŁĄCZNIE na stronie głównej - jeden mocny
    // sygnał, po którym grafy wiedzy i asystenci AI rozpoznają markę.
    const view = await mountHome();
    const types = view.headScripts().map((s) => jsonLdType(s));
    expect(types).toEqual(["NewsMediaOrganization", "WebSite", "ItemList"]);
  });

  it("BEZ originu w adresie żądania warstwa encji wypada CAŁA, nie po kawałku", async () => {
    // Render bez kontekstu żądania (prerender bez hosta): absolutne adresy encji
    // byłyby zmyślone, a zmyślony `@id` psuje graf wiedzy trwale.
    h.requestUrl = "";
    const view = await mountHome();
    expect(view.headScripts()).toEqual([]);
    // Sam nagłówek nadal ma tytuł - strona bez tytułu w zakładce to gorszy defekt.
    expect(metaTitle(view.meta())).toContain("New European Strategies");
    // Adres kanoniczny spada do postaci RELATYWNEJ - link pozostaje poprawny,
    // choć nie da się z niego zbudować absolutnego `@id` encji.
    expect(linkByRel(view.links(), "canonical")).toBe("/");
  });
});

describe("/ - tryb „najnowsze wpisy”", () => {
  beforeEach(() => {
    h.homeMode = "latest_posts";
    h.archive = { posts: [post("p1"), post("p2")], total: 6, page: 1, pageSize: 2 };
  });

  it("loader dowozi DOKŁADNIE żądaną stronę wyników do siatki", async () => {
    await mountHome();
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Wpis p2/ })).toBeTruthy();
  });

  it("SEO ukrytej strony statycznej NIE przecieka do listy wpisów", async () => {
    // W trybie listy `homePageQueryOptions` z konstrukcji zwraca null, więc
    // tytuł i robots muszą spaść na defaulty marki - nie na SEO kanwy.
    h.homePage = null;
    const view = await mountHome();
    expect(metaTitle(view.meta())).toContain("New European Strategies");
    // BRAK wpisu `robots` to nie przeoczenie: lista wpisów jest domyślnie
    // indeksowalna, a `noindex` ukrytej strony statycznej NIE MOŻE jej dotknąć.
    expect(metaByName(view.meta(), "robots")).toBeUndefined();
  });

  it("druga strona wyników jest `noindex, follow`, a canonical zostaje czysty", async () => {
    h.archive = { posts: [post("p3")], total: 6, page: 2, pageSize: 2 };
    const view = await mountHome("/?page=2");
    expect(view.search()).toMatchObject({ page: 2 });
    expect(metaByName(view.meta(), "robots")).toBe("noindex, follow");
    expect(linkByRel(view.links(), "canonical")).toBe("https://neweuropeanstrategies.com/");
  });

  it("trasa `/` używa WSPÓLNEGO parsera paginacji, więc śmieć nie mnoży kluczy cache", async () => {
    // Ten sam kontrakt adresu co `/blog`: `page=1` jest niejawne, a wejście
    // nienumeryczne znika, zamiast tworzyć osobny wariant cache i klucz zapytania.
    // Reguły parsera mają własną tabelę w `src/lib/routing/__tests__/`; tutaj
    // dowodzimy WYŁĄCZNIE tego, że trasa jest do niego podpięta.
    const validate = routeSearchValidator(HomeRoute);
    expect(validate({ page: "abc" })).toEqual({});
    expect(validate({ page: "1" })).toEqual({});
    expect(validate({ page: "3" })).toEqual({ page: 3 });

    // ...i że render śmieciowego adresu nadal dowozi PIERWSZĄ stronę wyników.
    await mountHome("/?page=abc");
    expect(screen.getByRole("link", { name: /Wpis p1/ })).toBeTruthy();
  });

  it("paginacja jest LINKOWA (crawler ją przejdzie), a `?page=1` nie wraca do adresu", async () => {
    // Przyciski z `onClick` są dla crawlera niewidzialne, więc strony wyników
    // muszą mieć prawdziwe `href`. Strona pierwsza celuje w czyste „/”.
    const view = await mountHome();
    const pagination = screen.getByRole("navigation", { name: "Paginacja" });
    expect(within(pagination).getByRole("link", { name: /archive\.pageLabel 2/ })).toHaveAttribute(
      "href",
      "/?page=2",
    );
    expect(within(pagination).getByRole("link", { name: /archive\.pageLabel 3/ })).toHaveAttribute(
      "href",
      "/?page=3",
    );
    // Strona bieżąca nie jest linkiem - nie ma dokąd prowadzić.
    expect(within(pagination).queryByRole("link", { name: /archive\.pageLabel 1/ })).toBeNull();
    expect(view.search()).toEqual({});
  });

  it("kliknięcie strony ZMIENIA ADRES, a nie tylko widok", async () => {
    const view = await mountHome();
    const pagination = screen.getByRole("navigation", { name: "Paginacja" });
    await act(async () => {
      fireEvent.click(within(pagination).getByRole("link", { name: /archive\.pageLabel 2/ }), {
        button: 0,
      });
    });
    expect(view.search()).toMatchObject({ page: 2 });
  });

  it("okładka pierwszej karty ląduje w preloadzie LCP - w dokumencie I w nagłówku HTTP", async () => {
    h.archive = { posts: [post("p1", COVER), post("p2")], total: 2, page: 1, pageSize: 2 };
    const view = await mountHome();
    expect(imagePreload(view.links())).toMatchObject({
      href: COVER,
      fetchPriority: "high",
      imageSizes: CARD_IMAGE_SIZES,
    });
    expect(h.linkHeaders.at(-1)).toContain(COVER);
  });

  it("wpis bez okładki nie dokłada pustego preloadu ani nagłówka Link", async () => {
    const view = await mountHome();
    expect(imagePreload(view.links())).toBeUndefined();
    expect(h.linkHeaders).toEqual([]);
  });

  it("PUSTE archiwum pokazuje komunikat listy, nie stan awarii", async () => {
    h.archive = { posts: [], total: 0, page: 1, pageSize: 2 };
    await mountHome();
    expect(screen.getByText("blog.empty")).toBeTruthy();
    // Pustka jest poprawną odpowiedzią bazy, więc render zostaje cache'owalny.
    expect(h.cacheControl.at(-1)).toContain("s-maxage");
  });
});

describe("/ - degradacja: awaria danych NIE jest tym samym co pustka", () => {
  it("does not prefetch or expose a static page's SEO when the mode is unknown", async () => {
    h.homePage = homePageData({ seo_canonical_url: "https://example.com/hidden-static-home" });
    h.homeModeFails = true;
    const view = await mountHome();
    expect(screen.getByRole("status")).toBeVisible();
    expect(h.prefetch).toEqual([]);
    expect(imagePreload(view.links())).toBeUndefined();
    expect(linkByRel(view.links(), "canonical")).not.toContain("hidden-static-home");
  });

  it("automatically replaces hydrated stale seeds when the backend is healthy again", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["public", "home-page"], null, { updatedAt: 0 });
    qc.setQueryData(["public", "home-mode"], "", { updatedAt: 0 });
    h.homeMode = "static_page";
    h.homePage = homePageData();
    await act(async () => {
      await renderRoute({ route: HomeRoute, path: "/", initialEntry: "/", queryClient: qc });
    });
    await waitFor(() => expect(screen.getByTestId("kanwa")).toBeVisible());
    expect(screen.queryByRole("status")).toBeNull();
    expect(qc.getQueryState(["public", "home-page"])?.dataUpdatedAt).toBeGreaterThan(0);
  });

  it("recovers builder content after retry without a full page reload", async () => {
    h.homePageFails = true;
    h.homeModeFails = true;
    const view = await mountHome();
    expect(screen.getByRole("status")).toBeVisible();
    h.homePageFails = false;
    h.homeModeFails = false;
    h.homeMode = "static_page";
    h.homePage = homePageData();
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getByTestId("kanwa")).toBeVisible());
    expect(screen.queryByRole("status")).toBeNull();
    expect(view.queryClient.getQueryState(["public", "home-page"])?.dataUpdatedAt).toBeGreaterThan(
      0,
    );
  });

  it("keeps page 2 and the configured page size when an archive refetch recovers", async () => {
    h.homeMode = "latest_posts";
    h.archiveFails = true;
    await mountHome("/?page=2");
    expect(screen.getByRole("status")).toBeVisible();
    h.archiveFails = false;
    h.archive = { posts: [post("recovered")], total: 4, page: 2, pageSize: 2 };
    fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /Wpis recovered/ })).toBeVisible());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a hanging SSR homepage stops at the shared deadline and seeds recoverable data", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    try {
      h.server = true;
      h.homePageHangs = true;
      const deadline = homeSsrDeadline(qc);
      // Root has already used 400 ms. The home loader may not start a fresh
      // 600 ms timer when it joins the same request later.
      await vi.advanceTimersByTimeAsync(400);
      type Loader = (args: {
        context: { queryClient: QueryClient };
        deps: { page: number };
      }) => Promise<{
        degraded: boolean;
        homePage: PageData | null;
        coverPreload: unknown;
      }>;
      const loader = HomeRoute.options.loader as unknown as Loader;
      const result = loader({ context: { queryClient: qc }, deps: { page: 1 } });
      await vi.advanceTimersByTimeAsync(HOME_SSR_BUDGET_MS - 400);
      expect(await result).toMatchObject({ degraded: true, homePage: null, coverPreload: null });
      expect(Date.now()).toBe(deadline);
      expect(qc.getQueryState(["public", "home-page"])).toMatchObject({
        status: "success",
        fetchStatus: "idle",
        dataUpdatedAt: 0,
      });
      expect(h.cacheControl.at(-1)).toBe("private, no-store");
    } finally {
      qc.clear();
      vi.useRealTimers();
    }
  });

  it("awaria archiwum daje pustą siatkę I ODCINA cache współdzielony", async () => {
    // To jest różnica wobec pustego archiwum: tam wynik jest prawdziwy i wolno
    // go podać następnemu odwiedzającemu, tutaj byłaby to utrwalona awaria.
    h.homeMode = "latest_posts";
    h.archiveFails = true;
    await mountHome();
    expect(screen.queryByRole("link", { name: /Wpis/ })).toBeNull();
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("awaria strony głównej i trybu zasiewa BEZPIECZNE zapasy, zamiast wywracać trasę", async () => {
    h.homePageFails = true;
    h.homeModeFails = true;
    const view = await mountHome();
    // Zasiane wartości muszą być NATYCHMIAST przeterminowane - inaczej strona
    // nie wyleczy się sama po powrocie backendu.
    expect(view.queryClient.getQueryData(["public", "home-page"])).toBeNull();
    expect(view.queryClient.getQueryData(["public", "home-mode"])).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("Wczytujemy stronę główną");
    expect(screen.queryByText(/zajrzyj wkrótce/i)).toBeNull();
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });

  it("awaria ustawień serwisu nie zabiera czytelnikowi treści ani powłoki", async () => {
    // `<Header/>` czyta DOKŁADNIE to zapytanie przez `useSuspenseQuery`, więc
    // bez zasianej pustej mapy cała strona poleciałaby na granicę błędu.
    h.homeMode = "static_page";
    h.homePage = homePageData();
    h.settingsFails = true;
    const view = await mountHome();
    expect(screen.getByTestId("kanwa")).toBeTruthy();
    expect(view.queryClient.getQueryData(["site-settings"])).toEqual({});
    expect(h.cacheControl.at(-1)).toContain("no-store");
  });
});

describe("/ - powierzchnie awaryjne trasy", () => {
  it("awaria RENDERU kanwy daje kartę błędu z drogą powrotną, nie białą stronę", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.homeMode = "static_page";
    h.homePage = homePageData();
    h.builderThrows = true;
    await mountHome();
    expect(screen.getByRole("heading", { name: "Nie udało się załadować strony" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Strona główna" })).toHaveAttribute("href", "/");
    // Techniczny komunikat wyjątku NIE trafia na ekran czytelnika.
    expect(screen.queryByText(/kanwa nie umiała/i)).toBeNull();
    // ...ale trafia do konsoli po stronie granicy błędu.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    spy.mockRestore();
  });

  it("„Spróbuj ponownie” unieważnia dane trasy i odzyskuje treść", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.homeMode = "static_page";
    h.homePage = homePageData();
    h.builderThrows = true;
    await mountHome();
    h.builderThrows = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    });
    await waitFor(() => expect(screen.getByTestId("kanwa")).toBeTruthy());
    spy.mockRestore();
  });

  it("404 trasy `/` ma wyjście na stronę główną i NIE proponuje ponowienia", async () => {
    // Ponowienie żądania nie sprawi, że zasób zaistnieje - jedyne sensowne
    // wyjście to strona główna. To dlatego 404 jest osobną powierzchnią.
    const NotFound = HomeRoute.options.notFoundComponent;
    expect(NotFound).toBeTypeOf("function");
    const { container } = render(
      <>{NotFound?.({ data: undefined, isNotFound: true, routeId: "/" })}</>,
    );
    expect(screen.getByRole("heading", { name: "Nie znaleziono strony" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("a")).toHaveAttribute("href", "/");
  });

  it("warstwa awaryjna mówi po angielsku, gdy render biegnie po angielsku", async () => {
    // Ta warstwa renderuje się POZA dostawcą i18next, więc czyta `currentLang()`
    // ze słownika `lib/errorCopy.ts` - i to musi działać w obu językach.
    h.renderLang = "en";
    const NotFound = HomeRoute.options.notFoundComponent;
    render(<>{NotFound?.({ data: undefined, isNotFound: true, routeId: "/" })}</>);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});

describe("/ - kontrakt nagłówka bez montowania trasy", () => {
  it("`head()` bez danych loadera nadal daje tytuł i opis marki", async () => {
    const meta = await routeMeta(HomeRoute);
    expect(metaTitle(meta)).toContain("New European Strategies");
    expect(metaByName(meta, "description")).toBeTypeOf("string");
    // Bez danych loadera nie ma czego zabraniać - trasa nie emituje `robots`.
    expect(metaByName(meta, "robots")).toBeUndefined();
  });
});

describe("/ - dostępność", () => {
  it("strona główna w trybie kanwy nie ma naruszeń dostępności", async () => {
    h.homeMode = "static_page";
    h.homePage = homePageData({ builder_data: builderDoc("Zdanie[fn]Źródło[/fn] dalej.") });
    const view = await mountHome();
    const violations = await axeViolations(view.container);
    expect(summarize(violations)).toBe("");
  });

  it("strona główna w trybie listy wpisów nie ma naruszeń dostępności", async () => {
    h.homeMode = "latest_posts";
    h.archive = { posts: [post("p1", COVER), post("p2")], total: 6, page: 1, pageSize: 2 };
    const view = await mountHome();
    const violations = await axeViolations(view.container);
    expect(summarize(violations)).toBe("");
  });
});

describe("/ - dług i18n zgłoszony, nie naprawiony", () => {
  // Zdanie stanu pustego („Nie ma tu jeszcze treści - zajrzyj wkrótce.”) jest
  // dwujęzycznym LITERAŁEM w kodzie molekuły, a nie kluczem słownika - treść
  // przeniesiona znak w znak z `routes/index.tsx`.
  //
  // KONSEKWENCJA DLA UŻYTKOWNIKA: redakcja nie może zmienić zdania, które widzi
  // czytelnik na PUSTEJ stronie głównej, bez wdrożenia kodu - w odróżnieniu od
  // każdego innego tekstu w serwisie. Bramka parytetu PL/EN nie ma tu czego
  // porównywać, więc rozjazd tłumaczeń przejdzie niezauważony.
  //
  // DLACZEGO NAPRAWA JEST DECYZJĄ DLA CZŁOWIEKA: strona główna nie woła żadnego
  // `ensureI18n`, więc klucz musi albo wejść do słownika BAZOWEGO (koszt
  // w rozmiarze wejściowego chunku najważniejszej trasy), albo strona musi
  // zacząć dociągać nakładkę (koszt w TTFB tej samej trasy). To wybór
  // architektoniczny, nie refaktor pod test.
  it.fails("zdanie stanu pustego pochodzi ze słownika, nie z literału w kodzie", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/components/home/molecules/HomeEmptyNotice.tsx", "utf8");
    const literaly = /There's nothing here yet|Nie ma tu jeszcze treści/.test(source);
    expect({ dwujezycznyLiteralWKodzie: literaly }).toEqual({ dwujezycznyLiteralWKodzie: false });
  });
});

it("does not cache an above-fold data widget whose prefetch missed the deadline", async () => {
  h.server = true;
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
            span: { desktop: 12 },
            children: [{ id: "w", kind: "widget", type: "post-list", content: {} }],
          },
        ],
      },
    ],
  };
  h.homePage = homePageData({ builder_data: doc });
  const view = await mountHome();
  expect(h.prefetch).toEqual(["nad-zgieciem"]);
  expect(view.queryClient.getQueryState(["public", "home-page"])?.dataUpdatedAt).toBeGreaterThan(0);
  expect(h.cacheControl.at(-1)).toBe("private, no-store");
});
