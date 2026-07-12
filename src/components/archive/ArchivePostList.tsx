// Reusable post-card list for archive pages (author/tag/category/search).
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
}

export function ArchivePostList({ posts, lang, emptyText, emptyAction, getExcerptOverride }: Props) {
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
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <PostListCard
          key={p.id}
          post={p}
          href={p.href}
          lang={lang}
          viewTransitionId={p.id}
          excerptOverride={getExcerptOverride?.(p)}
        />
      ))}
    </div>
  );
}
