// Organism: dynamic post grid/list/carousel sourced from Supabase.
// All query knobs (categories, tags, exclusions, author, format, order,
// limit, offset) are driven by widget content and edited via PostListEditor.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { getNum, getStr } from "./frame";

type Lang = "pl" | "en";

type Variant = "card" | "minimal" | "overlay" | "list" | "numbered";

interface PostRow {
  id: string;
  slug: string;
  title_pl: string | null;
  title_en: string | null;
  excerpt_pl: string | null;
  excerpt_en: string | null;
  cover_image_url: string | null;
  published_at: string | null;
  post_format: string | null;
  author_id: string | null;
}

function csv(c: WidgetContent, k: string): string[] {
  const v = getStr(c, k);
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

async function fetchPostIdsBySlugs(table: "post_categories" | "post_tags", slugs: string[]): Promise<Set<string>> {
  if (!slugs.length) return new Set();
  if (table === "post_categories") {
    const { data: cats } = await supabase.from("categories").select("id").in("slug", slugs);
    const ids = (cats ?? []).map((r: { id: string }) => r.id);
    if (!ids.length) return new Set();
    const { data: links } = await supabase.from("post_categories").select("post_id").in("category_id", ids);
    return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
  }
  const { data: tags } = await supabase.from("tags").select("id").in("slug", slugs);
  const ids = (tags ?? []).map((r: { id: string }) => r.id);
  if (!ids.length) return new Set();
  const { data: links } = await supabase.from("post_tags").select("post_id").in("tag_id", ids);
  return new Set((links ?? []).map((r: { post_id: string }) => r.post_id));
}

export function PostListView({ c, lang, carousel = false }: { c: WidgetContent; lang: Lang; carousel?: boolean }) {
  const variant = (getStr(c, "variant") || (carousel ? "card" : "card")) as Variant;
  const limit = Math.max(1, Math.min(100, getNum(c, "limit", 6)));
  const offset = Math.max(0, getNum(c, "offset", 0));
  const cols = Math.max(1, Math.min(6, getNum(c, "columns", 3)));
  const orderByRaw = getStr(c, "orderBy") || "published_at";
  const orderDir = (getStr(c, "orderDir") || "desc") === "asc" ? "asc" : "desc";
  const postFormat = getStr(c, "postFormat");
  const authorId = getStr(c, "authorId");

  const includeCats = csv(c, "categoriesCsv");
  const excludeCats = csv(c, "excludeCategoriesCsv");
  const includeTags = csv(c, "tagsCsv");
  const excludeTags = csv(c, "excludeTagsCsv");
  const includeIds = csv(c, "includeIdsCsv");
  const excludeIds = csv(c, "excludeIdsCsv");

  const queryKey = [
    "builder-post-list",
    { variant, limit, offset, cols, orderByRaw, orderDir, postFormat, authorId,
      includeCats, excludeCats, includeTags, excludeTags, includeIds, excludeIds },
  ] as const;

  const { data } = useQuery<PostRow[]>({
    queryKey,
    queryFn: async () => {
      // Resolve include/exclude ID sets from taxonomy filters first.
      const [incCatIds, incTagIds, excCatIds, excTagIds] = await Promise.all([
        fetchPostIdsBySlugs("post_categories", includeCats),
        fetchPostIdsBySlugs("post_tags", includeTags),
        fetchPostIdsBySlugs("post_categories", excludeCats),
        fetchPostIdsBySlugs("post_tags", excludeTags),
      ]);

      // Intersect include filters (taxonomy AND explicit IDs).
      let includeSet: Set<string> | null = null;
      const seed = (s: Set<string>) => {
        includeSet = includeSet ? new Set([...includeSet].filter((x) => s.has(x))) : new Set(s);
      };
      if (includeCats.length) seed(incCatIds);
      if (includeTags.length) seed(incTagIds);
      if (includeIds.length) seed(new Set(includeIds));
      if (includeSet !== null && (includeSet as Set<string>).size === 0) return [];

      const excludeSet = new Set<string>([...excCatIds, ...excTagIds, ...excludeIds]);

      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id")
        .eq("status", "published");

      if (postFormat) q = q.eq("post_format", postFormat);
      if (authorId) q = q.eq("author_id", authorId);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

      const orderCol = orderByRaw === "title" ? `title_${lang}` : orderByRaw === "random" ? "published_at" : orderByRaw;
      if (orderByRaw !== "random") {
        q = q.order(orderCol, { ascending: orderDir === "asc" });
      }
      q = q.range(offset, offset + limit - 1);

      const { data } = await q;
      let rows = (data ?? []) as PostRow[];
      if (orderByRaw === "random") rows = [...rows].sort(() => Math.random() - 0.5);
      return rows;
    },
  });

  const rows = data ?? [];
  if (!rows.length) {
    return (
      <div className="w-full text-xs text-muted-foreground border border-dashed border-border rounded-md p-4 text-center">
        Brak wpisów spełniających kryteria.
      </div>
    );
  }

  const title = (p: PostRow) => (lang === "pl" ? p.title_pl : p.title_en) || p.title_pl || p.title_en || "(bez tytułu)";
  const excerpt = (p: PostRow) => (lang === "pl" ? p.excerpt_pl : p.excerpt_en) || "";

  if (carousel) {
    return (
      <div className="w-full flex gap-4 overflow-x-auto pb-2 snap-x">
        {rows.map((p) => (
          <PostCard key={p.id} p={p} variant={variant} carousel title={title(p)} excerpt={excerpt(p)} />
        ))}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="w-full flex flex-col divide-y divide-border">

        {rows.map((p) => (
          <a key={p.id} href={`/post/${p.slug}`} className="flex gap-3 py-3 group">
            {p.cover_image_url && (
              <img src={p.cover_image_url} alt="" className="w-24 h-16 object-cover rounded-sm shrink-0" />
            )}
            <div className="min-w-0">
              <h4 className="font-display text-sm leading-snug line-clamp-2 group-hover:text-brand transition">
                {title(p)}
              </h4>
              {excerpt(p) && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{excerpt(p)}</p>
              )}
            </div>
          </a>
        ))}
      </div>
    );
  }

  if (variant === "numbered") {
    return (
      <div className="flex flex-col divide-y divide-border">
        {rows.map((p, i) => (
          <a key={p.id} href={`/post/${p.slug}`} className="flex items-center gap-4 py-5 group relative">
            <span
              aria-hidden
              className="font-display font-bold text-muted-foreground/20 leading-none select-none shrink-0 w-[1.6em] text-center"
              style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="font-display text-lg md:text-xl leading-snug line-clamp-3 group-hover:text-brand transition">
                {title(p)}
              </h4>
            </div>
            {p.cover_image_url && (
              <img
                src={p.cover_image_url}
                alt=""
                className="w-28 h-28 md:w-36 md:h-28 object-cover rounded-sm shrink-0"
              />
            )}
          </a>
        ))}
      </div>
    );
  }


  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {rows.map((p) => (
        <PostCard key={p.id} p={p} variant={variant} title={title(p)} excerpt={excerpt(p)} />
      ))}
    </div>
  );
}

