// @vitest-environment node
//
// PRELOADY OBRAZÓW W `<head>` DOKUMENTU WPISU - PEŁNY RENDER SERWEROWY, POLICZONE.
//
// SKĄD TEN PLIK. React 19 (Fizz) sam wstawia do `<head>` `<link rel="preload"
// as="image">` dla każdego eager `<img>` w dokumencie i deduplikuje je kluczem
// zasobu (`srcSet + "\n" + sizes`, bez `srcSet` - surowy `src`). Na każdym
// wpisie produkcja miała w `<head>` CZTERY preloady dwóch plików:
//   * okładkę dwa razy - auto-preload Reacta z `<img fetchPriority="high">`
//     `PostLayoutRenderer` ORAZ `imagePreloadLink` z `head()` trasy `$.tsx`
//     (link z `head()` idzie przez `HeadContent` jako zwykły hoistable, BEZ
//     deduplikacji z tamtym);
//   * logo motywu dwa razy - pasek mobilny `Header` dawał adres względny,
//     pasek czytania `ReadingHeader` absolutny (dwa klucze jednego pliku).
// Poprawka: `head()` nie emituje okładki (loader trzyma nagłówek HTTP `Link`
// dla 103 Early Hints / NES Edge Cache - wzór `blog.index.tsx`, PR #515), a oba
// paski biorą `src` logo ze wspólnego `lib/brand/headerLogo`. Testy tras
// i pasków dowodzą tego na deskryptorach i fragmentach; TEN plik liczy to, co
// faktycznie wychodzi w `<head>` całego dokumentu.
//
// KANDYDAT LCP (P1.4) I LOGO PASKA CZYTANIA. Okładka niesie `data-lcp-candidate`
// (`coverLcpCandidate` z `coverAboveBody`, `$.tsx`) - inaczej wpis w trybie bootu
// `lcp` nie miał żadnego kandydata i bootował po pierwszej klatce. Logo paska
// czytania jest LENIWE (pasek startuje ukryty, to ten sam plik co logo `Header`),
// więc React nie emituje dla niego preloadu: jedyny preload logo pochodzi
// z paska mobilnego `Header`. Dokument przechodzi reguły ścieżki LCP bramki
// `check:document-weight` (kandydat, eager poza kandydatem/logo powłoki, preload
// i nagłówek `Link` wyłącznie dla kandydata) liczone `analyzeDocument` na tym HTML-u
// z nagłówkiem `Link` loadera.
//
// CO JEST PRAWDZIWE. Korzeń aplikacji `__root.tsx` w całości: loader (fala
// ustawień, rozgrzewka chrome'u), `head()` (fonty, kanoniczne linki korzenia),
// `RootShell` z `<HeadContent />` i `RootComponent` z dostawcami, `SiteChrome`
// i PRAWDZIWYM `Header` (pasek mobilny z logo). Pod nim trasa `/$` z LOADEREM
// i `head()` wziętymi wprost z `Route.options` pliku `$.tsx`, w prawdziwym
// routerze serwerowym (`createRouter({ isServer: true })` + `router.load()`)
// i strumieniu `renderToReadableStream` czytanym do końca - wzorzec
// `rootRouterMount.test.tsx`. Treść trasy to PRAWDZIWY `PostLayoutRenderer`
// (z prawdziwym `ReadingHeader` i okładką `OptimizedImage`) z propsami
// liczonymi tak jak w gałęzi wpisu `ResolvedPage` - ten sam odczyt treści
// (`useSuspenseQuery` na kluczu loadera) i ustawień układu, te same
// `pickLayoutId`/`mergeOverrides`. Reszta `ResolvedPage` (meta, badge, treść,
// reklamy, sidebar) to akapit zastępczy: pełny `PublicPage` to ~60 modułów
// liści do zaatrapowania (`platformPublicRender.test.tsx`), a przedmiotem
// dowodu jest para okładka + logo.
//
// ATRAPY. Granice procesu: Supabase (wiersze ustawień, w tym logo motywu,
// i okładka - oba na ORIGINIE KANONICZNYM `/media/...`, czyli jedyny kształt,
// w którym `renderedMediaUrl` przepisuje adres i rozjazd względny/absolutny
// w ogóle może powstać), funkcja serwerowa menu, nagłówki odpowiedzi i adres
// żądania (poza zasięgiem żądania Start) oraz raport błędów (sieć). Do tego
// `isServer` (patrz atrapa) i para `headerLogo`/`ReadingHeader`, przezroczysta
// poza kontrolami negatywnymi logo.
//
// FIZZ WYDZIELA GRANICE. W dokumencie stoją `<template id="B:n">` i segmenty
// `$RC` (nagłówek, treść trasy, stopka). To NIE zawieszenia: powyżej
// `progressiveChunkSize` (12,8 kB, `<head>` aplikacji jest większy) React
// wypisuje KOMPLETNE granice osobno. Renderują się w tym samym przebiegu co
// powłoka, więc ich preloady obrazów są w preambule `<head>`. Pilnują tego
// dwie asercje: „w całym dokumencie tyle samo preloadów co w `<head>`" i test
// powłoki z wydzielaniem wyłączonym (okładka i oba paski bez zawieszenia).
//
// CZEGO TU NIE MA: kontroli `head()` pozostałych tras z okładką LCP (events,
// programs, podcast, podcasts, web-stories, club). Każda ma ją we własnym
// pliku testowym (`eventShellLoader`, `programsPublicRoutes`,
// `podcastEpisodeRoute`, `podcastShowRoute`, `webStoriesRoutes`,
// `clubSlugLayoutRoute` - układ klubu nie ma już `head()` w ogóle).
import { QueryClient, QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HeaderLogoVariants } from "@/lib/brand/headerLogo";

