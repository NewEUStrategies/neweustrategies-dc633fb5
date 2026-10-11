// Public HTML site map (/sitemap, /en/sitemap) - the human- and AI-readable
// counterpart of sitemap.xml: every reachable published page (hierarchy
// preserved), the static code routes, categories and the latest posts on one
// flat-crawlable page - each URL once and at its final address (no 301 hops).
// Good for visitors (orientation), for crawl depth (every URL reachable within
// two clicks) and for answer engines mapping the site's structure (GEO).
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  blogListQueryOptions,
  publicCategoriesQueryOptions,
  publicPagesTreeQueryOptions,
  type BlogListItem,
  type PublicSiteMapCategory,
} from "@/lib/queries/public";
import {
  planSiteMap,
  postCanonicalPath,
  type PageTreeNode,
  type PageTreeRow,
} from "@/lib/seo/pageTree";
import { configuredHomepagePageId, type HomepageReadingSettings } from "@/lib/seo/homepagePage";
import { NOINDEX_CODE_ROUTE_PATHS } from "@/lib/seo/noindexCodeRoutes";
import { getSiteMapRedirects, type SiteMapRedirects } from "@/lib/seo/siteMapRedirects.functions";
import { siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import {
  AI_TRANSPARENCY_META,
  CLUBS_META,
  COMMUNICATIONS_META,
  DATA_PROCESSING_META,
  EVENTS_META,
  MODERATION_META,
  PRIVACY_GOVERNANCE_META,
  RODO_META,
  STATUTE_META,
  SUBSCRIPTIONS_META,
} from "@/lib/legal/meta";
import { buildContentHead } from "@/lib/seo/meta";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { anyDegraded, loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import { useDegradedUntilHealed } from "@/lib/ssr/useDegradedUntilHealed";
import { DegradedDataNotice } from "@/components/molecules/DegradedDataNotice";

/** Wspólny termin trzech zapytań mapy - biegną równolegle, więc jeden budżet. */
const SITEMAP_SSR_BUDGET_MS = 2_000;

// FALLBACKI ZASIEWANE PRZY DEGRADACJI - puste struktury DOKŁADNIE w typach
// trzech zapytań mapy. `loadResilient` wpisuje je ze stemplem `updatedAt: 0`,
// więc `useSuspenseQuery` w komponencie widzi stan `success` i renderuje bez
// zawieszenia, a przeglądarka i tak refetchuje je zaraz po hydratacji.
const NO_PAGES: PageTreeRow[] = [];
const NO_CATEGORIES: PublicSiteMapCategory[] = [];
const NO_POSTS: { posts: BlogListItem[] } = { posts: [] };

export const COPY = {
  pl: {
    title: "Mapa strony",
    description: "Pełna mapa serwisu: wszystkie strony, kategorie i najnowsze artykuły.",
    pages: "Strony",
    categories: "Kategorie",
    posts: "Najnowsze artykuły",
    home: "Strona główna",
    blog: "Blog",
    community: "Społeczność",
    legal: "Dokumenty i zasady",
    degraded: "Nie udało się załadować pełnej mapy strony",
  },
  en: {
    title: "Site map",
    description: "The full site map: every page, category and the latest articles.",
    pages: "Pages",
    categories: "Categories",
    posts: "Latest articles",
    home: "Home",
    blog: "Blog",
    community: "Community",
    legal: "Policies and documents",
    degraded: "Couldn't load the full site map",
  },
} as const;

// Huby treści - trasy kodowe sekcji „Strony", prawdziwe niezależnie od bazy.
// Programy i Web Stories dołączyły w 2026-10 (audyt mapy HTML): sekcja `core`
// mapy XML ogłaszała je od dawna, a mapa dla ludzi i modeli nie miała do nich
// ani jednego linku.
const HUB_LINKS = [
  { href: "/", pl: COPY.pl.home, en: COPY.en.home },
  { href: "/blog", pl: COPY.pl.blog, en: COPY.en.blog },
  { href: "/programs", pl: "Programy badawcze", en: "Research programs" },
  { href: "/web-stories", pl: "Web Stories", en: "Web Stories" },
] as const;

// Publiczne powierzchnie modułu społeczności - statyczne trasy z własnym SEO.
const COMMUNITY_LINKS = [
  { href: "/events", pl: "Wydarzenia", en: "Events" },
  { href: "/qa", pl: "Sesje Q&A", en: "Q&A sessions" },
  { href: "/polls", pl: "Ankiety", en: "Polls" },
  { href: "/tracker", pl: "Tracker legislacyjny UE", en: "EU policy tracker" },
  { href: "/experts", pl: "Eksperci", en: "Experts" },
  { href: "/people", pl: "Katalog osób", en: "People directory" },
  { href: "/contribute", pl: "Zostań kontrybutorem", en: "Become a contributor" },
  { href: "/podcasts", pl: "Podcasty", en: "Podcasts" },
  { href: "/live", pl: "Relacje na żywo", en: "Live blogs" },
] as const;

// Dokumenty prawne będące trasami REACT (pakiet zgodności 2026-09) - ten sam
// zbiór, który ogłasza sekcja `core` mapy XML. Nie są wierszami `pages`, więc
// drzewo stron ich nie widzi. Tytuły z lekkiego `lib/legal/meta.ts` (bez pełnej
// treści dokumentów), czyli dokładnie te, które stoją w `<title>` każdej z tras.
const LEGAL_LINKS = [
  { href: "/rodo", meta: RODO_META },
  { href: "/zarzadzanie-polityka-prywatnosci", meta: PRIVACY_GOVERNANCE_META },
  { href: "/polityka-przetwarzania-danych", meta: DATA_PROCESSING_META },
  { href: "/komunikacja-i-marketing", meta: COMMUNICATIONS_META },
  { href: "/regulamin-klubow-dyskusyjnych", meta: CLUBS_META },
  { href: "/moderacja-komentarzy", meta: MODERATION_META },
  { href: "/regulamin-wydarzen-i-biletow", meta: EVENTS_META },
  { href: "/regulamin-subskrypcji-i-zakupow", meta: SUBSCRIPTIONS_META },
  { href: "/przejrzystosc-ai", meta: AI_TRANSPARENCY_META },
  { href: "/statut", meta: STATUTE_META },
] as const;

/** Każdy adres trasy kodowej linkowany przez mapę - w kolejności renderu. */
const STATIC_HREFS: readonly string[] = [
  ...HUB_LINKS.map((link) => link.href),
  ...COMMUNITY_LINKS.map((link) => link.href),
  ...LEGAL_LINKS.map((link) => link.href),
];

// TRASY KODOWE PRZEKIEROWANE NA STRONY CMS. Middleware przekierowań
// przechwytuje część tych adresów, zanim dojdzie do routera (na produkcji
// `/events` -> 301 `/wydarzenia`, `/statut` -> 301 `/o-nas`), więc mapa
// linkowałaby je przez przekierowanie obok samej strony docelowej. Reguły są
// PER NAJEMCA i edytowalne w panelu - czytamy je z serwera
// (`getSiteMapRedirects`, ten sam indeks co middleware) zamiast trzymać kopię
// w kodzie (przegląd 2026-10). `planSiteMap` stosuje regułę tylko wtedy, gdy
// strona docelowa jest opublikowana; awaria odczytu = `{}`, czyli linki tras
// zostają (lepiej link przez 301 niż zniknięcie działającej strony).
const NO_REDIRECTS: SiteMapRedirects = {};

const siteMapRedirectsQueryOptions = () =>
  queryOptions({
    queryKey: ["public", "sitemap-redirects"] as const,
    queryFn: (): Promise<SiteMapRedirects> =>
      getSiteMapRedirects({ data: { paths: [...STATIC_HREFS] } }),
    staleTime: 5 * 60_000,
  });

/** `site_settings["reading"]` z rozgrzanej przez root mapy ustawień; brak = `{}`. */
function readingSettingsOf(settings: SettingsMap | undefined): HomepageReadingSettings {
  const reading = settings?.["reading"];
  return typeof reading === "object" && reading !== null
    ? (reading as HomepageReadingSettings)
    : {};
}

export const Route = createFileRoute("/sitemap")({
  loader: async ({ context }) => {
    // KOLEJNOŚĆ JEST CAŁĄ NAPRAWĄ. Do 2026-09-12 `setCacheControlHeader(
    // contentCacheControl())` było PIERWSZĄ instrukcją tego loadera, a trzy
    // zapytania budujące CAŁĄ treść mapy leciały po nim w `Promise.allSettled`
    // bez sprawdzenia wyniku. Odrzucenie któregokolwiek dawało mapę bez stron,
    // bez kategorii albo bez wpisów - przy statusie 200 i z nagłówkiem
    // pozwalającym brzegowi trzymać ten kadłubek przez 15 minut świeżości plus
    // dobę okna stale. Mapa strony jest powierzchnią, z której crawler czerpie
    // strukturę serwisu, więc jej okrojona wersja w cache'u kosztuje indeks.
    //
    // CZEGO NIE ZAŁATWIŁ SAM BUDŻET (regresja 2026-09-20, naprawiona tutaj).
    // Wariant pośredni owijał `Promise.allSettled` w `settleWithinBudget`, więc
    // po terminie LOADER oddał sterowanie - ale NIE anulował spóźnionych fetchów
    // i NIE zasiewał żadnych danych. Komponent czyta te same trzy klucze przez
    // `useSuspenseQuery`, więc render i tak zawieszał się na tych samych, wciąż
    // biegnących zapytaniach: budżet skracał wyłącznie czas do NAGŁÓWKA, a nie
    // do pierwszego bajtu. Zmierzone na serwerze deweloperskim z poświadczeniami
    // zastępczymi (każde zapytanie pada): `curl /sitemap` powyżej 90 s i dokument
    // BEZ `<h1>`, bo render nie ruszył nawet z samą powłoką.
    //
    // CO JEST TERAZ: trzy równoległe `loadResilient` pod JEDNYM terminem. Prymityw
    // anuluje spóźniony fetch PRZED zasiewem fallbacku (inaczej rozstrzygnięcie
    // między renderem a dehydracją rozjechałoby hydratację), więc komponent
    // renderuje się natychmiast - mapą okrojoną, ale z pełną nawigacją statyczną
    // i nagłówkiem `<h1>` - a klient dociąga dane po hydratacji (`updatedAt: 0`).
    // Render zdegradowany wychodzi z `no-store`, więc nie utrwala się na brzegu.
    const queryClient = context.queryClient;
    // Termin liczony BEZWARUNKOWO: `loadResilient` honoruje go wyłącznie
    // w renderze serwerowym, a w przeglądarce czeka na zapytanie (patrz nagłówek
    // `lib/ssr/resilientLoad.ts`), więc bramkowanie pod `isServer` byłoby tu
    // martwym kodem. Trzy zapytania dzielą JEDEN termin, bo biegną równolegle -
    // sekwencyjne `await` sumowałoby budżety i samo stałoby się źródłem TTFB.
    const deadlineAt = Date.now() + SITEMAP_SSR_BUDGET_MS;
    const [pages, categories, posts, redirects] = await Promise.all([
      loadResilient(queryClient, publicPagesTreeQueryOptions(), NO_PAGES, {
        deadlineAt,
        label: "sitemap.pages",
      }),
      loadResilient(queryClient, publicCategoriesQueryOptions(), NO_CATEGORIES, {
        deadlineAt,
        label: "sitemap.categories",
      }),
      loadResilient(queryClient, blogListQueryOptions(), NO_POSTS, {
        deadlineAt,
        label: "sitemap.posts",
      }),
      loadResilient(queryClient, siteMapRedirectsQueryOptions(), NO_REDIRECTS, {
        deadlineAt,
        label: "sitemap.redirects",
      }),
    ]);
    // Reguły przekierowań wchodzą do sygnału degradacji (krótki TTL), ale nie
    // dostają własnej sekcji ani komunikatu: fallback `{}` tylko zostawia
    // linki tras, niczego nie chowa.
    const degraded = anyDegraded(pages, categories, posts, redirects);
    setCacheControlHeader(resilientCacheControl(degraded));
    // FLAGI JADĄ DO KOMPONENTU tym samym kontraktem co `/experts` i `/glossary`:
    // pusta mapa z awarii ma dać się odróżnić od pustej mapy z redakcji. Bez
    // tego zasiany fallback wyglądał dokładnie jak prawda - sekcja wpisów pusta,
    // a kategorie z myślnikiem „brak" - czyli transport był naprawiony, a warstwa
    // treści kłamała (recenzja Codeksa, P2).
    //
    // PER SEKCJĄ, nie jedną flagą na całą trasę: zapytania są niezależne, więc
    // blip kategorii nie ma prawa ukryć stron ani wpisów, które backend oddał
    // w komplecie. `degraded` zostaje jako zbiorczy sygnał dla komunikatu.
    return {
      degraded,
      degradedSections: {
        pages: pages.degraded,
        categories: categories.degraded,
        posts: posts.degraded,
      },
    };
  },
  head: () => {
    const url = getRequestUrl() || "/sitemap";
    const lang = activeLang(url);
    const copy = COPY[lang];
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: `${copy.title} - New European Strategies`,
      description: copy.description,
    });
  },
  component: SiteMapPage,
});

