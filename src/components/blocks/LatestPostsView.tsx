// Publiczny renderer: Najnowsze wpisy (Gutenberg "Latest Posts").
// Pobiera dane z Supabase publishable (RLS = published only).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppLink } from "@/components/atoms/AppLink";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

interface PostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_url: string | null;
  published_at: string | null;
}

interface Props {
  count: number;
  category: string;
  showExcerpt: boolean;
  showImage: boolean;
  layout: "list" | "grid";
  lang: "pl" | "en";
}

export function LatestPostsView({ count, category, showExcerpt, showImage, layout, lang }: Props) {
  const [rows, setRows] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const safeCount = Math.max(1, Math.min(50, count));
      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_url, published_at, status")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(safeCount);

      if (category) {
        q = q.contains("category_slugs", [category]);
      }

      const { data, error } = await q;
      if (cancelled) return;
      if (error || !data) {
        setRows([]);
      } else {
        setRows(data as unknown as PostRow[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [count, category]);

  if (loading) return <div className="text-sm text-muted-foreground py-4">…</div>;
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
          <article key={p.id} className={layout === "grid" ? "flex flex-col gap-3" : "flex gap-4 items-start"}>
            {showImage && p.cover_url && (
              <AppLink href={`/post/${p.slug}`} className={layout === "grid" ? "block aspect-[4/3] overflow-hidden rounded-md" : "flex-shrink-0 w-24 h-24 rounded-md overflow-hidden"}>
                <OptimizedImage src={p.cover_url} alt={title} className="w-full h-full object-cover" />
              </AppLink>
            )}
            <div className="flex-1 min-w-0">
              <AppLink href={`/post/${p.slug}`} className="font-serif font-semibold hover:text-primary block">
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
