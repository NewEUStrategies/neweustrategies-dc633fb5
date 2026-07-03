// Tag archive: /tag/$slug - same shape as category, reuses TaxonomyPage logic.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { taxonomyArchiveQueryOptions } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/tag/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(
      taxonomyArchiveQueryOptions("tag", params.slug),
    );
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const tax = loaderData?.taxonomy;
    const url = getRequestUrl() || `/tag/${params.slug}`;
    const lang = activeLang(url);
    const name = tax
      ? lang === "en"
        ? tax.name_en || tax.name_pl
        : tax.name_pl || tax.name_en
      : "Tag";
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `#${name} - tag` : `#${name} - tag`,
      description: lang === "en" ? `Posts tagged ${name}.` : `Wpisy oznaczone tagiem ${name}.`,
    });
  },
  component: TagArchivePage,
  notFoundComponent: NotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

function TagArchivePage() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(taxonomyArchiveQueryOptions("tag", slug));
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  if (!data) return <NotFound />;
  const { taxonomy, posts } = data;
  const name = taxonomy.name_pl || taxonomy.name_en;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <main className="flex-1 w-full">
        {taxonomy.featured_section && (
          <section className="border-b border-border">
            <BuilderRenderer
              doc={{ version: 1, sections: [taxonomy.featured_section] }}
              lang={lang}
            />
          </section>
        )}
        <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-10">
          <header className="mb-8">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Tag</p>
            <h1 className="font-display text-3xl lg:text-4xl mt-1">#{name}</h1>
          </header>
          <ArchivePostList posts={posts} lang={lang} emptyText="Brak opublikowanych wpisów." />
        </section>
      </main>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <h1 className="font-display text-3xl">Tag nie znaleziony</h1>
      </main>
    </div>
  );
}