const h = vi.hoisted(() => ({
  /** Wiersze `site_settings` (klucz -> wartość), które widzi fala 1 korzenia. */
  settingsRows: [] as { key: string; value: unknown }[],
  /** Wartości nagłówka HTTP `Link` w kolejności `appendLinkHeader`. */
  linkHeaders: [] as string[],
  /** Wartości `setCacheControlHeader` - czy render jest czysty, a nie zdegradowany. */
  cacheControl: [] as string[],
  /** Zgłoszenia granic błędu - pusta lista = żaden fragment dokumentu nie padł. */
  platformErrors: [] as unknown[],
  /** KONTROLA NEGATYWNA 1: `head()` dokłada `imagePreloadLink` okładki (stan sprzed poprawki). */
  coverLinkInHead: false,
  /** KONTROLA NEGATYWNA 2: pasek czytania liczy logo sam, bez `renderedMediaUrl`. */
  rawReadingBarLogo: false,
  /** KONTROLA NEGATYWNA 3: logo paska czytania eager (stan sprzed P1.4 na wpisie). */
  eagerReadingBarLogo: false,
  /** Ustawiane na czas renderu `ReadingHeader` w kontroli 2 (patrz atrapa niżej). */
  inReadingBar: false,
}));

// `isServer` Z PRODUKCYJNEGO BUNDLA SERWERA. Warunek eksportu `development`
// (vitest) rozstrzyga go na `undefined`, a od niego zależy, czy korzeń CZEKA
// na rozgrzewkę chrome'u przed renderem i czy loader `$.tsx` zakłada termin
// żądania SSR. Bez tej wartości dokument byłby renderem „zdegradowanego
// chrome'u", a nie tym, który dostaje czytelnik. `loadServerRoute` zostaje.
vi.mock("@tanstack/router-core/isServer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/router-core/isServer")>()),
  isServer: true,
}));

// Prawdziwy transport zgłoszeń wychodzi do sieci; tu jest rejestrem.
vi.mock("@/lib/platform-error-reporting", () => ({
  reportPlatformError: (error: unknown) => {
    h.platformErrors.push(error);
  },
}));

