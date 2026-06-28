// Reusable post-card list for archive pages (author/tag/category/search).
import { Link } from "@tanstack/react-router";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import type { BlogListItem } from "@/lib/queries/public";

// Karty renderują się w siatce 1/2/3 kolumny w kontenerze max 1200px.
const CARD_IMAGE_SIZES =
  "(min-width: 1024px) 360px, (min-width: 768px) 45vw, 92vw";

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
      {posts.map((p) => {
        const title = lang === "en" ? p.title_en || p.title_pl : p.title_pl || p.title_en;
        const excerpt = lang === "en" ? p.excerpt_en : p.excerpt_pl;
        return (
          <Link
            key={p.id}
            to={p.href as "/"}
            className="bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition"
          >
            {p.cover_image_url && (
              <OptimizedImage
                src={p.cover_image_url}
                alt={title}
                className="w-full h-44 object-cover"
                responsive
                sizes={CARD_IMAGE_SIZES}
              />
            )}
            <div className="p-5">
              <h2 className="font-display text-xl mb-2 line-clamp-2">{title}</h2>
              {excerpt && (
                <p className="text-sm text-muted-foreground line-clamp-3">{excerpt}</p>
              )}
              {p.published_at && (
                <time className="block mt-3 text-xs text-muted-foreground">
                  {new Date(p.published_at).toLocaleDateString(lang === "en" ? "en-GB" : "pl-PL")}
                </time>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
