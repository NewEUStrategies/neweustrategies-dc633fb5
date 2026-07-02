import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import { homePageQueryOptions } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead, SITE_DEFAULT_TITLE, SITE_DEFAULT_DESCRIPTION } from "@/lib/seo/meta";
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
              Strona główna nie ma jeszcze treści. Zbuduj ją w{" "}
              <a href="/admin/pages" className="text-brand hover:underline">panelu CMS</a>.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
