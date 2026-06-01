import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { parseBuilderDoc } from "@/lib/builder/parse";
import { homePageQueryOptions } from "@/lib/queries/public";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(homePageQueryOptions());
    return null;
  },
  head: () => ({
    meta: [
      { title: "New European Strategies - Strategic thinking, new perspectives" },
      { name: "description", content: "Think-tank o europejskim bezpieczeństwie, geopolityce i grze mocarstw. Analizy, raporty, wywiady i policy papers." },
      { property: "og:title", content: "New European Strategies" },
      { property: "og:description", content: "Strategic thinking, new perspectives. European security, geopolitics, great-power rivalry." },
      { property: "og:type", content: "website" },
    ],
  }),
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
      <Header />
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
      <Footer />
    </div>
  );
}
