import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { homePageQueryOptions } from "@/lib/queries/public";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { prefetchAboveFoldQueries } from "@/lib/builder/prefetch";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const homePage = await context.queryClient.ensureQueryData(homePageQueryOptions());
    const doc = homePage?.editor === "builder" ? parseBuilderDoc(homePage.builder_data) : null;
    if (doc?.sections.length) {
      const lang = activeLang(getRequestUrl() || "/") === "en" ? "en" : "pl";
      // Block SSR only on the above-the-fold sections; the rest stream in on the
      // client via useSectionPreload. Keeps first paint fast on long homepages.
      await prefetchAboveFoldQueries(context.queryClient, doc, lang);
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
