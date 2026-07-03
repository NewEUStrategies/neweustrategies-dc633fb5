// Publiczny renderer: Najnowsze wpisy (Gutenberg "Latest Posts").
// Dane przez react-query (latestPostsBlockQueryOptions) - klucz zależny tylko
// od wejść bloku, więc prefetch SSR w loaderze $.tsx trafia w ten sam wpis
// cache i crawler dostaje wyrenderowaną listę zamiast szkieletu.

import { useQuery } from "@tanstack/react-query";
import { latestPostsBlockQueryOptions } from "@/lib/queries/blocks";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

interface Props {
  count: number;
  category: string;
  showExcerpt: boolean;
  showImage: boolean;
  layout: "list" | "grid";
  lang: "pl" | "en";
}

export function LatestPostsView({ count, category, showExcerpt, showImage, layout, lang }: Props) {
  const { data: rows = [], isPending } = useQuery(
    latestPostsBlockQueryOptions({ count: Math.max(1, Math.min(50, count)), category }),
  );

  if (isPending) return <div className="text-sm text-muted-foreground py-4">…</div>;
  if (rows.length === 0) return null;

  const wrap =
    layout === "grid"
      ? "not-prose grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
      : "not-prose flex flex-col gap-4";

  return (
    <div className={wrap}>
      {rows.map((p) => {
        const title = (lang === "pl" ? p.title_pl : p.title_en) ?? p.title_pl ?? p.title_en ?? "";
        const excerpt = (lang === "pl" ? p.excerpt_pl : p.excerpt_en) ?? "";
        return (
          <article
            key={p.id}
            className={layout === "grid" ? "flex flex-col gap-3" : "flex gap-4 items-start"}
          >
            {showImage && p.cover_image_url && (
              <AppLink
                href={`/post/${p.slug}`}
                className={
                  layout === "grid"
                    ? "block aspect-[4/3] overflow-hidden rounded-md"
                    : "flex-shrink-0 w-24 h-24 rounded-md overflow-hidden"
                }
              >
                <OptimizedImage
                  src={p.cover_image_url}
                  alt={title}
                  className="w-full h-full object-cover"
                />
              </AppLink>
            )}
            <div className="flex-1 min-w-0">
              <AppLink
                href={`/post/${p.slug}`}
                className="font-serif font-semibold hover:text-primary block"
              >
                {title}
              </AppLink>
              {showExcerpt && excerpt && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{excerpt}</p>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
