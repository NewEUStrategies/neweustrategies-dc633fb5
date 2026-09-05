import { createFileRoute, useRouter } from "@tanstack/react-router";
import { isServer } from "@tanstack/router-core/isServer";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { HomeSrHeading } from "@/components/home/atoms/HomeSrHeading";
import { homeBuilderSource, homeContent } from "@/components/home/atoms/homeRenderMode";
import { HomeBuilderContent } from "@/components/home/molecules/HomeBuilderContent";
import { HomeEmptyNotice } from "@/components/home/molecules/HomeEmptyNotice";
import { HomeErrorNotice } from "@/components/home/molecules/HomeErrorNotice";
import { HomeNotFoundNotice } from "@/components/home/molecules/HomeNotFoundNotice";
import { HomeLoadingNotice } from "@/components/home/molecules/HomeLoadingNotice";
import { LatestPostsHome } from "@/components/home/organisms/LatestPostsHome";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import {
  ABOVE_FOLD_SECTION_COUNT,
  prefetchAboveFoldQueries,
  sectionQueryOptionsList,
} from "@/lib/builder/prefetch";
import {
  blogArchiveQueryOptions,
  homePageQueryOptions,
  homepageModeQueryOptions,
  resolvePostsPerPage,
  type BlogArchiveResult,
} from "@/lib/queries/public";
import { parsePageSearch } from "@/lib/routing/pageSearch";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import {
  buildContentHead,
  imagePreloadLink,
  imagePreloadLinkHeaderValue,
  splitUrl,
  siteTitle,
  siteDescription,
  type ImagePreloadInput,
} from "@/lib/seo/meta";
import { builderHeroPreload } from "@/lib/builder/heroImage";
import { buildImageSrcSet } from "@/lib/cropSizes";
import { CARD_IMAGE_SIZES } from "@/lib/cardImageSizes";
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
import { siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import { loadResilient, resilientCacheControl } from "@/lib/ssr/resilientLoad";
import {
  HOME_ABOVE_FOLD_BUDGET_MS,
  hasSsrQueryData,
  homeSsrDeadline,
  remainingHomeBudget,
} from "@/lib/ssr/homeSsrBudget";

// Keep route boundary declarations above createFileRoute. The production route
// splitter evaluates route options separately and a later declaration can be in
// the temporal dead zone while the generated route module is initialized.
//
// Sama TREŚĆ obu powierzchni awaryjnych mieszka w molekułach
// (`components/home/molecules/*Notice`), które czytają dwujęzyczny słownik
// `lib/errorCopy.ts`. Tutaj zostaje wyłącznie to, co wymaga kontekstu trasy:
// zgłoszenie błędu do konsoli i unieważnienie danych routera przy ponowieniu.
function HomeErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <HomeErrorNotice
      onRetry={() => {
        router.invalidate();
        reset();
      }}
    />
  );
}

