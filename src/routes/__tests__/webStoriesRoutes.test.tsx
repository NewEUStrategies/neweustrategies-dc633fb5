// Trasy PUBLICZNE `/web-stories/` (indeks) i `/web-stories/$slug` (historia).
// Do dziś: indeks 0 z 18 linii, szczegół 0 z 29 linii.
//
// CO DOWODZI TEN PLIK.
//
// Web Story jest formatem, który istnieje WYŁĄCZNIE dzięki temu, jak wygląda
// dla robota: kwalifikacja do karuzeli Web Stories w Google wymaga
// równoległego dokumentu `<amp-story>`, poprawnego węzła `CreativeWork`
// i adresu kanonicznego. Render samego komponentu mija dokładnie tę warstwę.
// Dlatego wszystko niżej idzie przez `renderRoute` (prawdziwy router
// pamięciowy) albo przez `routeHead` (wywołanie `head()` wprost).
//
// PIĘĆ REGUŁ, KTÓRYCH ZŁAMANIE KOSZTUJE:
//
//   1. NIEISTNIEJĄCY SLUG TO 404, NIE PUSTA STRONA. `notFound()` w loaderze
//      jest jedyną rzeczą, która trzyma ten adres poza indeksem.
//   2. NAGŁÓWEK NIESIE TYTUŁ I OPIS W OBU JĘZYKACH, KANONICZNY I HREFLANG.
//      To była realna wada `/web-stories/$slug`: `head()` był składany
//      RĘCZNIE, bez `buildContentHead` - bez kanonicznego, bez klastra
//      hreflang, bez `og:url`/`og:site_name`, a tytuł brał się ZAWSZE
//      z `title_pl`, więc czytelnik `/en/...` dostawał polską nazwę w karcie
//      udostępnienia. NAPRAWIONE w tej zmianie.
//   3. LINK `amphtml` MUSI ISTNIEĆ. Bez niego cała inwestycja w format
//      przepada: Google nie ma jak znaleźć dokumentu AMP.
//   4. DEGRADACJA INDEKSU MÓWI PRAWDĘ i nie zamraża pustki na brzegu CDN.
//   5. HISTORIA INNEGO OBSZARU ROBOCZEGO NIE POJAWIA SIĘ NA TYM HOŚCIE.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - DOKUMENTU AMP `/web-stories/$slug/amp`: pełny kontrakt (fail-closed 404,
//   poprawność XML, TTL) ma `src/routes/__tests__/feedRoutesDegradation.test.ts`
//   i `src/lib/seo/__tests__/ampStory.test.ts`. Tutaj dowodzimy WYŁĄCZNIE
//   tego, że strona HTML GŁOSI istnienie tamtego dokumentu.
// - PRZEGLĄDARKI HISTORII: `StoryViewer` ma własny, obszerny plik
//   `src/components/web-stories/__tests__/StoryViewer.test.tsx`, a REGUŁY
//   nawigacji mieszkają w `src/lib/web-stories/viewerNav.ts` (100%). Poniżej
//   sprawdzamy jedną rzecz, której żaden z tych plików nie widzi: czy widok
//   ZAMONTOWANY PRZEZ TRASĘ faktycznie chodzi po tej regule, czy ma własną,
//   równoległą implementację nawigacji.
// - `src/lib/queries/webStories.ts` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST), więc klucze cache, limit 50 i filtr
//   `status=published` są tymi z produkcji.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `web_stories` ze WSZYSTKICH obszarów roboczych. */
  stories: [] as Record<string, unknown>[],
  /** Tenant PRZEGLĄDANEJ domeny - atrapa polityki `public_tenant_id()`. */
  tenantId: "tenant-a",
  /** `true` = odczyt `web_stories` pada (blip backendu). */
  broken: false,
  /** Etykiety odczytów W KOLEJNOŚCI - PODSTAWA POMIARU zapytań (blok N5). */
  reads: [] as string[],
  /** Adres żądania widziany przez `head()`. */
  requestUrl: "https://nes.example.org/web-stories",
  /** Nagłówki `Cache-Control`, jakie ustawił loader. */
  cacheControl: [] as string[],
  /** Wartości nagłówka HTTP `Link` dopisane przez loader (preload okładki). */
  linkHeaders: [] as string[],
  /** Tytuły, jakie trasy podały wspólnemu ekranowi awarii. */
  errorTitles: [] as (string | undefined)[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();

  stub.setResponse("web_stories", (chain) => {
    if (h.broken) return fail("test: tabela web_stories niedostepna");
    const eqSlug = chain.calls.find((call) => call.method === "eq" && call.args[0] === "slug")
      ?.args[1];
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    const visible = h.stories.filter(
      (row) => row.tenant_id === h.tenantId && row.status === "published",
    );
    if (typeof eqSlug === "string") {
      h.reads.push("web_stories:slug");
      return ok(visible.find((row) => row.slug === eqSlug) ?? null);
    }
    const limit = chain.calls.find((call) => call.method === "limit")?.args[0];
    h.reads.push(`web_stories:latest:${String(limit)}`);
    return ok(visible);
  });

  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

// Wspólny ekran awarii jest tu ATRAPĄ-MARKEREM: przedmiotem dowodu jest
// WYŁĄCZNIE `title`, który trasa mu podaje (jego własne zachowanie ma osobne
// pliki). Asercja na propsie, nie na DOM, bo prawdziwy `FriendlyErrorPage`
// ciągnie kolejne warstwy, a tytuł jest jedyną rzeczą, którą trasa wnosi.
vi.mock("@/components/molecules/RouteErrorFallback", () => ({
  RouteErrorFallback: ({ title }: { title?: string }) => {
    h.errorTitles.push(title);
    return <div data-testid="route-error-fallback">{String(title)}</div>;
  },
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: (value: string) => void h.linkHeaders.push(value),
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import type { ReactElement } from "react";
import { QueryClient } from "@tanstack/react-query";
import type { AnyRoute } from "@tanstack/react-router";
import i18n from "@/lib/i18n";
import { renderRoute, routeHead } from "@/test/routeHarness";
import type { RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { keyAction } from "@/lib/web-stories/viewerNav";
import { Route as WebStoriesIndexRoute } from "@/routes/web-stories.index";
import { Route as WebStoryRoute } from "@/routes/web-stories.$slug";

const INDEX_PATH = "/web-stories/";
const DETAIL_PATH = "/web-stories/$slug";
const SLUG = "zima-bez-gazu";

// ── fixtures (RODO: wszystkie tytuły i podpisy są ZMYŚLONE) ─────────────────

function storyPage(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "p1",
    background: "color",
    media_url: "",
    poster_url: "",
    color: "#102030",
    title_pl: "Plansza pierwsza",
    title_en: "First slide",
    caption_pl: "Podpis pierwszej planszy.",
    caption_en: "Caption of the first slide.",
    cta_label_pl: "",
    cta_label_en: "",
    cta_href: "",
    text_position: "bottom",
    text_align: "left",
    duration_seconds: 6,
    ...patch,
  };
}

function story(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "s1",
    tenant_id: "tenant-a",
    slug: SLUG,
    title_pl: "Zima bez gazu",
    title_en: "Winter without gas",
    description_pl: "Jak Europa przetrwała zimę bez rosyjskiego gazu.",
    description_en: "How Europe got through winter without Russian gas.",
    cover_url: "https://obrazy.example.org/zima.jpg",
    pages: [
      storyPage(),
      storyPage({ id: "p2", title_pl: "Plansza druga", title_en: "Second slide" }),
    ],
    status: "published",
    published_at: "2026-02-01T09:00:00.000Z",
    author_id: null,
    created_at: "2026-01-20T09:00:00.000Z",
    updated_at: "2026-02-01T09:00:00.000Z",
    ...patch,
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

async function mountIndex(queryClient?: QueryClient) {
  return renderRoute({
    route: WebStoriesIndexRoute,
    path: INDEX_PATH,
    initialEntry: "/web-stories/",
    queryClient,
  });
}

async function mountStory(slug = SLUG, queryClient?: QueryClient) {
  return renderRoute({
    route: WebStoryRoute,
    path: DETAIL_PATH,
    initialEntry: `/web-stories/${slug}`,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma. */
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** `href` linku o danym `rel` - z twardym błędem, gdy linku nie ma. */
function linkHref(head: RouteHeadResult, rel: string): string {
  const found = (head.links ?? []).find((entry) => entry.rel === rel);
  const href = found?.href;
  if (typeof href !== "string") throw new Error(`test: brak linku rel="${rel}"`);
  return href;
}

/** Sparsowany węzeł JSON-LD - dowód dotyczy STRUKTURY, nie podciągu. */
function jsonLdNode(head: RouteHeadResult): Record<string, unknown> {
  const script = (head.scripts ?? []).find((entry) => entry.type === "application/ld+json");
  const raw = script?.children;
  if (typeof raw !== "string") throw new Error("test: brak wezla JSON-LD");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("test: wezel JSON-LD nie jest obiektem");
  }
  return parsed as Record<string, unknown>;
}

/** Ładunek loadera szczegółu - do wywołań `head()` z prawdziwym kształtem. */
async function storyLoaderData(slug = SLUG): Promise<unknown> {
  const loader: unknown = WebStoryRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return (
    loader as (ctx: {
      context: { queryClient: QueryClient };
      params: { slug: string };
    }) => Promise<unknown>
  )({ context: { queryClient: freshClient() }, params: { slug } });
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.stories = [story()];
  h.tenantId = "tenant-a";
  h.broken = false;
  h.reads = [];
  h.requestUrl = "https://nes.example.org/web-stories";
  h.cacheControl = [];
  h.linkHeaders = [];
  h.errorTitles = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /web-stories/ - indeks historii", () => {
  it("pokazuje kartę historii z tytułem, opisem i linkiem do niej", async () => {
    await mountIndex();

    expect(screen.getByRole("heading", { level: 1, name: "Web Stories" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Zima bez gazu" })).toBeInTheDocument();
    expect(
      screen.getByText("Jak Europa przetrwała zimę bez rosyjskiego gazu."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Zima bez gazu/ })).toHaveAttribute(
      "href",
      `/web-stories/${SLUG}`,
    );
  });

  it("po angielsku bierze angielski tytuł, opis i podtytuł listy", async () => {
    await i18n.changeLanguage("en");
    await mountIndex();

    expect(screen.getByText("Latest stories")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: "Winter without gas" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Zima bez gazu")).not.toBeInTheDocument();
  });

  it("historia BEZ okładki renderuje kartę zamiast pustego obrazka", async () => {
    // `<img src="">` w części przeglądarek pokazuje ikonę zepsutego obrazka,
    // więc karta bez okładki musi dostać jednolite tło.
    h.stories = [story({ cover_url: null })];
    await mountIndex();

    expect(screen.getByRole("heading", { level: 2, name: "Zima bez gazu" })).toBeInTheDocument();
  });

  it("pusty indeks daje komunikat redakcyjny, a nie pustą siatkę", async () => {
    h.stories = [];
    await mountIndex();

    expect(screen.getByText("Brak opublikowanych historii.")).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.stories = [];
    await mountIndex();

    expect(screen.getByText("No stories published yet.")).toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy i mówi PRAWDĘ, a nie „brak historii”", async () => {
    // `loadResilient` zamienia blip bazy w HTTP 200 z pustą listą - ale pusta
    // lista i „nic nie dojechało" to dwie różne prawdy.
    h.broken = true;
    await mountIndex();

    expect(await screen.findByText(/Nie udało się załadować historii/)).toBeInTheDocument();
    expect(screen.queryByText("Brak opublikowanych historii.")).toBeNull();
  });

  it("po angielsku komunikat degradacji też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.broken = true;
    await mountIndex();

    expect(await screen.findByText(/Couldn't load stories/)).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: czysty render NIE pokazuje komunikatu degradacji", async () => {
    await mountIndex();

    expect(screen.queryByText(/Nie udało się załadować historii/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Zima bez gazu" })).toBeInTheDocument();
  });

  it("zdegradowany render deklaruje no-store, czysty - politykę treści", async () => {
    h.broken = true;
    await mountIndex();
    expect(h.cacheControl.at(-1)).toContain("no-store");

    h.broken = false;
    h.cacheControl = [];
    await mountIndex(freshClient());
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });

  it("SZKICE historii nie wychodzą na indeks publiczny", async () => {
    // Filtr `status=published` jest jedyną rzeczą, która trzyma redakcyjną
    // kolejkę poza publicznym adresem.
    h.stories = [story({ status: "draft", title_pl: "SZKIC - nie publikować" })];
    await mountIndex();

    expect(screen.queryByText("SZKIC - nie publikować")).not.toBeInTheDocument();
    expect(screen.getByText("Brak opublikowanych historii.")).toBeInTheDocument();
  });

  it("historia innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    h.stories = [story({ tenant_id: "tenant-b", title_pl: "Historia obcego obszaru" })];
    await mountIndex();

    expect(screen.queryByText("Historia obcego obszaru")).not.toBeInTheDocument();
    expect(screen.getByText("Brak opublikowanych historii.")).toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama historia na WŁASNYM hoście renderuje się", async () => {
    h.stories = [story({ tenant_id: "tenant-b", title_pl: "Historia obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mountIndex();

    expect(
      screen.getByRole("heading", { level: 2, name: "Historia obcego obszaru" }),
    ).toBeInTheDocument();
  });

  it("nie zostawia indeksu z wadami dostępności", async () => {
    const view = await mountIndex();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /web-stories/ - nagłówek indeksu", () => {
  it("po polsku niesie polski opis i znacznik języka", () => {
    const head = routeHead(WebStoriesIndexRoute);

    expect(headTitle(head)).toBe("Web Stories - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe("Przeglądaj nasze web stories.");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski opis, a nazwa formatu zostaje", () => {
    // Nazwa formatu jest ta sama w obu językach z premedytacją; różnicę
    // niesie OPIS, i to on musi się przełączyć.
    h.requestUrl = "https://nes.example.org/en/web-stories";
    const head = routeHead(WebStoriesIndexRoute);

    expect(headTitle(head)).toBe("Web Stories - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe("Browse our web stories.");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("kanoniczny bierze adres z żądania, a pusty adres spada na /web-stories", () => {
    expect(linkHref(routeHead(WebStoriesIndexRoute), "canonical")).toBe(
      "https://nes.example.org/web-stories",
    );

    h.requestUrl = "";
    expect(linkHref(routeHead(WebStoriesIndexRoute), "canonical")).toBe("/web-stories");
  });
});

describe("trasa /web-stories/$slug - nieistniejący slug to 404", () => {
  it("slug, którego nie ma, kończy się 404 - a nie pustą stroną historii", async () => {
    // `notFound()` w loaderze jest jedyną rzeczą, która trzyma ten adres poza
    // indeksem. Bez niej strona zbudowałaby się wokół `undefined`.
    await mountStory("nie-ma-takiej-historii");

    expect(await screen.findByText("Nie znaleziono historii.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Zima bez gazu" })).toBeNull();
  });

  it("po angielsku komunikat 404 też jest angielski", async () => {
    // `notFoundComponent` bierze język z `activeLang()`, czyli z ADRESU
    // ŻĄDANIA - nie z singletonu i18next (ten jest współdzielony między
    // równoległymi żądaniami SSR w jednym workerze, patrz lib/seo/head.ts).
    // Dlatego przestawiamy adres, a nie język instancji.
    h.requestUrl = "https://nes.example.org/en/web-stories/nie-ma-takiej-historii";
    await i18n.changeLanguage("en");
    await mountStory("nie-ma-takiej-historii");

    expect(await screen.findByText("Story not found.")).toBeInTheDocument();
  });

  it("SZKIC nie ma publicznego adresu - daje 404, nie podglądu", async () => {
    h.stories = [story({ status: "draft" })];
    await mountStory();

    expect(await screen.findByText("Nie znaleziono historii.")).toBeInTheDocument();
  });

  it("HISTORIA INNEGO OBSZARU ROBOCZEGO daje 404, a nie cudzy tytuł", async () => {
    h.stories = [story({ tenant_id: "tenant-b", title_pl: "Historia obcego obszaru" })];
    await mountStory();

    expect(await screen.findByText("Nie znaleziono historii.")).toBeInTheDocument();
    expect(screen.queryByText("Historia obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: ta sama historia na WŁASNYM hoście renderuje się", async () => {
    h.stories = [story({ tenant_id: "tenant-b", title_pl: "Historia obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mountStory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Historia obcego obszaru" }),
    ).toBeInTheDocument();
  });

  it("loader rzuca `notFound()`, a nie oddaje `null` - to decyduje o statusie HTTP", async () => {
    // Asercja na LOADERZE, nie na renderze: status HTTP jest tym, co widzi
    // crawler, a render 404 przy HTTP 200 zostawia adres w indeksie.
    await expect(storyLoaderData("nie-ma-takiej-historii")).rejects.toBeTruthy();
  });
});

describe("trasa /web-stories/$slug - treść historii", () => {
  it("pokazuje tytuł, opis i przycisk odtworzenia", async () => {
    await mountStory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Zima bez gazu" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Jak Europa przetrwała zimę bez rosyjskiego gazu."),
    ).toBeInTheDocument();
    expect(screen.getByText("Odtwórz historię")).toBeInTheDocument();
  });

  it("po angielsku bierze angielski tytuł, opis i etykietę odtwarzania", async () => {
    await i18n.changeLanguage("en");
    await mountStory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Winter without gas" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("How Europe got through winter without Russian gas."),
    ).toBeInTheDocument();
    expect(screen.getByText("Play story")).toBeInTheDocument();
  });

  it("historia BEZ plansz nie otwiera pustej przeglądarki", async () => {
    // `pages` jest kolumną jsonb - pusta tablica i śmieci to realne wejścia
    // (import z panelu). Pełnoekranowe okno bez treści to pułapka bez wyjścia.
    h.stories = [story({ pages: [] })];
    await mountStory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Zima bez gazu" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("nieparsowalne `pages` degradują do zera plansz, a nie wywracają trasy", async () => {
    // `safeParsePages` jest tu jedyną obroną. Bez niej jeden zły wiersz
    // zamienia stronę historii w ekran błędu.
    h.stories = [story({ pages: { nie: "tablica" } })];
    await mountStory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Zima bez gazu" }),
    ).toBeInTheDocument();
  });

  it("sekcja „więcej historii” pomija historię, którą właśnie czytamy", async () => {
    // Kafelek prowadzący na tę samą stronę jest martwym linkiem i zabiera
    // miejsce jedynej rekomendacji, jaką ta strona ma.
    h.stories = [story(), story({ id: "s2", slug: "druga-historia", title_pl: "Druga historia" })];
    await mountStory();

    const more = await screen.findByRole("heading", { level: 2, name: "Więcej historii" });
    const section = more.closest("section");
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByText("Druga historia")).toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText("Zima bez gazu")).toBeNull();
  });

  it("JEDYNA historia w obszarze roboczym nie pokazuje pustej sekcji rekomendacji", async () => {
    await mountStory();
    await screen.findByRole("heading", { level: 1 });

    expect(screen.queryByRole("heading", { level: 2, name: "Więcej historii" })).toBeNull();
  });

  it("loader dopisuje nagłówek HTTP `Link` z preloadem okładki (LCP)", async () => {
    // Preload w nagłówku odpowiedzi startuje pobieranie okładki PRZED
    // parsowaniem HTML - to jest cały zysk, więc jego utrata jest niewidoczna
    // w renderze i widoczna w pomiarze LCP.
    await storyLoaderData();

    // ZMIERZONE, nie zgadnięte: `imagePreloadLinkHeaderValue` składa parametry
    // RFC 8288 z wartościami W CUDZYSŁOWACH, więc asercja na `as=image`
    // przechodziłaby tylko przez przypadek.
    expect(h.linkHeaders.some((value) => value.includes('as="image"'))).toBe(true);
    expect(h.linkHeaders.some((value) => value.includes('rel="preload"'))).toBe(true);
  });

  it("historia BEZ okładki NIE dopisuje pustego preloadu", async () => {
    // Preload adresu, którego nie ma, kosztuje żądanie i ostrzeżenie
    // w konsoli przeglądarki na każdej takiej stronie.
    h.stories = [story({ cover_url: null })];
    await storyLoaderData();

    expect(h.linkHeaders).toEqual([]);
  });

  it("nie zostawia strony historii z wadami dostępności", async () => {
    const view = await mountStory();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

// ── DOSTĘPNOŚĆ: NAWIGACJA KLAWIATURĄ W PRZEGLĄDARCE HISTORII ───────────────
//
// PYTANIE, NA KTÓRE TEN BLOK ODPOWIADA: `src/lib/web-stories/viewerNav.ts`
// stoi na 100% pokrycia jako REGUŁA nawigacji - ale reguła przetestowana
// i NIEUŻYWANA jest gorsza niż brak reguły, bo daje fałszywe poczucie
// pokrycia. Sprawdzamy więc, czy widok ZAMONTOWANY PRZEZ TRASĘ chodzi po tej
// samej regule, a nie po własnej, równoległej implementacji.
//
// USTALENIE: chodzi po niej. `StoryViewer` importuje `keyAction`, `advance`,
// `rewind`, `clampStartIndex`, `pageDurationMs`, `progressWidth`
// i `backgroundKind` z tego modułu, a testy niżej sprawdzają to ZACHOWANIEM,
// nie importem: dla KAŻDEJ klawiszy rozpoznawanej przez regułę widok reaguje,
// a dla klawiszy nierozpoznawanej NIE reaguje. Gdyby ktoś dopisał w widoku
// własną obsługę (np. „j"/„k"), ostatni test tego bloku padnie.
describe("trasa /web-stories/$slug - klawiatura przeglądarki chodzi po REGULE", () => {
  it("otwiera przeglądarkę jako okno modalne z etykietą w języku strony", async () => {
    // `role="dialog"` + `aria-modal` to jedyna rzecz, która mówi czytnikowi
    // ekranu, że pełnoekranowa historia przejęła kontekst.
    await mountStory();

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Historia");
  });

  it("po angielsku okno przeglądarki ma angielską etykietę", async () => {
    await i18n.changeLanguage("en");
    await mountStory();

    expect(await screen.findByRole("dialog")).toHaveAccessibleName("Web story");
  });

  it("STRZAŁKA W PRAWO przechodzi na następną planszę", async () => {
    await mountStory();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Plansza pierwsza")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowRight" });

    expect(await within(dialog).findByText("Plansza druga")).toBeInTheDocument();
  });

  it("STRZAŁKA W LEWO wraca na poprzednią, a na pierwszej NIE zamyka historii", async () => {
    // `rewind` stoi na pierwszej planszy z premedytacją: cofanie się nie może
    // wyrzucić czytelnika z historii, którą właśnie zaczął.
    await mountStory();
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await within(dialog).findByText("Plansza druga")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(await within(dialog).findByText("Plansza pierwsza")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("ESCAPE zamyka przeglądarkę i oddaje czytelnikowi stronę historii", async () => {
    await mountStory();
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("heading", { level: 1, name: "Zima bez gazu" })).toBeInTheDocument();
  });

  it("SPACJA przełącza pauzę i BLOKUJE domyślne przewinięcie strony", async () => {
    // Bez `preventDefault` przeglądarka przewija stronę POD pełnoekranową
    // historią - czytelnik wraca z zamknięcia w innym miejscu dokumentu.
    await mountStory();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Pauza" })).toBeInTheDocument();

    const event = new KeyboardEvent("keydown", { key: " ", cancelable: true, bubbles: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(await within(dialog).findByRole("button", { name: "Wznów" })).toBeInTheDocument();
  });

  it("STRZAŁKA W PRAWO na OSTATNIEJ planszy zamyka historię, nie blokuje się", async () => {
    // `advance` zwraca `ended` na ostatniej planszy - Web Story kończy się
    // zamknięciem, a nie martwą strzałką.
    await mountStory();
    await screen.findByRole("dialog");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("WIDOK NIE MA WŁASNEJ, RÓWNOLEGŁEJ NAWIGACJI - klawisz spoza reguły nic nie robi", async () => {
    // TO JEST TEST „REGUŁA JEST UŻYWANA". Zbiór klawiszy obsługiwanych przez
    // widok musi być DOKŁADNIE tym, który rozpoznaje `keyAction`. Gdyby ktoś
    // dopisał w komponencie własną obsługę (albo przestał wołać regułę),
    // jedna z tych dwóch asercji padnie.
    await mountStory();
    const dialog = await screen.findByRole("dialog");

    // Klawisze, których reguła NIE zna, nie mogą ruszyć historii.
    for (const key of ["j", "k", "Enter", "Tab", "ArrowUp", "ArrowDown"]) {
      expect(keyAction(key), `keyAction("${key}")`).toBeNull();
      fireEvent.keyDown(window, { key });
    }
    expect(within(dialog).getByText("Plansza pierwsza")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // KONTROLA DODATNIA: klawisz, który reguła zna, JEDNAK rusza historię.
    expect(keyAction("ArrowRight")).toBe("next");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(await within(dialog).findByText("Plansza druga")).toBeInTheDocument();
  });

  it("nie zostawia otwartej przeglądarki z wadami dostępności", async () => {
    const view = await mountStory();
    await screen.findByRole("dialog");

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /web-stories/$slug - nagłówek dokumentu", () => {
  it("po polsku tytuł niesie nazwę historii z marką, a opis jej opis", async () => {
    const loaderData = await storyLoaderData();
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect(headTitle(head)).toBe("Zima bez gazu - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Zima bez gazu");
    expect(metaContent(head, "name", "description")).toBe(
      "Jak Europa przetrwała zimę bez rosyjskiego gazu.",
    );
    expect(metaContent(head, "property", "og:type")).toBe("article");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("po angielsku tytuł i opis SĄ ANGIELSKIE - to była wada tej trasy", async () => {
    // Sedno naprawy. `head()` brał tytuł ZAWSZE z `title_pl`, więc czytelnik
    // `/en/web-stories/...` udostępniał link z polską nazwą historii.
    const loaderData = await storyLoaderData();
    h.requestUrl = `https://nes.example.org/en/web-stories/${SLUG}`;
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect(headTitle(head)).toBe("Winter without gas - New European Strategies");
    expect(metaContent(head, "property", "og:title")).toBe("Winter without gas");
    expect(metaContent(head, "name", "description")).toBe(
      "How Europe got through winter without Russian gas.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("niesie ADRES KANONICZNY i klaster hreflang PL/EN", async () => {
    // Druga część naprawy: bez kanonicznego `/web-stories/x`
    // i `/en/web-stories/x` konkurowały ze sobą w indeksie jako dwie strony
    // o tej samej treści.
    const loaderData = await storyLoaderData();
    h.requestUrl = `https://nes.example.org/web-stories/${SLUG}`;
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect(linkHref(head, "canonical")).toBe(`https://nes.example.org/web-stories/${SLUG}`);
    expect(metaContent(head, "property", "og:url")).toBe(
      `https://nes.example.org/web-stories/${SLUG}`,
    );
    const alternates = (head.links ?? []).filter(
      (l) => l.rel === "alternate" && l.hrefLang !== "x-default",
    );
    expect(alternates.map((l) => l.hrefLang).sort()).toEqual(["en", "pl"]);
  });

  it("niesie `og:site_name` - udostępnienie wychodzi z marką", async () => {
    const loaderData = await storyLoaderData();
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect(metaContent(head, "property", "og:site_name")).toBe("New European Strategies");
  });

  it("GŁOSI równoległy dokument AMP linkiem `amphtml`", async () => {
    // Bez tego linku cała inwestycja w format przepada: Google nie ma jak
    // znaleźć dokumentu `<amp-story>`, a więc nie zakwalifikuje historii
    // do karuzeli Web Stories.
    const loaderData = await storyLoaderData();
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect(linkHref(head, "amphtml")).toBe(`/web-stories/${SLUG}/amp`);
  });

  it("węzeł CreativeWork niesie nazwę, okładkę i datę publikacji", async () => {
    const loaderData = await storyLoaderData();
    const node = jsonLdNode(routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData }));

    expect(node["@type"]).toBe("CreativeWork");
    expect(node.name).toBe("Zima bez gazu");
    expect(node.image).toBe("https://obrazy.example.org/zima.jpg");
    expect(node.datePublished).toBe("2026-02-01T09:00:00.000Z");
  });

  it("historia BEZ opisu dostaje zdanie zapasowe w OBU językach, nie pusty opis", async () => {
    // Pusty `description` w wyniku wyszukiwania to wynik bez zajawki, a
    // zajawka decyduje o tym, czy ktoś w ten wynik kliknie.
    h.stories = [story({ description_pl: "", description_en: "" })];
    const loaderData = await storyLoaderData();

    expect(
      metaContent(
        routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData }),
        "name",
        "description",
      ),
    ).toBe("Web story New European Strategies.");

    h.requestUrl = `https://nes.example.org/en/web-stories/${SLUG}`;
    expect(
      metaContent(
        routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData }),
        "name",
        "description",
      ),
    ).toBe("A web story by New European Strategies.");
  });

  it("BEZ danych loadera nagłówek WYCHODZI Z INDEKSU zamiast zostawiać pusty tytuł", () => {
    // `head()` bywa wołane bez ładunku loadera (404, przerwana nawigacja).
    // Strona bez historii nie ma czego obiecywać.
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG } });

    expect(headTitle(head)).toBe("Web Story");
    expect(metaContent(head, "name", "robots")).toBe("noindex");
    expect(metaContent(head, "name", "description")).toBe("Ta historia jest niedostępna.");
  });

  it("BEZ danych loadera wersja angielska też mówi po angielsku", () => {
    h.requestUrl = `https://nes.example.org/en/web-stories/${SLUG}`;
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG } });

    expect(metaContent(head, "name", "description")).toBe("This web story is unavailable.");
    expect(metaContent(head, "name", "robots")).toBe("noindex");
  });

  it("historia BEZ okładki nie GŁOSI dokumentu AMP i nie preloaduje niczego", async () => {
    // Dokument AMP bez okładki nie przechodzi walidacji Web Stories, więc
    // link `amphtml` byłby obietnicą bez pokrycia.
    h.stories = [story({ cover_url: null })];
    const loaderData = await storyLoaderData();
    const head = routeHead(WebStoryRoute, { params: { slug: SLUG }, loaderData });

    expect((head.links ?? []).some((l) => l.rel === "amphtml")).toBe(false);
    expect((head.links ?? []).some((l) => l.rel === "preload")).toBe(false);
  });
});

// ── N5: LICZBA ZAPYTAŃ NA PIERWSZYM WCZYTANIU `/web-stories/$slug` ──────────
//
// POMIAR, NIE OPINIA. `measureFirstPaint` rozdziela FALĘ LOADERA od FALI
// KLIENTA (round-tripy PO hydratacji, każdy z pełnym opóźnieniem sieci
// czytelnika). Rozdzielenie działa, bo loader zasiewa cache zapytań, a ten
// jedzie do przeglądarki w dehydrowanym ładunku SSR.
//
// BUDŻETY PLATFORMY: ROOT_WARM_BUDGET_MS 2500, SSR_DB_DEADLINE_MS 8000, limit
// 6 równoległych subrequestów na żądanie na Workers. Root loader zużywa część
// tego limitu na rozgrzewkę chrome, więc każde zapytanie dopisane do loadera
// trasy konkuruje z nim o miejsce.
//
// ZMIERZONE PRZED ZMIANĄ: loader 1 odczyt (`web_stories:slug`), klient
// 1 odczyt (`web_stories:latest:8` - sekcja „więcej historii").
// ZMIERZONE PO ZMIANIE: BEZ ZMIAN. To jest wynik pomiaru, nie brak pomiaru.
//
// ODRZUCENIE Z UZASADNIENIEM. `latestWebStoriesQueryOptions(8)` ZOSTAJE po
// stronie klienta i NIE wchodzi do loadera:
//   1. LISTA KOLUMN. Zapytanie ciągnie PEŁNE `FIELDS`, w tym kolumnę `pages` -
//      czyli CAŁĄ treść ośmiu historii (każda plansza z podpisami w dwóch
//      językach, adresami mediów i CTA). Przeniesienie go do loadera
//      wymieniłoby jeden round-trip po hydratacji na dziesiątki kilobajtów
//      w dehydrowanym ładunku SSR - na ścieżce krytycznej KAŻDEGO czytelnika,
//      w tym tych, którzy do rekomendacji nigdy nie doscrollują.
//   2. MIEJSCE NA STRONIE. Sekcja „więcej historii" jest POD przeglądarką
//      pełnoekranową, która otwiera się od razu (`open` startuje z `true`) -
//      czytelnik zobaczy ją dopiero po zamknięciu historii.
// Zapadka stoi więc na DZISIEJSZEJ liczbie jednego zapytania klienckiego,
// a nie na zerze - i pilnuje, żeby DRUGIE zapytanie klienckie nie weszło tu
// niezauważone.

/** Wynik pomiaru pierwszego wczytania: odczyty serwera kontra odczyty klienta. */
interface FirstPaintMeasurement {
  loaderReads: string[];
  clientReads: string[];
}

async function measureFirstPaint(slug = SLUG): Promise<FirstPaintMeasurement> {
  const queryClient = freshClient();
  const loader: unknown = WebStoryRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  await (
    loader as (ctx: {
      context: { queryClient: QueryClient };
      params: { slug: string };
    }) => Promise<unknown>
  )({ context: { queryClient }, params: { slug } });
  const loaderReads = [...h.reads];

  const view = await mountStory(slug, queryClient);
  await screen.findByRole("heading", { level: 1 });
  // Zapytania klienckie startują w efektach montażu - czekamy, aż cache
  // przestanie się zmieniać, inaczej pomiar liczyłby mniej, niż strona robi.
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

  return { loaderReads, clientReads: h.reads.slice(loaderReads.length) };
}

describe("trasa /web-stories/$slug - zapadka na liczbie zapytań pierwszego wczytania", () => {
  it("loader zasiewa HISTORIĘ - tytuł, opis i plansze są w HTML z serwera", async () => {
    const { loaderReads } = await measureFirstPaint();

    expect(loaderReads).toEqual(["web_stories:slug"]);
  });

  it("po hydratacji NIE pobiera tej samej historii drugi raz", async () => {
    // Zasiew loadera ma wartość tylko wtedy, gdy dane są po hydratacji
    // jeszcze świeże - `webStoryBySlugQueryOptions` deklaruje `staleTime`.
    const { clientReads } = await measureFirstPaint();

    expect(clientReads, `odczyty klienta: ${clientReads.join(", ")}`).not.toContain(
      "web_stories:slug",
    );
  });

  it("nie robi WIĘCEJ NIŻ JEDNO zapytanie klienckie na pierwszym wczytaniu", async () => {
    // ZAPADKA. Dopisanie tu drugiego `useQuery` bez zasiewu w loaderze ma
    // wywalić ten test, a nie przejść niezauważone.
    h.stories = [story(), story({ id: "s2", slug: "druga", title_pl: "Druga historia" })];
    const { clientReads } = await measureFirstPaint();

    expect(clientReads.length, `odczyty klienta: ${clientReads.join(", ")}`).toBeLessThanOrEqual(1);
  });

  it("rekomendacje ZOSTAJĄ klienckie - to jedyny dopuszczony round-trip", async () => {
    // Odrzucenie z uzasadnieniem (patrz komentarz nad tym blokiem): pełne
    // `pages` ośmiu historii dla sekcji pod pełnoekranową przeglądarką.
    const { loaderReads, clientReads } = await measureFirstPaint();

    expect(loaderReads).not.toContain("web_stories:latest:8");
    expect(clientReads).toEqual(["web_stories:latest:8"]);
  });

  it("KLUCZE indeksu i rekomendacji NIE kolidują - limit jest częścią klucza", async () => {
    // Indeks czyta 48 pozycji, rekomendacje 8. Wspólny klucz oznaczałby, że
    // wejście na historię PODMIENIA cache indeksu ośmioma pozycjami.
    const queryClient = freshClient();
    await mountIndex(queryClient);
    cleanup();
    await mountStory(SLUG, queryClient);
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));

    expect(queryClient.getQueryData(["web-stories", "latest", 48])).toBeDefined();
    expect(queryClient.getQueryData(["web-stories", "latest", 8])).toBeDefined();
  });

  it("INDEKS zasiewa listę i nie pobiera jej drugi raz po hydratacji", async () => {
    // Ten sam pomiar dla trasy indeksu: `loadResilient` rozgrzewa klucz
    // `["web-stories","latest",48]`, a `useSuspenseQuery` go czyta.
    const queryClient = freshClient();
    const loader: unknown = WebStoriesIndexRoute.options.loader;
    if (typeof loader !== "function") throw new Error("test: indeks nie ma loadera");
    await (loader as (ctx: { context: { queryClient: QueryClient } }) => Promise<unknown>)({
      context: { queryClient },
    });
    const loaderReads = [...h.reads];

    const view = await mountIndex(queryClient);
    await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(loaderReads).toEqual(["web_stories:latest:48"]);
    expect(h.reads.slice(loaderReads.length)).toEqual([]);
  });

  it("KONTROLA DODATNIA: bez zasiewu indeks JEDNAK pobiera listę z przeglądarki", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby atrapa
    // przestała liczyć odczyty.
    const view = await mountIndex(freshClient());
    await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));

    expect(h.reads).toContain("web_stories:latest:48");
  });
});

// ── EKRAN AWARII MÓWI W JĘZYKU CZYTELNIKA ──────────────────────────────────
//
// OBIE trasy web stories miały tu wadę i obie zostały naprawione w tej
// zmianie: indeks podawał tytuł awarii wpisany na sztywno po polsku
// („Nie udało się załadować listy"), a szczegół renderował SUROWY
// `error.message` z PostgREST - czyli jednocześnie wyciek szczegółów bazy
// i zdanie wyłącznie po angielsku, bez drogi powrotu. Język bierze się
// z ADRESU (`activeLang()`), nie z singletonu i18next - ten jest
// współdzielony między równoległymi żądaniami SSR w jednym workerze.
describe("trasy web stories - ekran awarii w obu językach", () => {
  /**
   * Komponent awarii trasy - STRAŻNIK, nie rzutowanie.
   *
   * Parametr jest `AnyRoute`, nie `typeof WebStoryRoute`: te dwie trasy mają
   * RÓŻNE typy `path` (`"/web-stories"` kontra `"/web-stories/$slug"`), więc
   * węższa sygnatura nie kompiluje się dla obu - `tsc --noEmit` to wyłapuje,
   * a vitest nie (nie typuje).
   */
  function errorComponentOf(route: AnyRoute): () => ReactElement {
    const component: unknown = route.options.errorComponent;
    if (typeof component !== "function") throw new Error("test: trasa nie ma errorComponent");
    return component as () => ReactElement;
  }

  it("indeks: po polsku polski tytuł awarii, po angielsku angielski", () => {
    const Component = errorComponentOf(WebStoriesIndexRoute);

    h.requestUrl = "https://nes.example.org/web-stories";
    render(<Component />);
    expect(h.errorTitles.at(-1)).toBe("Nie udało się załadować listy");

    h.requestUrl = "https://nes.example.org/en/web-stories";
    render(<Component />);
    expect(h.errorTitles.at(-1)).toBe("Failed to load the list");
  });

  it("szczegół: NIE pokazuje surowego komunikatu bazy, tylko brandowy tytuł", () => {
    // Regresja na wycieku: `error.message` renderowany wprost pokazywał
    // czytelnikowi treść odmowy PostgREST.
    const Component = errorComponentOf(WebStoryRoute);

    h.requestUrl = `https://nes.example.org/web-stories/${SLUG}`;
    const pl = render(<Component />);
    expect(h.errorTitles.at(-1)).toBe("Nie udało się załadować historii");
    expect(pl.container.textContent).not.toContain("row-level");

    h.requestUrl = `https://nes.example.org/en/web-stories/${SLUG}`;
    render(<Component />);
    expect(h.errorTitles.at(-1)).toBe("Failed to load the story");
  });
});
