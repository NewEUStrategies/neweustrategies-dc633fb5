import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PostListCard } from "@/components/molecules/PostListCard";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import {
  blogListQueryOptions,
  homePageQueryOptions,
  homepageModeQueryOptions,
  type PageData,
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
  loader: async ({ context }) => {
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
    let homeMode = "";
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

    // "Najnowsze wpisy" jako strona główna: dotąd opcja z ustawień czytania nie
    // była honorowana - trasa zawsze renderowała stronę statyczną.
    if (homeMode === "latest_posts") {
      try {
        await queryClient.ensureQueryData(blogListQueryOptions());
      } catch {
        degraded = true;
        queryClient.setQueryData(blogListQueryOptions().queryKey, { posts: [] }, { updatedAt: 0 });
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
    // via the ServerSectionGate as before.
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
    return { seoSettings, homePage };
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
  errorComponent: HomeErrorComponent,
  notFoundComponent: HomeNotFoundComponent,
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
      <div className="flex-1 w-full">
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
          // Streaming is deliberately DISABLED here: the loader already settles
          // every widget query before dehydration (see prefetchCachedRouteQueries),
          // and any streaming Suspense/Await boundary that rejects mid-flush can
          // corrupt the inline $_TSR.router bootstrap script and force React to
          // rebuild the whole page client-side (visible SSR flash + refetch).
          // Rendering eagerly keeps SSR HTML and client hydration in lockstep.
          <BuilderRenderer doc={doc} lang={lang} />
        ) : (
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
            <p className="text-sm">
              {lang === "en"
                ? "There's nothing here yet — please check back soon."
                : "Nie ma tu jeszcze treści — zajrzyj wkrótce."}
            </p>
          </div>
        )}
      </div>
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
