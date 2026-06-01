// Organism: dynamic post grid/carousel sourced from Supabase.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { getNum } from "./frame";

type Lang = "pl" | "en";

export function PostListView({ c, lang, carousel = false }: { c: WidgetContent; lang: Lang; carousel?: boolean }) {
  const limit = getNum(c, "limit", 6);
  const cols = getNum(c, "columns", 3);
  const { data } = useQuery({
    queryKey: ["builder-post-list", limit],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
  });
  const cls = carousel ? "flex gap-4 overflow-x-auto pb-2 snap-x" : "grid gap-4";
  const style = carousel ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  return (
    <div className={cls} style={style}>
      {(data ?? []).map((p) => (
        <a key={p.id} href={`/post/${p.slug}`} className={`bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition ${carousel ? "min-w-[260px] snap-start" : ""}`}>
          {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover" />}
          <div className="p-4">
            <h4 className="font-display text-lg mb-1 line-clamp-2">{lang === "pl" ? p.title_pl : p.title_en}</h4>
            <p className="text-sm text-muted-foreground line-clamp-2">{lang === "pl" ? p.excerpt_pl : p.excerpt_en}</p>
          </div>
        </a>
      ))}
    </div>
  );
}
