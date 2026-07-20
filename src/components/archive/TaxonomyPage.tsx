// Wspólny widok archiwum taksonomii (kategoria/tag) - dotąd żył jako
// EKSPORT w src/routes/category.$slug.tsx, importowany przez tag.$slug.
// Eksportowanego wiązania splitter tras nie może wynieść do chunka
// komponentu, więc cały rejestr layoutów archiwum (6 layoutów + ArchiveSidebar
// + NewsletterForm...) siedział w eager-owym bundlu wejściowym KAŻDEJ strony.
// Jako zwykły moduł komponentu jest importowany nazwaniem w obu trasach i
// trafia do współdzielonego, leniwego chunka tras archiwum.
import { useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useTransition, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BuilderRenderer } from "@/components/admin/builder/BuilderRenderer";
import { PublicNotFound } from "@/components/molecules/PublicNotFound";
import { taxonomyArchiveQueryOptions, type ArchiveSort } from "@/lib/queries/archives";
import { podcastsByCategoryQueryOptions } from "@/lib/queries/podcasts";
import { PodcastEpisodeStrip } from "@/components/podcast/PodcastEpisodeStrip";
import { archiveLayoutQueryOptions } from "@/lib/archive-layout-settings";
import { getLayoutComponent } from "@/components/archive/layouts/registry";
import { ensureI18n as ensureArchiveLayoutI18n } from "@/lib/i18n-archive-layout";

export function TaxonomyPage({
  kind,
  slug,
  page,
  sort,
}: {
  kind: "category" | "tag";
  slug: string;
  page: number;
  sort: ArchiveSort;
}) {
  // Rejestracja słowników w chunku tras archiwum (nie w entry).
  ensureArchiveLayoutI18n();
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();
  const { data: settings } = useSuspenseQuery(archiveLayoutQueryOptions(kind));
  const { data } = useSuspenseQuery(
    taxonomyArchiveQueryOptions(kind, slug, {
      page,
      pageSize: settings.posts_per_page,
      sort,
    }),
  );
  const { t, i18n } = useTranslation();
  const lang: "pl" | "en" = i18n.language === "en" ? "en" : "pl";
  const podcastsQ = useQuery({
    ...podcastsByCategoryQueryOptions(data?.taxonomy.id ?? ""),
    enabled: kind === "category" && !!data?.taxonomy.id && settings.show_podcasts,
  });

  // Scroll to top when page changes (better UX than staying mid-scroll).
  useEffect(() => {
    if (typeof window !== "undefined" && page > 1) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [page]);

  if (!data) return <PublicNotFound />;
  const { taxonomy, posts, total, page: currentPage, pageSize, sort: currentSort } = data;

  const LayoutComponent = getLayoutComponent(settings.layout_variant);

  const emptyText = t("archive.empty", {
    defaultValue: lang === "en" ? "No published posts yet." : "Brak opublikowanych wpisów.",
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

  const onSortChange = (next: ArchiveSort) =>
    startTransition(() => {
      void navigate({
        to: kind === "category" ? "/category/$slug" : "/tag/$slug",
        params: { slug },
        search: { page: 1, sort: next },
      });
    });
  const onPageChange = (nextPage: number) =>
    startTransition(() => {
      void navigate({
        to: kind === "category" ? "/category/$slug" : "/tag/$slug",
        params: { slug },
        search: { page: nextPage, sort: currentSort },
      });
    });

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
        page={currentPage}
        pageSize={pageSize}
        total={total}
        sort={currentSort}
        onPageChange={onPageChange}
        onSortChange={onSortChange}
        isPending={isPending}
        emptyText={emptyText}
        extraBelow={extraBelow}
      />
    </>
  );
}