function HomeNotFoundComponent() {
  return <HomeNotFoundNotice />;
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
    const deadlineAt = isServer ? homeSsrDeadline(queryClient) : undefined;
    const emptySettings: SettingsMap = Object.freeze({});
    // Root and home execute concurrently, but all serial phases within home
    // share ONE deadline. Settings start alongside the page/mode, never as a
    // new unbounded SEO request at the end of the loader.
    const [homePageRes, homeModeRes, settingsRes] = await Promise.all([
      loadResilient(queryClient, homePageQueryOptions(), null, {
        deadlineAt,
        label: "home.page",
      }),
      loadResilient(queryClient, homepageModeQueryOptions(), "", {
        deadlineAt,
        label: "home.mode",
      }),
      loadResilient(queryClient, siteSettingsQueryOptions, emptySettings, {
        deadlineAt,
        label: "home.settings",
      }),
    ]);
    const homePage = homePageRes.data;
    const homeMode = homeModeRes.data;
    const contentDegraded = homePageRes.degraded || homeModeRes.degraded;
    let degraded = contentDegraded || settingsRes.degraded;

    // "Najnowsze wpisy" jako strona główna: SSR ładuje DOKŁADNIE żądaną stronę
    // wyników (?page=N) tym samym paginowanym zapytaniem co /blog - wpisy poza
    // pierwszą stroną mają z poziomu strony głównej realne, indeksowalne URL-e
    // (dawny płaski limit czynił je nieosiągalnymi). Rozmiar strony honoruje
    // posts_per_page z ustawień czytania; klucz zapytania musi być zgodny
    // z komponentem, także w ścieżce degradacji.
    // Preload obrazu LCP: deskryptor liczony w loaderze (head() jest
    // synchroniczny), osobno dla każdego trybu strony głównej. Wpisy mają ten
    // kontrakt od dawna ($.tsx); strona główna - najczęściej odwiedzana trasa
    // serwisu - emitowała dotąd zero hintów i przeglądarka odkrywała hero
    // dopiero po sparsowaniu body.
    let coverPreload: ImagePreloadInput | null = null;

    if (!contentDegraded && homeMode === "latest_posts") {
      const pageSize = resolvePostsPerPage(settingsRes.data);
      const listOptions = blogArchiveQueryOptions({ page: deps.page, pageSize });
      const listRes = await loadResilient(
        queryClient,
        listOptions,
        { posts: [], total: 0, page: deps.page, pageSize } satisfies BlogArchiveResult,
        { deadlineAt, label: "home.archive" },
      );
      degraded ||= listRes.degraded;
      // Pierwsza karta siatki jest priority (PaginatedPostGrid) - preload jej
      // okładki z IDENTYCZNĄ parą srcSet/sizes co PostListCard.
      const list = queryClient.getQueryData<BlogArchiveResult>(listOptions.queryKey);
      const firstCover = list?.posts?.[0]?.cover_image_url;
      if (firstCover) {
        coverPreload = {
          href: firstCover,
          imageSrcSet: buildImageSrcSet(firstCover),
          imageSizes: CARD_IMAGE_SIZES,
        };
      }
    }
    // JEDNA ścieżka dla serwera i klienta - dokładnie ten sam kontrakt co
    // `$.tsx`: blokujemy odpowiedź WYŁĄCZNIE na sekcjach nad zgięciem
    // (`ABOVE_FOLD_SECTION_COUNT` = 3). SSR consumes the remaining shared
    // deadline, capped at HOME_ABOVE_FOLD_BUDGET_MS; SPA keeps its existing cap.
    //
    // CO BYŁO WCZEŚNIEJ: serwer wołał tu `prefetchCachedRouteQueries` dla
    // CAŁEGO dokumentu z budżetem 6 000 ms, więc pierwszy bajt najważniejszej
    // trasy serwisu wisiał na najwolniejszym zapytaniu SPOD ZGIĘCIA - na
    // każdym cache MISS. Dwa komentarze (ten oraz `sectionStreaming.tsx`)
    // obiecywały przy tym, że „cokolwiek poza budżetem nadal jedzie strumieniem
    // przez ServerSectionGate" - a `HomeBuilderContent` renderował
    // `<BuilderRenderer>` BEZ propa `stream`, którego domyślną wartością jest
    // `false`. Zapytanie widgetu, które nie zmieściło się w 6 s, lądowało
    // w HTML-u jako pusty widget: bez szkieletu i bez dociągnięcia.
    //
    // CO JEST TERAZ: sekcje poniżej zgięcia idą przez `ServerSectionGate`
    // (`HomeBuilderContent` przekazuje `stream`) - powłoka flushuje się
    // natychmiast, a ich HTML dostrumieniowuje się wraz z danymi, więc ciało
    // zapisane w NES Edge Cache i widziane przez crawlery zostaje kompletne
    // (dla `isbot` framework czeka na `stream.allReady`). Dane rozstrzygnięte
    // w fazie renderu jadą strumieniem zapytań, na który `router.options.hydrate`
    // pompuje dane strumieniem. Samo withHydrateBudget nie dowodzi, że cały
    // queryStream dotarł przed Reactem; zgodność sprawdzają testy artefaktu.
    // Prefetch jest wewnętrznie `allSettled` i nie potrafi rzucić.
    //
    // Na kliencie bramka jest tree-shaken (`import.meta.env.SSR`), więc widgety
    // niżej to zwykłe `useQuery` (szkielet, bez suspenda), a ich dane dogrzewa
    // `useSectionPreload` (IntersectionObserver z wyprzedzeniem 1200 px).
    //
    // W trybie "najnowsze wpisy" homePage jest null z konstrukcji
    // (homePageQueryOptions), więc prefetch widgetów buildera w ogóle nie
    // startuje - zero zmarnowanych round-tripów.
    if (!contentDegraded && homePage && homePage.editor === "builder") {
      const doc = parseBuilderDoc(homePage.builder_data);
      if (doc.sections.length > 0) {
        const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
        if (deadlineAt === undefined) {
          await prefetchAboveFoldQueries(queryClient, doc, lang);
        } else {
          const budgetMs = remainingHomeBudget(deadlineAt, HOME_ABOVE_FOLD_BUDGET_MS);
          if (budgetMs > 0) await prefetchAboveFoldQueries(queryClient, doc, lang, { budgetMs });
          degraded ||= doc.sections
            .slice(0, ABOVE_FOLD_SECTION_COUNT)
            .some((section) =>
              sectionQueryOptionsList(section, lang).some(
                (options) => !hasSsrQueryData(queryClient, options.queryKey),
              ),
            );
        }
        // Rozgrzane okno (3 sekcje) to DOKŁADNIE okno skanowane przez
        // `builderHeroPreload` (lib/seo/heroImage.ts - `aboveFoldSections`
        // domyślnie `ABOVE_FOLD_SECTION_COUNT`), więc obraz LCP pozostaje
        // w pełni wyznaczalny: head() wyemituje go jako `<link rel="preload">`,
        // a loader jako nagłówek `Link`.
        coverPreload = builderHeroPreload(doc, queryClient, lang);
      }
    }
    // SEO settings (Organization sameAs / logo) for the homepage JSON-LD; the
    // bulk site_settings query is already warmed by the root loader. Purely
    // decorative structured data - never let it fail the whole homepage.
    const seoSettings = parseSeoSettings(settingsRes.data["seo"]);

    // ISR-like edge caching, set LAST so a degraded render is never shared-
    // cached: the homepage SSR is the anonymous shell, so a clean render is safe
    // to share-cache and serve stale-while-revalidate from the CDN. The language
    // lives in the URL path (PL at "/", EN at "/en"), so each variant is its own
    // cache entry - no cookie-driven personalization, no poisoning. A degraded
    // render opts out entirely (private, no-store) so the blip is never served
    // to the next visitor.
    setCacheControlHeader(resilientCacheControl(degraded));
    // Ten sam preload także jako nagłówek HTTP `Link`: przeglądarka startuje
    // pobieranie hero z nagłówków odpowiedzi (przed pierwszym bajtem HTML),
    // a NES Edge Cache utrwala go na HIT/STALE (droga do 103 Early Hints).
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    // An unknown mode also means an unknown SEO document. Do not advertise
    // the static page's canonical/image while the UI intentionally shows a
    // recovery notice (the configured mode could actually be latest_posts).
    return {
      seoSettings,
      homePage: contentDegraded ? null : homePage,
      page: deps.page,
      coverPreload,
      degraded,
    };
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
    const builtHead = buildContentHead({
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
    // Preload obrazu LCP (hero buildera / pierwsza karta trybu "najnowsze
    // wpisy") - deskryptor policzony w loaderze, bajtowo zgodny z malowanym
    // <img> (wspólne moduły sizes + buildImageSrcSet).
    const head = loaderData?.coverPreload
      ? { ...builtHead, links: [...builtHead.links, imagePreloadLink(loaderData.coverPreload)] }
      : builtHead;
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
  const pageQuery = useSuspenseQuery(homePageQueryOptions());
  const modeQuery = useSuspenseQuery(homepageModeQueryOptions());
  const homePage = pageQuery.data;
  const homeMode = modeQuery.data;
  // Query state, not a latched loader flag: a successful browser refetch must
  // replace the fallback without navigation. A real empty page is different.
  const contentUnavailable = pageQuery.dataUpdatedAt === 0 || modeQuery.dataUpdatedAt === 0;
  const { page = 1 } = Route.useSearch();

  const builderData = homeBuilderSource(homeMode, homePage);

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
  const content = homeContent(homeMode, doc);

  return (
    <div data-theme-typography className="min-h-screen flex flex-col bg-background text-foreground">
      <div className="flex-1 w-full">
        <HomeSrHeading doc={doc} lang={lang} />
        {contentUnavailable ? (
          <HomeLoadingNotice
            onRetry={() => {
              void pageQuery.refetch();
              void modeQuery.refetch();
            }}
          />
        ) : content.kind === "latest_posts" ? (
          <Suspense fallback={<HomeLoadingNotice />}>
            <LatestPostsHome lang={lang} page={page} />
          </Suspense>
        ) : content.kind === "builder" ? (
          <HomeBuilderContent doc={content.doc} footnotes={footnotes} lang={lang} />
        ) : (
          <HomeEmptyNotice lang={lang} />
        )}
      </div>
      <FooterSlideup pageType="home" />
    </div>
  );
}
