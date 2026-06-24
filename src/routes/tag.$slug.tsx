// Tag archive: /tag/$slug — same shape as category, reuses TaxonomyPage logic.
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { taxonomyArchiveQueryOptions } from "@/lib/queries/archives";

export const Route = createFileRoute("/tag/$slug")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(
      taxonomyArchiveQueryOptions("tag", params.slug),
    );
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.taxonomy.name_pl ?? "Tag";
    return {
      meta: [
        { title: `#${name} - tag` },
        { name: "description", content: `Wpisy oznaczone tagiem ${name}.` },
        { property: "og:title", content: `#${name}` },
        { property: "og:type", content: "website" },
      ],
    };
  },
  component: TagArchivePage,
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
      <Header />
      <main className="flex-1 w-full">
        {taxonomy.featured_section && (
          <section className="border-b border-border">
            <BuilderRenderer doc={{ sections: [taxonomy.featured_section] }} lang={lang} />
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
      <Footer />
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex items-center justify-center px-4">
        <h1 className="font-display text-3xl">Tag nie znaleziony</h1>
      </main>
      <Footer />
    </div>
  );
}
