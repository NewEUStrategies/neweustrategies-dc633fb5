import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useTransition } from "react";
import { useTranslation } from "react-i18next";

import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { useInFeedAds } from "@/components/ads/useInFeedAds";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PaginatedPostGrid } from "@/components/archive/PaginatedPostGrid";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { builderDocHasTopHeading } from "@/lib/builder/headings";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import { FootnotesList, FootnoteTooltips } from "@/components/Footnotes";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import {
  blogArchiveQueryOptions,
  BLOG_PAGE_SIZE,
  homePageQueryOptions,
  homepageModeQueryOptions,
  resolvePostsPerPage,
  type BlogArchiveResult,
  type HomepageMode,
  type PageData,
} from "@/lib/queries/public";
import { parsePageSearch } from "@/lib/routing/pageSearch";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, splitUrl, siteTitle, siteDescription } from "@/lib/seo/meta";
import {
  organizationJsonLd,
  safeJsonLd,
  siteNavigationJsonLd,
  webSiteJsonLd,
} from "@/lib/seo/jsonld";
import { FOOTER_LINKS, labelFor } from "@/lib/seo/footerNavigation";
import {
  resolveRobotsMeta,
  resolveSeoText,
  resolveSocialImage,
  seoCanonicalOverride,
} from "@/lib/seo/fields";
import { metaDescription } from "@/lib/routing/publicSegments";
import { parseSeoSettings } from "@/lib/seo/settings";
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";
import { errorCopy } from "@/lib/errorCopy";

// Keep route boundary declarations above createFileRoute. The production route
// splitter evaluates route options separately and a later declaration can be in
// the temporal dead zone while the generated route module is initialized.
function HomeErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const copy = errorCopy();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.errorTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.errorBody}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copy.tryAgain}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {copy.goHome}
          </a>
        </div>
      </div>
    </div>
  );
}

