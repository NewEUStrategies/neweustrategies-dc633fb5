// Category archive: /category/$slug
// Uses global archive_layout_settings + one of 6 registered layouts.
import { createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useState, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { ArchiveSkeleton } from "@/components/archive/ArchiveSkeleton";
import { taxonomyArchiveQueryOptions, ARCHIVE_PAGE_SIZE } from "@/lib/queries/archives";
import { podcastsByCategoryQueryOptions } from "@/lib/queries/podcasts";
import { PodcastEpisodeStrip } from "@/components/podcast/PodcastEpisodeStrip";
import { getRequestUrl } from "@/lib/seo/request";
import { activeLang } from "@/lib/seo/head";
import { buildContentHead } from "@/lib/seo/meta";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { getLayoutComponent } from "@/components/archive/layouts/registry";
import "@/lib/i18n-archive-layout";

export const Route = createFileRoute("/category/$slug")({
  loader: async ({ params, context }) => {
    const [data] = await Promise.all([
      context.queryClient.ensureQueryData(taxonomyArchiveQueryOptions("category", params.slug)),
      context.queryClient.ensureQueryData(archiveLayoutQueryOptions("category")),
    ]);
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
  pendingComponent: () => <ArchiveSkeleton />,
  notFoundComponent: PublicNotFound,
  errorComponent: (props) => <RouteErrorFallback {...props} />,
});

export function TaxonomyPage({ kind }: { kind: "category" | "tag" }) {
  const { slug } = Route.useParams();
  const [paging, setPaging] = useState({ slug, limit: ARCHIVE_PAGE_SIZE });
  const limit = paging.slug === slug ? paging.limit : ARCHIVE_PAGE_SIZE;
  const [isPending, startTransition] = useTransition();
  const { data } = useSuspenseQuery(taxonomyArchiveQueryOptions(kind, slug, limit));
  const { data: settings } = useSuspenseQuery(archiveLayoutQueryOptions(kind));
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const podcastsQ = useQuery({
    ...podcastsByCategoryQueryOptions(data?.taxonomy.id ?? ""),
    enabled: kind === "category" && !!data?.taxonomy.id && settings.show_podcasts,
  });
  if (!data) return <PublicNotFound />;
  const { taxonomy, posts } = data;
  const canLoadMore = posts.length >= limit;

  const LayoutComponent = getLayoutComponent(settings.layout_variant);

  const emptyText = t("archive.empty", {
    defaultValue: lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
  });
  const loadingText = t("common.loading", {
    defaultValue: lang === "en" ? "Loading..." : "Ładowanie...",
  });
  const loadMoreText = t("common.loadMore", {
    defaultValue: lang === "en" ? "Load more" : "Załaduj więcej",
  });

  const extraBelow =
    kind === "category" && settings.show_podcasts && podcastsQ.data && podcastsQ.data.length > 0 ? (
      <div className="pt-10">
        <PodcastEpisodeStrip
          episodes={podcastsQ.data}
          lang={lang}
          title={lang === "en" ? "Podcasts" : "Podcasty"}
        />
      </div>
    ) : null;

  return (
    <>
      {taxonomy.featured_section && (
        <section className="border-b border-border">
          <BuilderRenderer
            doc={{ version: 1, sections: [taxonomy.featured_section] }}
            lang={lang}
          />
        </section>
      )}
      <LayoutComponent
        kind={kind}
        taxonomy={taxonomy}
        posts={posts}
        lang={lang}
        settings={settings}
        canLoadMore={canLoadMore}
        isPending={isPending}
        onLoadMore={() =>
          startTransition(() => setPaging({ slug, limit: limit + ARCHIVE_PAGE_SIZE }))
        }
        emptyText={emptyText}
        loadingText={loadingText}
        loadMoreText={loadMoreText}
        extraBelow={extraBelow}
      />
    </>
  );
}
