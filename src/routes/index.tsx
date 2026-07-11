import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PostListCard } from "@/components/molecules/PostListCard";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import {
  blogListQueryOptions,
  homePageQueryOptions,
  homepageModeQueryOptions,
} from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import {
  buildContentHead,
  splitUrl,
  SITE_DEFAULT_TITLE,
  SITE_DEFAULT_DESCRIPTION,
} from "@/lib/seo/meta";
import { organizationJsonLd, safeJsonLd, webSiteJsonLd } from "@/lib/seo/jsonld";
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
import { contentCacheControl } from "@/lib/http/cachePolicy";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    // ISR-like edge caching: the homepage SSR is the anonymous shell, so it is
    // safe to share-cache and serve stale-while-revalidate from the CDN. The
    // language lives in the URL path (PL at "/", EN at "/en"), so each variant
    // is its own cache entry - no cookie-driven personalization, no poisoning.
    setCacheControlHeader(contentCacheControl());
    const [homePage, homeMode] = await Promise.all([
      context.queryClient.ensureQueryData(homePageQueryOptions()),
      context.queryClient.ensureQueryData(homepageModeQueryOptions()),
    ]);
    // "Najnowsze wpisy" jako strona główna: dotąd opcja z ustawień czytania nie
    // była honorowana - trasa zawsze renderowała stronę statyczną.
    if (homeMode === "latest_posts") {
      await context.queryClient.ensureQueryData(blogListQueryOptions());
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
    // (see prefetchCachedRouteQueries) - and the homepage is edge-cached, so
    // the cost is paid once per revalidation, not per visitor. Anything past
    // the budget still streams via the ServerSectionGate as before.
    if (homePage && homePage.editor === "builder") {
      const doc = parseBuilderDoc(homePage.builder_data);
      if (doc.sections.length > 0) {
        const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
        await prefetchCachedRouteQueries(context.queryClient, doc, lang);
      }
    }
    // SEO settings (Organization sameAs / logo) for the homepage JSON-LD; the
    // bulk site_settings query is already warmed by the root loader.
    const settingsMap = await context.queryClient.ensureQueryData(siteSettingsQueryOptions);
    return { seoSettings: parseSeoSettings(settingsMap["seo"]), homePage };
  },

  head: ({ loaderData }) => {
    const url = getRequestUrl() || "/";
    const lang = activeLang(url);
    // The homepage title/description default to the brand constants (kept in
    // sync with the root <head> fallback), but a static home page built in the
    // CMS builder is a first-class SEO citizen: its own SEO overrides, excerpt
    // (meta description), social image, canonical and noindex win when set.
    // No brand suffix here - the defaults already carry the brand.
    const homePage = loaderData?.homePage ?? null;
    const fallbackDescription =
      (homePage &&
        metaDescription(
          lang === "en"
            ? homePage.excerpt_en || homePage.excerpt_pl
            : homePage.excerpt_pl || homePage.excerpt_en,
          "",
        )) ||
      SITE_DEFAULT_DESCRIPTION[lang];
    const seo = homePage
      ? resolveSeoText(homePage, lang, SITE_DEFAULT_TITLE[lang], fallbackDescription)
      : { title: SITE_DEFAULT_TITLE[lang], description: fallbackDescription };
    const image = homePage ? resolveSocialImage(homePage, homePage.cover_image_url) : null;
    const head = buildContentHead({
      url,
      lang,
      type: "website",
      title: seo.title,
      description: seo.description,
      image,
      robots: homePage ? resolveRobotsMeta(homePage) : null,
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
    return {
      ...head,
      scripts: [
        { type: "application/ld+json", children: safeJsonLd(organization) },
        { type: "application/ld+json", children: safeJsonLd(webSiteJsonLd(origin, lang)) },
      ],
    };
  },
  component: Index,
});

function Index() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: homePage } = useSuspenseQuery(homePageQueryOptions());
  const { data: homeMode } = useSuspenseQuery(homepageModeQueryOptions());

  const isLatestPosts = homeMode === "latest_posts";
  const doc =
    !isLatestPosts && homePage && homePage.editor === "builder"
      ? parseBuilderDoc(homePage.builder_data)
      : null;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 w-full">
        {/* Screen-reader-only H1 so the homepage always exposes a descriptive
            landmark heading, even when the CMS builder renders its own visual
            hierarchy. Search engines and assistive tech get the brand headline
            regardless of the builder document above. */}
        <h1 className="sr-only">
          {lang === "en"
            ? "New European Strategies - Strategic thinking, new perspectives"
            : "New European Strategies - Strategiczne myślenie, nowe perspektywy"}
        </h1>
        {isLatestPosts ? (
          <LatestPostsHome lang={lang} />
        ) : doc && doc.sections.length > 0 ? (
          // The loader settles the whole document's widget queries before the
          // router dehydrates (see loader note), so sections normally render
          // eagerly with data into the SSR shell. `stream` +
          // aboveFoldCount={0} stay on purely as the budget-overrun safety
          // valve: a query that outruns the loader's prefetch budget streams
          // through the ServerSectionGate instead of blocking or blanking the
          // response.
          <BuilderRenderer doc={doc} lang={lang} stream aboveFoldCount={0} />
        ) : (
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
            <p className="text-sm">
              {lang === "en"
                ? "There's nothing here yet — please check back soon."
                : "Nie ma tu jeszcze treści — zajrzyj wkrótce."}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

function LatestPostsHome({ lang }: { lang: "pl" | "en" }) {
  const {
    data: { posts },
  } = useSuspenseQuery(blogListQueryOptions());
  return (
    <div className="max-w-[1200px] w-full mx-auto px-4 lg:px-8 py-10">
      {posts.length === 0 ? (
        <p className="text-muted-foreground text-center py-16">
          {lang === "en" ? "No posts published yet." : "Brak opublikowanych wpisów."}
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p, idx) => (
            <PostListCard
              key={p.id}
              post={p}
              href={p.href}
              lang={lang}
              titleClassName="text-base"
              priority={idx === 0}
              viewTransitionId={p.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
