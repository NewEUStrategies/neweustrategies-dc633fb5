// Reusable post-card list for archive pages (author/tag/category/search).
import { Fragment } from "react";
import { Newspaper } from "@/lib/lucide-shim";
import { PostListCard } from "@/components/molecules/PostListCard";
import type { BlogListItem } from "@/lib/queries/public";

interface Props {
  posts: readonly BlogListItem[];
  lang: "pl" | "en";
  emptyText: string;
  /** Optional recovery action rendered under the empty message. */
  emptyAction?: React.ReactNode;
  /** Optional per-post excerpt override (e.g. search-hit snippet with <mark>). */
  getExcerptOverride?: (post: BlogListItem) => React.ReactNode | undefined;
  /** Smaller title font for denser lists like search results. */
  titleClassName?: string;
  /** Optional override of the responsive grid classes. */
  gridClassName?: string;
  /**
   * Optional in-feed insert rendered AFTER the card at a given index (ads
   * "every N cards", see useInFeedAds). Truthy output spans the full grid row.
   */
  renderAfterCard?: (index: number) => React.ReactNode;
}

export function ArchivePostList({
  posts,
  lang,
  emptyText,
  emptyAction,
  getExcerptOverride,
  titleClassName = "text-xl",
  gridClassName = "grid gap-6 md:grid-cols-2 lg:grid-cols-3",
  renderAfterCard,
}: Props) {
  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
        <Newspaper className="h-8 w-8 text-muted-foreground/70" aria-hidden="true" />
        <p className="text-sm text-muted-foreground max-w-sm">{emptyText}</p>
        {emptyAction}
      </div>
    );
  }
  return (
    <div className={gridClassName}>
      {posts.map((p, idx) => {
        const after = renderAfterCard?.(idx);
        return (
          <Fragment key={p.id}>
            <PostListCard
              post={p}
              href={p.href}
              lang={lang}
              viewTransitionId={p.id}
              excerptOverride={getExcerptOverride?.(p)}
              titleClassName={titleClassName}
            />
            {after && <div className="col-span-full flex justify-center py-2">{after}</div>}
          </Fragment>
        );
      })}
    </div>
  );
}
