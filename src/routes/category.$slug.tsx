// Category archive: /category/$slug
// Renders featured area (builder template section) + post list.
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { taxonomyArchiveQueryOptions } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/category/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(
      taxonomyArchiveQueryOptions("category", params.slug),
    );
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData, params }) => {
    const tax = loaderData?.taxonomy;
    const url = getRequestUrl() || `/category/${params.slug}`;
    const lang = activeLang(url);
    const name = tax ? (lang === "en" ? tax.name_en || tax.name_pl : tax.name_pl || tax.name_en) : "Kategoria";
    const desc = tax ? (lang === "en" ? tax.description_en || tax.description_pl : tax.description_pl || tax.description_en) : null;
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `${name} - category` : `${name} - kategoria`,
      description:
        (desc ?? "").replace(/<[^>]+>/g, " ").trim().slice(0, 160) ||
        (lang === "en" ? `Posts in the ${name} category.` : `Wpisy w kategorii ${name}.`),
    });
  },
  component: () => <TaxonomyPage kind="category" />,
  notFoundComponent: NotFound,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <main className="flex-1 max-w-3xl mx-auto px-4 py-20 text-center">
          <p className="text-sm text-destructive">{error.message}</p>
          <button onClick={() => { router.invalidate(); reset(); }} className="mt-6 bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Spróbuj ponownie</button>
        </main>
        <Footer />
      </div>
    );
  },
});

export function TaxonomyPage({ kind }: { kind: "category" | "tag" }) {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(taxonomyArchiveQueryOptions(kind, slug));
  const { i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  if (!data) return <NotFound />;
  const { taxonomy, posts } = data;
  const name = lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl || taxonomy.name_en;
  const description = lang === "en" ? taxonomy.description_en : taxonomy.description_pl;

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <Header />
      <main className="flex-1 w-full">
        {taxonomy.featured_section && (
          <section className="border-b border-border">
            <BuilderRenderer doc={{ version: 1, sections: [taxonomy.featured_section] }} lang={lang} />
          </section>
        )}
        <section className="max-w-[1200px] mx-auto px-4 lg:px-8 py-10">
          <header className="mb-8">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {kind === "category" ? "Kategoria" : "Tag"}
            </p>
            <h1 className="font-display text-3xl lg:text-4xl mt-1">{name}</h1>
            {description && <p className="text-muted-foreground mt-2 max-w-2xl">{description}</p>}
          </header>
          <ArchivePostList posts={posts} lang={lang} emptyText="Brak opublikowanych wpisów." />
        </section>
      </main>
      <Footer />
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <h1 className="font-display text-3xl">Nie znaleziono</h1>
      </main>
      <Footer />
    </div>
  );
}
