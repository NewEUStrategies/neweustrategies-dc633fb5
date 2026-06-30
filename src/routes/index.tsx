import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { homePageQueryOptions } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_DEFAULT_TITLE, SITE_DEFAULT_DESCRIPTION } from "@/lib/seo/meta";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    // ISR-like edge caching: the homepage SSR is the anonymous shell, so it is
    // safe to share-cache and serve stale-while-revalidate from the CDN. The
    // language lives in the URL path (PL at "/", EN at "/en"), so each variant
    // is its own cache entry - no cookie-driven personalization, no poisoning.
    setCacheControlHeader(contentCacheControl());
    const homePage = await context.queryClient.ensureQueryData(homePageQueryOptions());
    const doc = homePage?.editor === "builder" ? parseBuilderDoc(homePage.builder_data) : null;
    if (doc?.sections.length) {
      const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
      // The homepage is edge-cached. We block the SSR response only on the
      // above-the-fold sections; below-the-fold sections Suspense-stream as their
      // data settles (BuilderRenderer `stream`). A cold (cache-miss) render's TTFB
      // tracks the hero rather than the whole document, yet the streamed body is
      // still complete server HTML - below-the-fold content never pops in on the
      // client after a hard refresh. Bounded by a budget, so a slow above-the-fold
      // query degrades to the client `useSectionPreload` path, never a hang.
      await prefetchAboveFoldQueries(context.queryClient, doc, lang);
    }
    return null;
  },
  head: () => {
    const url = getRequestUrl() || "/";
    const lang = activeLang(url);
    // The homepage is the brand's front page, so its title/description ARE the
    // site defaults - reuse the shared constants (kept in sync with the root
    // <head> fallback) instead of duplicating the localized copy here.
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: SITE_DEFAULT_TITLE[lang],
      description: SITE_DEFAULT_DESCRIPTION[lang],
    });
  },
  component: Index,
});

function Index() {
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const { data: homePage } = useSuspenseQuery(homePageQueryOptions());

  const doc = homePage && homePage.editor === "builder"
    ? parseBuilderDoc(homePage.builder_data)
    : null;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 w-full">
        {doc && doc.sections.length > 0 ? (
          <BuilderRenderer doc={doc} lang={lang} stream />
        ) : (
          <div className="max-w-[1400px] mx-auto px-4 lg:px-8 py-24 text-center text-muted-foreground">
            <p className="text-sm">
              Strona główna nie ma jeszcze treści. Zbuduj ją w{" "}
              <a href="/admin/pages" className="text-brand hover:underline">panelu CMS</a>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