const LINK_CLASS = "text-sm hover:text-brand hover:underline";

function PageTreeList({ nodes, lang }: { nodes: PageTreeNode[]; lang: "pl" | "en" }) {
  if (!nodes.length) return null;
  return (
    <ul className="space-y-1.5 pl-4 border-l border-border">
      {nodes.map((node) => (
        <li key={node.id}>
          {/* The universal splat route serves arbitrary page paths; the router
              output rewrite localizes the href ("/en/..." for EN) for free. */}
          <Link to="/$" params={{ _splat: node.path.replace(/^\//, "") }} className={LINK_CLASS}>
            {(lang === "en" ? node.title_en || node.title_pl : node.title_pl || node.title_en) ||
              node.slug}
          </Link>
          {node.children.length > 0 && (
            <div className="mt-1.5">
              <PageTreeList nodes={node.children} lang={lang} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Link wpisu na jego KANONICZNY adres (ścieżka strony-rodzica + slug).
 *
 * Do 2026-10 każdy wpis linkował `/post/<slug>` - alias, który odpowiada
 * 301 na adres kanoniczny (`routes/post.$slug.tsx`). Mapa, z której crawler
 * czerpie strukturę serwisu, kierowała go więc przez przekierowanie na każdym
 * z artykułów. Alias zostaje WYŁĄCZNIE jako zapas, gdy rodzica nie ma
 * w drzewie (noindex, nieopublikowany, poza oknem zapytania) - wtedy to on
 * rozwiąże adres po stronie serwera.
 */
function PostLink({
  path,
  slug,
  children,
}: {
  path: string | null;
  slug: string;
  children: string;
}) {
  if (path) {
    return (
      // Trasa uniwersalna + przepisanie wyjścia routera = prefiks `/en` za darmo.
      <Link
        to="/$"
        params={{ _splat: path.replace(/^\//, "") }}
        className={`${LINK_CLASS} min-w-0`}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link to="/post/$slug" params={{ slug }} className={`${LINK_CLASS} min-w-0`}>
      {children}
    </Link>
  );
}

function SiteMapPage() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const copy = COPY[lang];
  const { degradedSections } = Route.useLoaderData();
  // FABRYKI KLUCZA WOŁANE W MIEJSCU WYWOŁANIA, nie przez zmienną pomocniczą:
  // raport `scripts/report-public-route-loaders.ts` (i zapadka per trasa
  // w `lib/ci/publicRouteLoaders.ts`) dopasowuje NAZWY fabryk użyte w loaderze
  // i w `useSuspenseQuery` tego samego pliku. Zmienna między nimi zrywa to
  // dopasowanie i trasa wypada z rozgrzanych na „loader tych kluczy nie grzeje".
  const { data: pageRows } = useSuspenseQuery(publicPagesTreeQueryOptions());
  const { data: categories } = useSuspenseQuery(publicCategoriesQueryOptions());
  // Organizacja ma profil niezależny od wpisów; archiwum kategorii bez wpisów
  // to strona „Brak opublikowanych wpisów." - mapa jej nie linkuje.
  const listedCategories = categories.filter((c) => c.kind === "organization" || c.has_posts);
  const { data: blog } = useSuspenseQuery(blogListQueryOptions());

  // BRAMKI WIDOKU LICZONE ZE STANU ZAPYTAŃ, NIE Z ŁADUNKU LOADERA (recenzja
  // Codeksa na PR #383, P2). Trzy zasiewy mają stempel `updatedAt: 0`, więc
  // `useSuspenseQuery` wyżej dociąga każdy z nich zaraz po hydratacji - a
  // `degradedSections` z `loaderData` jest NIEZMIENNE, przez co odzyskane
  // kategorie i wpisy zostawały ukryte, a komunikat wisiał aż do
  // `router.invalidate()` albo przeładowania. Flagi loadera są tu wyłącznie
  // stanem POCZĄTKOWYM: na serwerze i w pierwszym renderze klienta dają
  // dokładnie tę samą decyzję (patrz `lib/ssr/useDegradedUntilHealed.ts`),
  // a od pierwszego renderu po hydratacji rozstrzyga stempel zapytania.
  //
  // PER SEKCJĄ, bo zapytania są niezależne: wyleczone kategorie nie mogą czekać
  // na wpisy. Komunikat zbiorczy znika dopiero, gdy wyleczy się WSZYSTKO, i do
  // tej chwili niesie ponowienie WSZYSTKICH trzech.
  const pagesState = useDegradedUntilHealed(
    publicPagesTreeQueryOptions().queryKey,
    degradedSections.pages,
  );
  const categoriesState = useDegradedUntilHealed(
    publicCategoriesQueryOptions().queryKey,
    degradedSections.categories,
  );
  const postsState = useDegradedUntilHealed(
    blogListQueryOptions().queryKey,
    degradedSections.posts,
  );
  const degraded = pagesState.degraded || categoriesState.degraded || postsState.degraded;
  const retryAll = () => {
    pagesState.retry();
    categoriesState.retry();
    postsState.retry();
  };

  // STRONA GŁÓWNA Z USTAWIEŃ CZYTANIA, NIE ZE SLUGU. Do 2026-10 filtr miał
  // wpisany na sztywno slug `home`, a produkcja serwuje pod `/` stronę `main`
  // - mapa pokazywała więc drugą „Stronę główną" pod `/main` (duplikat `/`
  // z własnym kanonicznym adresem). Ustawienia czytamy z mapy `site_settings`,
  // którą loader `__root.tsx` grzeje (albo zasiewa pustą) na każdej trasie,
  // więc to zero dodatkowych zapytań; brak mapy = `{}`, czyli rezolucja
  // historyczna (strona `home`), dokładnie jak w zapytaniu strony głównej.
  const { data: settings } = useQuery(siteSettingsQueryOptions);
  const { data: redirects } = useQuery(siteMapRedirectsQueryOptions());
  const plan = planSiteMap(pageRows, {
    homepageId: configuredHomepagePageId(readingSettingsOf(settings), pageRows),
    staticHrefs: STATIC_HREFS,
    legacyRedirects: redirects ?? NO_REDIRECTS,
    noindexPaths: NOINDEX_CODE_ROUTE_PATHS,
  });
  const { tree } = plan;
  const hubLinks = HUB_LINKS.filter((link) => plan.staticHrefs.has(link.href));
  const communityLinks = COMMUNITY_LINKS.filter((link) => plan.staticHrefs.has(link.href));
  const legalLinks = LEGAL_LINKS.filter((link) => plan.staticHrefs.has(link.href));

  return (
    <div className="flex flex-col bg-background text-foreground" data-page-template="sitemap">
      <div className="flex-1 max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
        <h1 className="font-display text-4xl lg:text-5xl mb-2">{copy.title}</h1>
        <p className="text-sm text-muted-foreground mb-8">{copy.description}</p>

        {degraded && (
          // Wariant INLINE, nie `page`: `<h1>`, opis i nawigacja statyczna są
          // prawdziwe niezależnie od backendu, więc podmiana całej strony
          // zabrałaby czytelnikowi (i crawlerowi) treść, która dojechała.
          <div className="mb-8">
            <DegradedDataNotice title={copy.degraded} onRetry={retryAll} />
          </div>
        )}

        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {/* Sekcja STRON zostaje zawsze, także przy degradacji: huby („Strona
              główna", „Blog", programy, Web Stories) to trasy statyczne,
              prawdziwe niezależnie od backendu, a `PageTreeList` przy pustym
              drzewie nie renderuje NIC - żadna pustka nie udaje tu więc danych.
              Ukrycie tej sekcji zabrałoby crawlerowi linki, które właśnie po to
              tu stoją. */}
          <section aria-labelledby="sitemap-pages">
            <h2 id="sitemap-pages" className="font-display text-xl font-semibold mb-3">
              {copy.pages}
            </h2>
            <ul className="space-y-1.5 mb-1.5">
              {hubLinks.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className={LINK_CLASS}>
                    {lang === "en" ? link.en : link.pl}
                  </Link>
                </li>
              ))}
            </ul>
            <PageTreeList nodes={tree} lang={lang} />
          </section>

          <section aria-labelledby="sitemap-community">
            <h2 id="sitemap-community" className="font-display text-xl font-semibold mb-3">
              {copy.community}
            </h2>
            <ul className="space-y-1.5">
              {communityLinks.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className={LINK_CLASS}>
                    {lang === "en" ? link.en : link.pl}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Trasy kodowe, prawdziwe niezależnie od backendu - jak sekcja
              społeczności zostaje także przy degradacji. */}
          <section aria-labelledby="sitemap-legal">
            <h2 id="sitemap-legal" className="font-display text-xl font-semibold mb-3">
              {copy.legal}
            </h2>
            <ul className="space-y-1.5">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link to={link.href} className={LINK_CLASS}>
                    {link.meta[lang].title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Zdegradowany odczyt zawsze niesie PUSTY fallback, więc sekcja
              pokazałaby „brak kategorii" jako fakt. Chowamy ją - komunikat wyżej
              mówi, czego zabrakło, a klient dociąga listę po hydratacji. */}
          {!categoriesState.degraded && (
            <section aria-labelledby="sitemap-categories">
              <h2 id="sitemap-categories" className="font-display text-xl font-semibold mb-3">
                {copy.categories}
              </h2>
              <ul className="space-y-1.5">
                {listedCategories.map((c) => (
                  <li key={c.slug}>
                    <Link
                      to={c.kind === "organization" ? "/organization/$slug" : "/category/$slug"}
                      params={{ slug: c.slug }}
                      className="text-sm hover:text-brand hover:underline"
                    >
                      {(lang === "en" ? c.name_en || c.name_pl : c.name_pl || c.name_en) || c.slug}
                    </Link>
                  </li>
                ))}
                {!listedCategories.length && <li className="text-sm text-muted-foreground">-</li>}
              </ul>
            </section>
          )}

          {/* Jak wyżej: pusta lista wpisów z awarii jest nie do odróżnienia od
              serwisu bez ani jednego artykułu. */}
          {!postsState.degraded && (
            <section aria-labelledby="sitemap-posts" className="md:col-span-2 lg:col-span-1">
              <h2 id="sitemap-posts" className="font-display text-xl font-semibold mb-3">
                {copy.posts}
              </h2>
              <ul className="space-y-1.5">
                {blog.posts.map((post) => (
                  <li key={post.id} className="flex items-baseline gap-2">
                    <PostLink path={postCanonicalPath(plan.paths, post)} slug={post.slug}>
                      {(lang === "en"
                        ? post.title_en || post.title_pl
                        : post.title_pl || post.title_en) || post.slug}
                    </PostLink>
                    {post.published_at && (
                      <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        {post.published_at.slice(0, 10)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
