import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

import { FooterSlideup } from "@/components/ads/FooterSlideup";
import { HomeSrHeading } from "@/components/home/atoms/HomeSrHeading";
import { homeBuilderSource, homeContent } from "@/components/home/atoms/homeRenderMode";
import { HomeBuilderContent } from "@/components/home/molecules/HomeBuilderContent";
import { HomeEmptyNotice } from "@/components/home/molecules/HomeEmptyNotice";
import { HomeErrorNotice } from "@/components/home/molecules/HomeErrorNotice";
import { HomeNotFoundNotice } from "@/components/home/molecules/HomeNotFoundNotice";
import { LatestPostsHome } from "@/components/home/organisms/LatestPostsHome";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { prepareContentForRender } from "@/lib/content/prepareContent";
import { prefetchAboveFoldQueries } from "@/lib/builder/prefetch";
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
import { siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { appendLinkHeader, setCacheControlHeader } from "@/lib/http/responseHeaders";
import { cacheControlHeader, contentCacheControl } from "@/lib/http/cachePolicy";

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
    // Preload obrazu LCP: deskryptor liczony w loaderze (head() jest
    // synchroniczny), osobno dla każdego trybu strony głównej. Wpisy mają ten
    // kontrakt od dawna ($.tsx); strona główna - najczęściej odwiedzana trasa
    // serwisu - emitowała dotąd zero hintów i przeglądarka odkrywała hero
    // dopiero po sparsowaniu body.
    let coverPreload: ImagePreloadInput | null = null;

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
    // (`ABOVE_FOLD_SECTION_COUNT` = 3, budżet 2,5 s).
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
    // czeka PRZED hydratacją Reacta, więc widget nigdy nie hydratuje się
    // przeciw szkieletowi. Prefetch jest wewnętrznie `allSettled` i nie potrafi
    // rzucić.
    //
    // Na kliencie bramka jest tree-shaken (`import.meta.env.SSR`), więc widgety
    // niżej to zwykłe `useQuery` (szkielet, bez suspenda), a ich dane dogrzewa
    // `useSectionPreload` (IntersectionObserver z wyprzedzeniem 1200 px).
    //
    // W trybie "najnowsze wpisy" homePage jest null z konstrukcji
    // (homePageQueryOptions), więc prefetch widgetów buildera w ogóle nie
    // startuje - zero zmarnowanych round-tripów.
    if (homePage && homePage.editor === "builder") {
      const doc = parseBuilderDoc(homePage.builder_data);
      if (doc.sections.length > 0) {
        const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
        await prefetchAboveFoldQueries(queryClient, doc, lang);
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
    // Ten sam preload także jako nagłówek HTTP `Link`: przeglądarka startuje
    // pobieranie hero z nagłówków odpowiedzi (przed pierwszym bajtem HTML),
    // a NES Edge Cache utrwala go na HIT/STALE (droga do 103 Early Hints).
    if (coverPreload) appendLinkHeader(imagePreloadLinkHeaderValue(coverPreload));
    return { seoSettings, homePage, page: deps.page, coverPreload };
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
  const { data: homePage } = useSuspenseQuery(homePageQueryOptions());
  const { data: homeMode } = useSuspenseQuery(homepageModeQueryOptions());
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
        {content.kind === "latest_posts" ? (
          <LatestPostsHome lang={lang} page={page} />
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
