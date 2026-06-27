import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { homePageQueryOptions } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { prefetchCachedRouteQueries } from "@/lib/builder/prefetch";
import { setCacheControlHeader } from "@/lib/http/responseHeaders";
import { contentCacheControl } from "@/lib/http/cachePolicy";
import { requestLangOverridesCache } from "@/lib/i18n";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    // ISR-like edge caching: the homepage SSR is the anonymous shell, so it is
    // safe to share-cache and serve stale-while-revalidate from the CDN. EXCEPT
    // when the language was chosen by a cookie (no ?lang=, cookie ≠ default):
    // the CDN keys on URL only, so that render must not be shared-cached.
    setCacheControlHeader(contentCacheControl({ personalized: requestLangOverridesCache() }));
    const homePage = await context.queryClient.ensureQueryData(homePageQueryOptions());
    const doc = homePage?.editor === "builder" ? parseBuilderDoc(homePage.builder_data) : null;
    if (doc?.sections.length) {
      const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
      // The homepage is edge-cached (see setCacheControlHeader above), so warming
      // the WHOLE document server-side is amortized across cache hits. Every
      // section ships as server-rendered HTML - below-the-fold content no longer
      // pops in on the client after a hard refresh. Bounded by a budget, so a
      // slow query degrades to the client `useSectionPreload` path, never a hang.
      await prefetchCachedRouteQueries(context.queryClient, doc, lang);
    }
    return null;
  },
  head: () => {
    const url = getRequestUrl() || "/";
    const lang = activeLang(url);
    return buildContentHead({
      url,
      lang,
      type: "website",
      title:
        lang === "en"
          ? "New European Strategies - Strategic thinking, new perspectives"
          : "New European Strategies - Strategiczne myślenie, nowe perspektywy",
      description:
        lang === "en"
          ? "A think-tank on European security, geopolitics and great-power rivalry. Analyses, reports, interviews and policy papers."
          : "Think-tank o europejskim bezpieczeństwie, geopolityce i grze mocarstw. Analizy, raporty, wywiady i policy papers.",
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
          <BuilderRenderer doc={doc} lang={lang} />
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