function HomeNotFoundComponent() {
  const copy = errorCopy();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {copy.notFoundTitle}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.notFoundBody}</p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          {copy.goHome}
        </a>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/")({
  // Paginacja trybu "najnowsze wpisy" żyje w URL-u (?page=N) - każda strona
  // wyników ma własny, indeksowalny i cache'owalny adres (ten sam kontrakt co
  // /blog; wspólny parser trzyma oba URL-e w identycznej semantyce). W trybie
  // strony statycznej parametr jest ignorowany przez render, a canonical i tak
  // wskazuje czysty "/" (splitUrl odcina query), więc nie tworzy duplikatów.
  validateSearch: parsePageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ context, deps }) => {
    // The homepage `/` is the single most important - and most requested -
    // route, so it MUST NOT be a single point of total failure (the same
    // reasoning the root loader spells out for its allSettled warm-up). A
    // transient backend blip on the critical fetch here (`homePageQueryOptions`
    // / `blogListQueryOptions` / `siteSettingsQueryOptions` all `throw` on a
    // PostgREST error) used to bubble out of SSR as an opaque h3 500. Worse,
    // the edge cache header was set at the TOP of this loader, BEFORE the
    // fetch - so a degraded render could be emitted with a long s-maxage /
    // stale-while-revalidate policy and re-served to everyone until
    // revalidation. Fetch defensively instead: settle what we can, seed safe
    // fallbacks for anything that fails, and gate the shared-cache header on
    // a clean render.
    const queryClient = context.queryClient;
    let homePage: PageData | null = null;
    let homeMode: HomepageMode = "";
    let degraded = false;

    // allSettled (never rejects) so one failing fetch cannot discard the other's
    // result. On a failure, seed the component's suspense query with a
    // success-state fallback so SSR renders a valid (empty) shell instead of
    // re-throwing during the render pass. `updatedAt: 0` marks the seeded data
    // immediately stale, so the browser refetches on mount and the homepage
    // self-heals once the backend recovers - no user action, no cached failure.
    const [homePageRes, homeModeRes] = await Promise.allSettled([
      queryClient.ensureQueryData(homePageQueryOptions()),
      queryClient.ensureQueryData(homepageModeQueryOptions()),
    ]);
    if (homePageRes.status === "fulfilled") {
      homePage = homePageRes.value;
    } else {
      degraded = true;
      queryClient.setQueryData(homePageQueryOptions().queryKey, null, { updatedAt: 0 });
    }
    if (homeModeRes.status === "fulfilled") {
      homeMode = homeModeRes.value;
    } else {
      degraded = true;
      queryClient.setQueryData(homepageModeQueryOptions().queryKey, "", { updatedAt: 0 });
    }

    // "Najnowsze wpisy" jako strona główna: SSR ładuje DOKŁADNIE żądaną stronę
    // wyników (?page=N) tym samym paginowanym zapytaniem co /blog - wpisy poza
    // pierwszą stroną mają z poziomu strony głównej realne, indeksowalne URL-e
    // (dawny płaski limit czynił je nieosiągalnymi). Rozmiar strony honoruje
    // posts_per_page z ustawień czytania; klucz zapytania musi być zgodny
    // z komponentem, także w ścieżce degradacji.
    if (homeMode === "latest_posts") {
      let pageSize = BLOG_PAGE_SIZE;
      try {
        pageSize = resolvePostsPerPage(await queryClient.ensureQueryData(siteSettingsQueryOptions));
      } catch {
        // Ustawienia niedostępne - komponent policzy to samo z pustej mapy.
      }
      const listOptions = blogArchiveQueryOptions({ page: deps.page, pageSize });
      try {
        await queryClient.ensureQueryData(listOptions);
      } catch {
        degraded = true;
        queryClient.setQueryData(
          listOptions.queryKey,
          { posts: [], total: 0, page: deps.page, pageSize } satisfies BlogArchiveResult,
          { updatedAt: 0 },
        );
      }
    }
    // Settle every data-bound widget query BEFORE the router dehydrates - the
    // same model as $.tsx. Settled queries ship as plain data in the initial
    // dehydrated payload and hydrate synchronously, so client hydration sees
    // exactly what the server rendered. A query still pending at dehydration
    // time travels over the async query STREAM instead; a widget reading it
    // hydrates against its skeleton while the server HTML has real content -
    // a mismatch React 19 answers by rebuilding the whole page client-side
    // (visible blank + full refetch; the old router-with-query bridge made
    // this the norm here). The prefetch runs in parallel with a hard budget
    // (see prefetchCachedRouteQueries) and is internally allSettled, so it can
    // never throw - and the homepage is edge-cached, so the cost is paid once
    // per revalidation, not per visitor. Anything past the budget still streams
    // via the ServerSectionGate as before. W trybie "najnowsze wpisy" homePage
    // jest null z konstrukcji (homePageQueryOptions), więc prefetch widgetów
    // buildera w ogóle nie startuje - zero zmarnowanych round-tripów.
    if (homePage && homePage.editor === "builder") {
      const doc = parseBuilderDoc(homePage.builder_data);
      if (doc.sections.length > 0) {
        const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
        await prefetchCachedRouteQueries(queryClient, doc, lang);
      }
    }
    // SEO settings (Organization sameAs / logo) for the homepage JSON-LD; the
    // bulk site_settings query is already warmed by the root loader. Purely
    // decorative structured data - never let it fail the whole homepage.
    let seoSettings = parseSeoSettings(null);
    try {
      const settingsMap = await queryClient.ensureQueryData(siteSettingsQueryOptions);
      seoSettings = parseSeoSettings(settingsMap["seo"]);
    } catch {
      // Fall back to defaults - JSON-LD without sameAs/logo is still valid. Also
      // seed the shared query with an empty map so the site chrome (<Header/>
      // reads this exact query via useSuspenseQuery) degrades to its defaults
      // instead of re-throwing during render and taking the whole page down.
      degraded = true;
      queryClient.setQueryData(siteSettingsQueryOptions.queryKey, Object.freeze({}), {
        updatedAt: 0,
      });
    }

    // ISR-like edge caching, set LAST so a degraded render is never shared-
    // cached: the homepage SSR is the anonymous shell, so a clean render is safe
    // to share-cache and serve stale-while-revalidate from the CDN. The language
    // lives in the URL path (PL at "/", EN at "/en"), so each variant is its own
    // cache entry - no cookie-driven personalization, no poisoning. A degraded
    // render opts out entirely (private, no-store) so the blip is never served
    // to the next visitor.
    setCacheControlHeader(
      degraded ? cacheControlHeader({ cacheable: false }) : contentCacheControl(),
    );
    return { seoSettings, homePage, page: deps.page };
  },

  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/";
    const lang = activeLang(url);
    // The homepage title/description default to the brand constants (kept in
    // sync with the root <head> fallback), but a static home page built in the
    // CMS builder is a first-class SEO citizen: its own SEO overrides, excerpt
    // (meta description), social image, canonical and noindex win when set.
    // No brand suffix here - the defaults already carry the brand. W trybie
    // "najnowsze wpisy" homePage jest z konstrukcji null (patrz
    // homePageQueryOptions), więc metadane spadają na czyste defaulty marki -
    // SEO ukrytej strony statycznej nie przecieka do listy wpisów.
    const homePage = loaderData?.homePage ?? null;
    const page = loaderData?.page ?? 1;
    const fallbackDescription =
      (homePage &&
        metaDescription(
          lang === "en"
            ? homePage.excerpt_en || homePage.excerpt_pl
            : homePage.excerpt_pl || homePage.excerpt_en,
          "",
        )) ||
      siteDescription(lang, url);
    const seo = homePage
      ? resolveSeoText(homePage, lang, siteTitle(lang, url), fallbackDescription)
      : { title: siteTitle(lang, url), description: fallbackDescription };
    const image = homePage ? resolveSocialImage(homePage, homePage.cover_image_url) : null;
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: seo.title,
      description: seo.description,
      image,
      // Strony wyników >1 (tryb "najnowsze wpisy") są noindex,follow - crawler
      // podąża za linkami do wpisów, ale indeks buduje wyłącznie strona
      // pierwsza (ten sam model co /blog; canonical i tak wskazuje czysty "/").
      robots: page > 1 ? "noindex, follow" : homePage ? resolveRobotsMeta(homePage) : null,
      canonicalOverride: homePage ? seoCanonicalOverride(homePage) : null,
    });
    const { origin } = splitUrl(url);
    if (!origin) return head;
    // Entity layer (GEO/AEO): Organization + WebSite with SearchAction. Per
    // Google's guidance these live on the homepage only - one strong entity
    // signal that knowledge graphs and AI assistants resolve the brand to.
    const seoSettings = loaderData?.seoSettings ?? parseSeoSettings(null);
    const organization = organizationJsonLd({
      origin,
      lang,
      sameAs: seoSettings.organization_same_as,
      logoUrl: seoSettings.publisher_logo_url.trim() || `${origin}/og-default.jpg`,
    });
    const footerNavItems = FOOTER_LINKS.map((l) => ({
      name: labelFor(l, lang),
      href: l.href,
    }));
    return {
      ...head,
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(organization) },
        { type: "application/ld+json", children: safeJsonLd(webSiteJsonLd(origin, lang)) },
        {
          type: "application/ld+json",
          children: safeJsonLd(siteNavigationJsonLd(origin, footerNavItems, lang)),
        },
      ],
    };
  },
  component: Index,
  errorComponent: HomeErrorComponent,
  notFoundComponent: HomeNotFoundComponent,
});

