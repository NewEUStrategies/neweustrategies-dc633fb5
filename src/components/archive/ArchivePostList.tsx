// Reusable post-card list for archive pages (author/tag/category/search).
import { PostListCard } from "@/components/molecules/PostListCard";
import type { BlogListItem } from "@/lib/queries/public";

interface Props {
  posts: readonly BlogListItem[];
  lang: "pl" | "en";
  emptyText: string;
}

export function ArchivePostList({ posts, lang, emptyText }: Props) {
  if (posts.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {posts.map((p) => (
        <PostListCard key={p.id} post={p} lang={lang} />
      ))}
    </div>
  );
}