function PostCard({
  p, variant, carousel = false, title, excerpt,
}: {
  p: PostRow;
  variant: Variant;
  carousel?: boolean;
  title: string;
  excerpt: string;
}) {
  const base = `bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition ${carousel ? "min-w-[260px] snap-start" : ""}`;

  if (variant === "overlay" && p.cover_image_url) {
    return (
      <a href={`/post/${p.slug}`} className={`relative block rounded-lg overflow-hidden ${carousel ? "min-w-[260px] snap-start" : ""}`}>
        <img src={p.cover_image_url} alt="" className="w-full h-56 object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-3 text-white">
          <h4 className="font-display text-lg leading-tight line-clamp-2">{title}</h4>
        </div>
      </a>
    );
  }

  if (variant === "minimal") {
    return (
      <a href={`/post/${p.slug}`} className={`block ${carousel ? "min-w-[260px] snap-start" : ""}`}>
        {p.cover_image_url && (
          <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover rounded-md mb-2" />
        )}
        <h4 className="font-display text-base leading-snug line-clamp-2 hover:text-brand transition">{title}</h4>
      </a>
    );
  }

  // default — card
  return (
    <a href={`/post/${p.slug}`} className={base}>
      {p.cover_image_url && (
        <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover" />
      )}
      <div className="p-4">
        <h4 className="font-display text-lg mb-1 line-clamp-2">{title}</h4>
        {excerpt && <p className="text-sm text-muted-foreground line-clamp-2">{excerpt}</p>}
      </div>
    </a>
  );
}
