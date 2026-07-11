// Category archive: /category/$slug
// Renders featured area (builder template section) + post list.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { ArchivePostList } from "@/components/archive/ArchivePostList";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/components/FollowButton";
import { usePersonalizedSettings } from "@/hooks/usePersonalizedSettings";
import { taxonomyArchiveQueryOptions, ARCHIVE_PAGE_SIZE } from "@/lib/queries/archives";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";

export const Route = createFileRoute("/category/$slug")({
  // SSR prefetches only the first page (default limit); "load more" pages are
  // fetched client-side through the same query options with a bigger limit.
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
    const name = tax
      ? lang === "en"
        ? tax.name_en || tax.name_pl
        : tax.name_pl || tax.name_en
      : lang === "en"
        ? "Category"
        : "Kategoria";
    const desc = tax
      ? lang === "en"
        ? tax.description_en || tax.description_pl
        : tax.description_pl || tax.description_en
      : null;
    return buildContentHead({
      url,
      lang,
      type: "website",
      title: lang === "en" ? `${name} - category` : `${name} - kategoria`,
      description:
        (desc ?? "")
          .replace(/<[^>]+>/g, " ")
          .trim()
          .slice(0, 160) ||
        (lang === "en" ? `Posts in the ${name} category.` : `Wpisy w kategorii ${name}.`),
    });
  },
  component: () => <TaxonomyPage kind="category" />,
  notFoundComponent: NotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

export function TaxonomyPage({ kind }: { kind: "category" | "tag" }) {
  const { slug } = Route.useParams();
  // Limit window keyed by slug: navigating to another archive must start from
  // the first page again instead of carrying over an inflated "load more" limit.
  const [paging, setPaging] = useState({ slug, limit: ARCHIVE_PAGE_SIZE });
  const limit = paging.slug === slug ? paging.limit : ARCHIVE_PAGE_SIZE;
  // The bump re-suspends useSuspenseQuery (new query key), so it runs inside a
  // transition - the current grid stays on screen instead of a blank fallback.
  const [isPending, startTransition] = useTransition();
  const { data } = useSuspenseQuery(taxonomyArchiveQueryOptions(kind, slug, limit));
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const personalized = usePersonalizedSettings();
  const showFollow =
    kind === "category" ? personalized.followInCategoryHeader : personalized.followInTagHeader;
  if (!data) return <NotFound />;
  const { taxonomy, posts } = data;
  const name =
    lang === "en" ? taxonomy.name_en || taxonomy.name_pl : taxonomy.name_pl || taxonomy.name_en;
  const description =
    lang === "en"
      ? taxonomy.description_en || taxonomy.description_pl
      : taxonomy.description_pl || taxonomy.description_en;
  const canLoadMore = posts.length >= limit;

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
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {kind === "category"
                ? t("archive.category", { defaultValue: lang === "en" ? "Category" : "Kategoria" })
                : t("archive.tag", { defaultValue: "Tag" })}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-1">
              <h1 className="font-display text-3xl lg:text-4xl">{name}</h1>
              {showFollow && <FollowButton targetType={kind} targetId={taxonomy.id} lang={lang} />}
            </div>
            {description && <p className="text-muted-foreground mt-2 max-w-2xl">{description}</p>}
          </header>
          <ArchivePostList
            posts={posts}
            lang={lang}
            emptyText={t("archive.empty", {
              defaultValue:
                lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
            })}
          />
          {canLoadMore && (
            <div className="flex justify-center pt-6">
              <Button
                variant="outline"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => setPaging({ slug, limit: limit + ARCHIVE_PAGE_SIZE }))
                }
              >
                {isPending
                  ? t("common.loading", {
                      defaultValue: lang === "en" ? "Loading..." : "Ładowanie...",
                    })
                  : t("common.loadMore", {
                      defaultValue: lang === "en" ? "Load more" : "Załaduj więcej",
                    })}
              </Button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function NotFound() {
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex items-center justify-center px-4">
        <h1 className="font-display text-3xl">
          {t("archive.notFound", { defaultValue: lang === "en" ? "Not found" : "Nie znaleziono" })}
        </h1>
      </main>
    </div>
  );
}
