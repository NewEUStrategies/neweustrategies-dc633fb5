// Shared body composition: sort/pagination bar + grid + optional sidebar + extras.
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PostListCard } from "@/components/molecules/PostListCard";
import { ArchivePosts } from "./ArchivePosts";
import { ArchiveSidebar } from "./ArchiveSidebar";
import { ArchiveToolbar } from "./ArchiveToolbar";
import { ArchivePagination } from "./ArchivePagination";
import type { ArchiveLayoutProps } from "./types";

export function ArchiveBody(props: ArchiveLayoutProps) {
  const {
    settings,
    posts,
    lang,
    taxonomy,
    kind,
    page,
    pageSize,
    total,
    sort,
    onPageChange,
    onSortChange,
    isPending,
    emptyText,
    extraBelow,
    previewMode,
    hasCustomFeaturedTop,
  } = props;
  const { t } = useTranslation();
  const withSidebar = settings.show_sidebar;
  const sidebarLeft = settings.sidebar_position === "left";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Generic featured-top card, used by all layouts except Magazine (which renders its own).
  const featured = posts[0];
  const showGenericFeatured =
    settings.show_featured_top && !hasCustomFeaturedTop && !!featured;
  const gridPosts = showGenericFeatured ? posts.slice(1) : posts;

  const grid = (
    <div className="min-w-0 flex-1">
      {showGenericFeatured && (
        <div className="mb-8 rounded-2xl overflow-hidden border border-border bg-card">
          <PostListCard
            post={featured}
            href={featured.href}
            lang={lang}
            viewTransitionId={featured.id}
          />
        </div>
      )}
      <ArchiveToolbar
        lang={lang}
        total={total}
        page={page}
        pageSize={pageSize}
        sort={sort}
        onSortChange={onSortChange}
        isPending={isPending}
        disabled={!!previewMode}
      />
      <ArchivePosts posts={gridPosts} lang={lang} settings={settings} emptyText={emptyText} />
      {totalPages > 1 && (
        <div className="pt-8">
          <ArchivePagination
            page={page}
            totalPages={totalPages}
            onPageChange={onPageChange}
            isPending={isPending}
            lang={lang}
            disabled={!!previewMode}
            t={t}
          />
        </div>
      )}
      {settings.show_related_taxonomies && (
        <RelatedTaxonomiesBlock
          kind={kind}
          taxonomyId={taxonomy.id}
          lang={lang}
          previewMode={!!previewMode}
        />
      )}
      {extraBelow}
    </div>
  );

  const sidebar = withSidebar ? (
    <div className="w-full lg:w-[320px] shrink-0">
      <ArchiveSidebar
        widgets={settings.sidebar_widgets}
        lang={lang}
        taxonomyId={taxonomy.id}
        kind={kind}
        posts={posts}
      />
    </div>
  ) : null;

  if (!withSidebar) return grid;
  return (
    <div className="flex flex-col lg:flex-row gap-8">
      {sidebarLeft ? sidebar : null}
      {grid}
      {sidebarLeft ? null : sidebar}
    </div>
  );
}

function RelatedTaxonomiesBlock({
  kind,
  taxonomyId,
  lang,
  previewMode,
}: {
  kind: "category" | "tag";
  taxonomyId: string;
  lang: "pl" | "en";
  previewMode: boolean;
}) {
  const title = lang === "en" ? (kind === "category" ? "Related categories" : "Related tags") : (kind === "category" ? "Powiązane kategorie" : "Powiązane tagi");

  // In preview mode we render deterministic mock chips so admins see the section.
  const mock = previewMode
    ? Array.from({ length: 6 }).map((_, i) => ({
        id: `mock-${i}`,
        slug: `preview-${i}`,
        name_pl: lang === "en" ? `Sample ${i + 1}` : `Przykład ${i + 1}`,
        name_en: `Sample ${i + 1}`,
      }))
    : null;

  const { data } = useQuery({
    queryKey: ["archive-related-block", kind, taxonomyId],
    queryFn: async () => {
      if (kind === "category") {
        const { data } = await supabase
          .from("categories")
          .select("id, slug, name_pl, name_en")
          .neq("id", taxonomyId)
          .limit(12);
        return data ?? [];
      }
      const { data } = await supabase
        .from("tags")
        .select("id, slug, name")
        .neq("id", taxonomyId)
        .limit(12);
      return (data ?? []).map((t) => ({
        id: t.id,
        slug: t.slug,
        name_pl: t.name,
        name_en: t.name,
      }));
    },
    staleTime: 5 * 60_000,
    enabled: !previewMode,
  });

  const items = mock ?? data ?? [];
  if (items.length === 0) return null;

  return (
    <section className="pt-10 mt-10 border-t border-border">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        {title}
      </h2>
      <div className="flex flex-wrap gap-2">
        {items.map((it) =>
          previewMode ? (
            <span
              key={it.id}
              className="px-3 py-1 rounded-full border border-border text-xs bg-card/60"
            >
              {lang === "en" ? it.name_en || it.name_pl : it.name_pl || it.name_en}
            </span>
          ) : (
            <Link
              key={it.id}
              to={kind === "category" ? "/category/$slug" : "/tag/$slug"}
              params={{ slug: it.slug }}
              className="px-3 py-1 rounded-full border border-border text-xs hover:bg-muted transition"
            >
              {lang === "en" ? it.name_en || it.name_pl : it.name_pl || it.name_en}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