// Menu chrome'u to funkcja serwerowa Start (bez jej runtime'u w teście): pusty
// wynik = menu nieskonfigurowane, zapytanie rozstrzygnięte, bramka chrome'u
// gotowa.
vi.mock("@/lib/menus/menu.functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/menus/menu.functions")>()),
  getMenuWithItems: async () => null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, supabaseAuthStub, ok } = await import("@/test/supabase");
  const from = supabaseFromStub();
  // Odczyt ustawień w chwili zapytania (atrapa powstaje przed ciałem modułu).
  from.setResponse("site_settings", () => ok(h.settingsRows));
  for (const table of ["site_design_tokens", "builder_popups", "newsletter_settings"]) {
    from.setResponse(table, ok([]));
  }
  // Brak wiersza układu = domyślne ustawienia (`defaultPostLayoutSettings`).
  from.setResponse("post_layout_settings", ok(null));
  return {
    supabase: {
      from: from.from,
      auth: {
        ...supabaseAuthStub(null),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({ unsubscribe: () => undefined }) }),
        subscribe: () => ({ unsubscribe: () => undefined }),
        unsubscribe: () => undefined,
      }),
      removeChannel: () => undefined,
      rpc: async () => ok(null),
    },
  };
});

// Nagłówki odpowiedzi jako rejestr: prawdziwe funkcje sięgają po żądanie Start,
// którego ten render nie ma (wzór `publicCatchAllRoute.test.tsx`).
vi.mock("@/lib/http/responseHeaders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http/responseHeaders")>()),
  setCacheControlHeader: (value: string) => {
    h.cacheControl.push(value);
  },
  appendLinkHeader: (value: string) => {
    h.linkHeaders.push(value);
  },
}));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => "https://neweuropeanstrategies.com/analizy/atom",
}));

// KONTROLA NEGATYWNA 2 bez kopii paska czytania. Poza nią obie atrapy są
// przezroczyste (prawdziwy helper, prawdziwy `ReadingHeader` jako element).
// W kontroli PRAWDZIWY `ReadingHeader` jest wołany jako funkcja w obrębie
// flagi `inReadingBar`, więc tylko jego odczyt logo dostaje stan sprzed
// wspólnego helpera - ten sam łańcuch wariantów BEZ `renderedMediaUrl`
// (dosłownie dawne wyrażenie z `ReadingHeader.tsx`). `Header` liczy dalej
// przez prawdziwy helper (adres względny).
vi.mock("@/lib/brand/headerLogo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/brand/headerLogo")>();
  return {
    ...actual,
    headerLogoSrc: (logo: HeaderLogoVariants | null | undefined, isDark: boolean): string => {
      if (!h.rawReadingBarLogo || !h.inReadingBar) return actual.headerLogoSrc(logo, isDark);
      const l = logo ?? {};
      return isDark
        ? l.mobile_dark || l.main_dark || l.mobile || l.main || ""
        : l.mobile || l.main || l.mobile_dark || l.main_dark || "";
    },
  };
});
// KONTROLA NEGATYWNA 3: drzewo zwrócone przez PRAWDZIWY `ReadingHeader` z każdym
// `<img>` przestawionym na `loading="eager"` - dokładnie atrybut sprzed poprawki,
// reszta paska bez zmian. Spacer idzie wyłącznie po `props.children` elementów
// (obraz logo stoi w dzieciach `<Link>`), komponentów nie renderuje.
vi.mock("@/components/share/ReadingHeader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/share/ReadingHeader")>();
  const { Children, cloneElement, isValidElement } = await import("react");
  type Node = import("react").ReactNode;
  const eagerImages = (node: Node): Node =>
    Children.map(node, (child) => {
      if (!isValidElement<{ children?: Node }>(child)) return child;
      if (child.type === "img") return cloneElement(child as never, { loading: "eager" });
      return child.props.children === undefined
        ? child
        : cloneElement(child, undefined, eagerImages(child.props.children));
    });
  const Real = actual.ReadingHeader;
  return {
    ...actual,
    ReadingHeader: (props: Parameters<typeof Real>[0]) => {
      if (h.eagerReadingBarLogo) return eagerImages(Real(props));
      if (!h.rawReadingBarLogo) return <Real {...props} />;
      h.inReadingBar = true;
      try {
        return Real(props);
      } finally {
        h.inReadingBar = false;
      }
    },
  };
});