function Index() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: homePage } = useSuspenseQuery(homePageQueryOptions());
  const { data: homeMode } = useSuspenseQuery(homepageModeQueryOptions());

  const articleRef = useRef<HTMLDivElement>(null);

  const isLatestPosts = homeMode === "latest_posts";
  const isBuilderHome = !isLatestPosts && homePage?.editor === "builder";
  const builderData = isBuilderHome ? homePage.builder_data : null;

  // Strona główna to zwykły dokument buildera, więc przypisy `[fn]…[/fn]`
  // przechodzą przez TEN SAM helper co wpis i podgląd roboczy. Bez tego
  // shortcode w widgecie tekstowym homepage trafiał do publicznego obiegu
  // dosłownie (ustalenie §2.3 audytu z 2026-07-25).
  //
  // Parsowanie i pre-pass siedzą w JEDNYM `useMemo` kluczowanym surowym
  // `builder_data`: `parseBuilderDoc` zwraca nowy obiekt przy każdym wywołaniu,
  // więc trzymanie go poza memo unieważniałoby je w każdym renderze - a to
  // najczęściej odwiedzana trasa serwisu.
  const prepared = useMemo(
    () =>
      builderData
        ? prepareContentForRender({
            editor: "builder",
            builderDoc: parseBuilderDoc(builderData),
            blocksDoc: null,
            rawHtml: "",
            lang,
          })
        : null,
    [builderData, lang],
  );
  const doc = prepared?.builderDoc ?? null;
  const footnotes = prepared?.footnotes ?? [];

  return (
    <div data-theme-typography className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 w-full">
        {/* Screen-reader-only H1: strona główna MUSI eksponować opisowy nagłówek
            poziomu 1 - ale tylko wtedy, gdy dokument buildera sam żadnego nie
            renderuje. Bezwarunkowy `h1` dawał DWA nagłówki poziomu 1 na kanwie
            z własnym nagłówkiem (ten sam defekt, co na stronach buildera -
            audyt 2026-08-06, korekta 2). Inwariant jest jeden dla obu tras:
            dokładnie jeden `h1` (patrz `builderDocHasTopHeading`). */}
        {!builderDocHasTopHeading(doc) && (
          <h1 className="sr-only">
            {lang === "en"
              ? "New European Strategies - Strategic thinking, new perspectives"
              : "New European Strategies - Strategiczne myślenie, nowe perspektywy"}
          </h1>
        )}
        {isLatestPosts ? (
          <LatestPostsHome lang={lang} />
        ) : doc && doc.sections.length > 0 ? (
          // Streaming is deliberately DISABLED here: the loader already settles
          // every widget query before dehydration (see prefetchCachedRouteQueries),
          // and any streaming Suspense/Await boundary that rejects mid-flush can
          // corrupt the inline $_TSR.router bootstrap script and force React to
          // rebuild the whole page client-side (visible SSR flash + refetch).
          // Rendering eagerly keeps SSR HTML and client hydration in lockstep.
          <div ref={articleRef}>
            <BuilderRenderer doc={doc} lang={lang} />
            {footnotes.length > 0 && (
              <div className="max-w-[1400px] mx-auto px-4 lg:px-8">
                <FootnotesList notes={footnotes} lang={lang} />
                <FootnoteTooltips notes={footnotes} containerRef={articleRef} />
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
            <p className="text-sm">
              {lang === "en"
                ? "There's nothing here yet - please check back soon."
                : "Nie ma tu jeszcze treści - zajrzyj wkrótce."}
            </p>
          </div>
        )}
      </div>
      <FooterSlideup pageType="home" />
    </div>
  );
}

function LatestPostsHome({ lang }: { lang: "pl" | "en" }) {
  // Ten sam odczyt posts_per_page i ta sama parametryzacja archiwum co loader
  // - klucz zapytania musi być identyczny, inaczej hydracja robiłaby drugi
  // fetch na najczęściej odwiedzanej trasie serwisu.
  const { data: settingsMap } = useSuspenseQuery(siteSettingsQueryOptions);
  const pageSize = resolvePostsPerPage(settingsMap);
  const { page = 1 } = Route.useSearch();
  const {
    data: { posts, total },
  } = useSuspenseQuery(blogArchiveQueryOptions({ page, pageSize }));
  const navigate = useNavigate();
  const router = useRouter();
  // Zmiana strony biegnie w transition - obecna siatka zostaje na ekranie
  // (bez pustego fallbacku), a isPending steruje stanem kontrolek paginacji.
  const [isPending, startTransition] = useTransition();
  const { t } = useTranslation();
  // Strona główna w trybie "najnowsze wpisy" honoruje placementy in_feed
  // zadeklarowane dla typu "Strona główna" (dotąd emitowały się tylko na /blog).
  const inFeed = useInFeedAds("home");
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // SEO: realne adresy stron wyników (linkowa paginacja). publicHref przechodzi
  // przez rewrite routera, więc niesie właściwy prefiks języka (/en?page=2).
  const searchFor = (nextPage: number) => ({ page: nextPage > 1 ? nextPage : undefined });
  const hrefFor = (nextPage: number) =>
    router.buildLocation({ to: "/", search: searchFor(nextPage) }).publicHref;
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({ to: "/", search: searchFor(nextPage) });
    });

  return (
    <div className="max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
      {/* Pusty stan bierzemy z `blog.empty`: korzeń `home` nie istnieje w
          słowniku, a strona główna w trybie „najnowsze wpisy” renderuje tę samą
          siatkę co /blog - jeden klucz zamiast dwóch kopii tego samego zdania. */}
      <PaginatedPostGrid
        posts={posts}
        page={page}
        totalPages={totalPages}
        lang={lang}
        emptyText={t("blog.empty")}
        isPending={isPending}
        onPageChange={onPageChange}
        hrefFor={hrefFor}
        renderAfterCard={inFeed}
      />
    </div>
  );
}