import { Route as RootRoute } from "@/routes/__root";
import { Route as CatchAllRoute } from "@/routes/$";
import { PostLayoutRenderer } from "@/components/PostLayoutRenderer";
import { usePostLayoutSettings } from "@/hooks/usePostLayoutSettings";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { PUBLIC_MEDIA_ORIGIN } from "@/lib/media/publicUrl";
import {
  coverImageSizes,
  defaultPostLayoutSettings,
  findLayout,
  mergeOverrides,
  pickLayoutId,
  rendersCover,
} from "@/lib/postLayouts";
import { resolvedContentQueryOptions } from "@/lib/queries/public";
import { splatToSegments } from "@/lib/routing/publicSegments";
import { imagePreloadLink } from "@/lib/seo/meta";
import { resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { postItem, resolvedPost } from "@/test/platform/publicContentFixtures";
import { analyzeDocument, parseAttributes } from "../../../scripts/performance/documentWeight";

const SPLAT = "analizy/atom";
const LOGO_PATH = "/media/theme/logo/nes-horizontal.svg";
/** Logo tak, jak leży w `theme_options.logo` (stemplowane originem marki). */
const LOGO = `${PUBLIC_MEDIA_ORIGIN}${LOGO_PATH}`;
/** Okładka na originie kanonicznym `/media/...` - ma kandydatów `srcSet`. */
const COVER = `${PUBLIC_MEDIA_ORIGIN}/media/analizy/atom-okladka.jpg`;
const SITE_NAME = "New European Strategies";

h.settingsRows = [
  { key: "general", value: { site_name: SITE_NAME } },
  { key: "theme_options", value: { logo: { mobile: LOGO } } },
  // Nagłówek i stopka jako dokumenty buildera z jedną pustą sekcją (bez
  // widgetów - logo desktopowe buildera i tak jest leniwe), ticker wyłączony:
  // komplet danych chrome'u jest gotowy przed renderem, jak na rozgrzanym
  // izolacie.
  {
    key: "header",
    value: {
      builder_data: { version: 1, sections: [{ id: "hdr", kind: "section", children: [] }] },
      trending: { enabled: false },
    },
  },
  {
    key: "footer",
    value: {
      builder_data: { version: 1, sections: [{ id: "ftr", kind: "section", children: [] }] },
    },
  },
];

const POST = resolvedPost({ item: postItem({ cover_image_url: COVER }) });
const CONTENT_QUERY = resolvedContentQueryOptions(splatToSegments(SPLAT));

/**
 * Deskryptor okładki DOKŁADNIE taki, jaki `head()` dokładał przed poprawką
 * (`buildCoverPreload` w `$.tsx`: te same kandydaty i `sizes` co render).
 */
function coverDescriptor() {
  const format = POST.item.post_format;
  const preset = findLayout(format, pickLayoutId(defaultPostLayoutSettings(), format));
  return { href: COVER, imageSrcSet: buildImageSrcSet(COVER), imageSizes: coverImageSizes(preset) };
}

// --- zawężenia opcji trasy `$.tsx` (strażniki, nie rzutowania) --------------

type CatchAllLoader = (ctx: {
  params: { _splat?: string };
  context: { queryClient: QueryClient };
}) => Promise<unknown>;
type CatchAllHeadResult = Awaited<ReturnType<NonNullable<typeof CatchAllRoute.options.head>>>;
type CatchAllHead = (ctx: {
  loaderData: unknown;
  params: { _splat?: string };
}) => CatchAllHeadResult;

function isLoader(fn: unknown): fn is CatchAllLoader {
  return typeof fn === "function";
}
function isHead(fn: unknown): fn is CatchAllHead {
  return typeof fn === "function";
}

function catchAllLoader(): CatchAllLoader {
  const fn: unknown = CatchAllRoute.options.loader;
  if (!isLoader(fn)) throw new Error("test: trasa `/$` nie ma loadera");
  return fn;
}
function catchAllHead(): CatchAllHead {
  const fn: unknown = CatchAllRoute.options.head;
  if (!isHead(fn)) throw new Error("test: trasa `/$` nie ma `head()`");
  return fn;
}

// --- drzewo tras: prawdziwy korzeń + `/$` z loaderem i `head()` z `$.tsx` --

/** Gałąź wpisu `ResolvedPage` w części, która maluje okładkę i pasek czytania. */
function PostDocument() {
  // Ten sam odczyt co `ResolvedPage`: treść z klucza, który rozgrzał loader.
  const { data } = useSuspenseQuery(CONTENT_QUERY);
  const { data: layoutSettings } = usePostLayoutSettings();
  if (data?.kind !== "post" || !layoutSettings) {
    throw new Error("test: loader nie zostawił wpisu albo ustawień układu w cache'u");
  }
  const post = data.item;
  const overrides = post.layout_overrides ?? null;
  const format = overrides?.format ?? post.post_format ?? "standard";
  const layoutId = pickLayoutId(layoutSettings, format, overrides?.layout);
  return (
    <PostLayoutRenderer
      format={format}
      layoutId={layoutId}
      settings={mergeOverrides(layoutSettings, overrides)}
      title={post.title_pl}
      excerpt={post.excerpt_pl}
      coverImageUrl={post.cover_image_url}
      coverViewTransitionId={post.id}
      // `coverAboveBody` z `$.tsx` (treść jest tu akapitem, więc bez drugiego właściciela).
      coverLcpCandidate={rendersCover(findLayout(format, layoutId)) && !!post.cover_image_url}
      entityId={post.id}
      entityType="post"
      sidebarOverride={overrides?.has_sidebar ?? null}
      content={<p>Treść wpisu.</p>}
    />
  );
}

const postRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/$",
  loader: ({ params, context }) => catchAllLoader()({ params, context }),
  head: ({ loaderData, params }) => {
    const head = catchAllHead()({ loaderData, params });
    if (!h.coverLinkInHead) return head;
    // Dawne `links` z `$.tsx`: `[...head.links, imagePreloadLink(coverPreload)]`.
    return { ...head, links: [...(head.links ?? []), imagePreloadLink(coverDescriptor())] };
  },
  component: PostDocument,
});
const routeTree = RootRoute.addChildren([postRoute]);

async function readDocument(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    html += decoder.decode(chunk.value, { stream: true });
  }
  return html + decoder.decode();
}

/**
 * Dokument wpisu z serwera: świeży klient zapytań z treścią pod kluczem loadera
 * (tak jak cache dokumentów po `resolve_path`), `router.load()` (loader
 * korzenia i `$.tsx`), potem strumień Reacta czytany do końca.
 * `QueryClientProvider` stoi tam, gdzie w aplikacji wstawia go integracja
 * router<->query (`setupRouterSsrQueryIntegration`, `src/router.tsx`).
 * `progressiveChunkSize` - wyłącznie test powłoki; domyślnie wartość Reacta.
 */
async function renderPostDocument(progressiveChunkSize?: number): Promise<string> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(CONTENT_QUERY.queryKey, POST);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/${SPLAT}`] }),
    context: { queryClient },
    isServer: true,
  });
  await router.load();
  const stream = await renderToReadableStream(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
    { progressiveChunkSize },
  );
  return readDocument(stream);
}

// --- odczyt dokumentu ------------------------------------------------------

const headOf = (html: string) => html.slice(0, html.indexOf("</head>"));

/** Atrybuty (małe litery, encje zdjęte - parser bramki wagi) każdego `<link>` preloadu obrazu. */
const imagePreloads = (fragment: string) =>
  [...fragment.matchAll(/<link\b[^>]*>/gi)]
    .map((m) => parseAttributes(m[0]))
    .filter((a) => a["rel"] === "preload" && a["as"] === "image");

const images = (html: string) =>
  [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => parseAttributes(m[0]));

/** Obraz okładki: jedyny `<img fetchpriority="high">` dokumentu. */
function coverImage(html: string) {
  const covers = images(html).filter((a) => a["fetchpriority"] === "high");
  expect(covers, "dokładnie jeden obraz high - okładka wpisu").toHaveLength(1);
  return covers[0];
}

/** Preloady okładki: te, których `imagesrcset` to kandydaci jej `<img>`. */
const coverPreloads = (fragment: string, srcset: string | undefined) =>
  imagePreloads(fragment).filter((a) => !!srcset && a["imagesrcset"] === srcset);

/**
 * Preloady TEGO pliku logo: `href` rozwiązany względem originu kanonicznego,
 * więc para względny/absolutny liczy się jako dwa preloady jednego zasobu.
 */
const logoPreloads = (fragment: string) =>
  imagePreloads(fragment).filter(
    (a) => !a["imagesrcset"] && new URL(a["href"] ?? "", PUBLIC_MEDIA_ORIGIN).href === LOGO,
  );

/**
 * `<img>` pliku logo w PASKACH jako `{ alt, src, loading }`, po `alt`: pasek
 * czytania ma pusty (dekoracja obok tytułu), pasek mobilny `Header` - nazwę
 * serwisu. `loading` brakujący = domyślny eager (React emituje wtedy preload).
 * Znak w kaflu powłoki zgód (`ConsentMarkImage`: leniwy, bez preloadu) nie
 * wchodzi - jako jedyny ma wymiary kafla w `width`/`height`.
 */
const logoImages = (html: string) =>
  images(html)
    .filter((a) => !("width" in a))
    .filter((a) => new URL(a["src"] ?? "", PUBLIC_MEDIA_ORIGIN).href === LOGO)
    .map((a) => ({ alt: a["alt"], src: a["src"], loading: a["loading"] ?? "eager" }))
    .sort((a, b) => (a.alt ?? "").localeCompare(b.alt ?? ""));

/** Logo paska czytania (pusty `alt`) i paska mobilnego `Header` (nazwa serwisu). */
const READING_BAR_LOGO = { alt: "", src: LOGO_PATH, loading: "lazy" };
const HEADER_LOGO = { alt: SITE_NAME, src: LOGO_PATH, loading: "eager" };

/** Miara bramki `check:document-weight` na dokumencie i nagłówku `Link` loadera. */
const gateWeight = (html: string) =>
  analyzeDocument({ html, linkHeader: h.linkHeaders.join(", ") || null });

/** HTML powłoki: wszystko przed pierwszym segmentem granicy dosłanej później. */
const shellOf = (html: string) => {
  const firstSegment = html.indexOf('<div hidden id="S:');
  return firstSegment === -1 ? html : html.slice(0, firstSegment);
};

afterEach(() => {
  h.linkHeaders = [];
  h.cacheControl = [];
  h.platformErrors = [];
  h.coverLinkInHead = false;
  h.rawReadingBarLogo = false;
  h.eagerReadingBarLogo = false;
});

describe("SSR dokumentu wpisu: preloady obrazów w <head>", () => {
  it("okładka (kandydat LCP) i logo `Header` - po JEDNYM preloadzie, razem dwa; bramka wagi zielona", async () => {
    const html = await renderPostDocument();
    const head = headOf(html);

    // Dokument złożyły prawdziwy `RootShell` i prawdziwy render (nie granica błędu).
    expect(head).toMatch(/<script data-nes-probe=""/);
    expect(head).toContain(
      '<link rel="canonical" href="https://neweuropeanstrategies.com/analizy/atom"/>',
    );
    expect(h.platformErrors).toEqual([]);
    // Render CZYSTY, nie zdegradowany (ani `no-store`, ani krótka polityka
    // dostrumieniowanego chrome'u) - ten, który trafia do NES Edge Cache.
    expect(new Set(h.cacheControl)).toEqual(new Set([resilientCacheControl(false)]));

    // Okładka w treści: eager + high + kandydaci responsywni + znacznik kandydata
    // LCP (pusty atrybut, jak obraz widgetu-kandydata buildera).
    const cover = coverImage(html);
    expect(cover["loading"]).toBe("eager");
    expect(cover["srcset"]).toBe(buildImageSrcSet(COVER));
    expect(cover["sizes"]).toBe("100vw");
    expect(cover["data-lcp-candidate"]).toBe("");
    // Oba paski z logo w dokumencie, oba z TYM SAMYM względnym `src` (jeden wpis
    // cache'u), ale eager i z preloadem jest wyłącznie logo `Header`.
    expect(logoImages(html)).toEqual([READING_BAR_LOGO, HEADER_LOGO]);

    // JEDEN preload okładki - auto-preload Reacta (srcset + sizes + high).
    const [coverPreload, ...extraCover] = coverPreloads(head, cover["srcset"]);
    expect(extraCover).toEqual([]);
    expect(coverPreload).toMatchObject({ imagesizes: cover["sizes"], fetchpriority: "high" });
    // JEDEN preload logo, względny - z paska mobilnego `Header`.
    expect(logoPreloads(head).map((a) => a["href"])).toEqual([LOGO_PATH]);
    // I nic więcej: razem dwa, wszystkie w `<head>` (żaden spóźniony w treści).
    expect(imagePreloads(head)).toHaveLength(2);
    expect(imagePreloads(html)).toHaveLength(2);

    // Ta sama miara co bramka `check:document-weight` na artefakcie (dokument +
    // nagłówek `Link` loadera): zero duplikatów, jeden kandydat, a preload okładki
    // w `<head>` i w nagłówku `Link` ma klucz kandydata (reguła obrazu eager poza
    // kandydatem - test powłoki niżej).
    const weight = gateWeight(html);
    expect(weight.documentPreloadDuplicates).toBe(0);
    expect(weight.imagePreloadCount).toBe(3);
    expect(weight).toMatchObject({
      lcpCandidateCount: 1,
      lcpCandidateMissing: 0,
      imagePreloadNonCandidate: 0,
      linkHeaderDisallowed: 0,
    });

    // Droga przez nagłówki (103 Early Hints, NES Edge Cache) zostaje: loader
    // `$.tsx` oddał jeden nagłówek `Link` z TYM SAMYM kandydatem co preload
    // Reacta w `<head>` - przeglądarka nie pobierze drugiego wariantu.
    const imageHeaders = h.linkHeaders.filter((v) => v.includes('as="image"'));
    expect(imageHeaders).toHaveLength(1);
    expect(imageHeaders[0]).toContain(`imagesrcset="${cover["srcset"]}"`);
    expect(imageHeaders[0]).toContain(`imagesizes="${cover["sizes"]}"`);
  });

  it("powłoka: okładka i oba paski z logo renderują się bez zawieszenia", async () => {
    // Warunek tego, że auto-preloady Reacta trafiają do `<head>`: obrazy stoją
    // w powłoce, a nie w granicy, która CZEKA (jej preloady wyszłyby później,
    // w treści). Z wydzielaniem kompletnych granic wyłączonym powłoka to
    // wszystko, co nie czekało - i muszą w niej być okładka-kandydat oraz oba logo.
    const shell = shellOf(await renderPostDocument(1e9));

    const highImages = images(shell).filter((a) => a["fetchpriority"] === "high");
    expect(highImages).toHaveLength(1);
    expect(highImages[0]["data-lcp-candidate"]).toBe("");
    expect(logoImages(shell)).toEqual([READING_BAR_LOGO, HEADER_LOGO]);
    expect(imagePreloads(headOf(shell))).toHaveLength(2);

    // Reguła bramki „żaden obraz nie-leniwy poza kandydatem i logo w `<header
    // data-site-header>`" czyta SUROWY HTML. Z domyślnym `progressiveChunkSize`
    // Fizz w tym teście wydziela kompletną granicę `Header` jako segment ZA
    // `</header>` (wraca na miejsce dopiero skryptem `$RC`), więc logo nagłówka
    // stałoby w bajtach poza powłoką. Artefakt wpisu ma tę granicę w linii (pomiar
    // `check:document-weight --path /blog/fixture-2`: logo między `<header
    // data-site-header>` a `</header>`), czyli dokładnie układ tego renderu.
    expect(gateWeight(shell)).toMatchObject({
      lcpCandidateCount: 1,
      lcpCandidateMissing: 0,
      imgEagerNonCandidate: 0,
      imagePreloadNonCandidate: 0,
      linkHeaderDisallowed: 0,
    });
  });

  it("KONTROLA NEGATYWNA: `imagePreloadLink` okładki z powrotem w `head()` = DWA preloady okładki", async () => {
    h.coverLinkInHead = true;
    const html = await renderPostDocument();
    const head = headOf(html);

    const cover = coverImage(html);
    // React NIE scala linku z `head()` ze swoim preloadem - dokładnie defekt sprzed poprawki.
    expect(coverPreloads(head, cover["srcset"])).toHaveLength(2);
    expect(imagePreloads(head)).toHaveLength(3);
    const weight = analyzeDocument({ html });
    expect(weight.documentPreloadDuplicates).toBe(1);
    expect(weight.imagePreloadCount).toBe(3);
  });

  it("KONTROLA NEGATYWNA: pasek czytania z surowym adresem absolutnym = dwa klucze jednego pliku", async () => {
    h.rawReadingBarLogo = true;
    const html = await renderPostDocument();
    const head = headOf(html);

    // Pasek mobilny względny, pasek czytania absolutny - jeden plik, dwa klucze
    // cache'u: przy odsłonięciu paska drugie pobranie zamiast trafienia w plik
    // z preloadu `Header`. Asercja `logoImages` głównego testu to łapie.
    expect(logoImages(html)).toEqual([{ ...READING_BAR_LOGO, src: LOGO }, HEADER_LOGO]);
    // Leniwy pasek czytania nie dokłada już preloadu (dawniej: drugi `<link>`
    // z kluczem absolutnym w `<head>` każdego wpisu) - to robi tylko eager.
    expect(logoPreloads(head).map((a) => a["href"])).toEqual([LOGO_PATH]);
    expect(imagePreloads(head)).toHaveLength(2);
  });

  it("KONTROLA NEGATYWNA: eager logo paska czytania = obraz eager poza kandydatem i logo powłoki", async () => {
    h.eagerReadingBarLogo = true;
    // Układ powłoki jak w artefakcie (granica `Header` w linii - test powłoki wyżej).
    const html = shellOf(await renderPostDocument(1e9));
    const head = headOf(html);

    // Stan sprzed poprawki: oba logo eager z tym samym względnym `src`.
    expect(logoImages(html)).toEqual([{ ...READING_BAR_LOGO, loading: "eager" }, HEADER_LOGO]);
    // Preload nadal JEDEN (React deduplikuje po kluczu `src`), więc liczniki
    // preloadów tego nie widzą - widzi to reguła `imgEagerNonCandidate`: pasek
    // czytania stoi poza `<header data-site-header>` powłoki.
    expect(logoPreloads(head).map((a) => a["href"])).toEqual([LOGO_PATH]);
    expect(gateWeight(html)).toMatchObject({ imgEagerNonCandidate: 1, lcpCandidateCount: 1 });
  });
});
