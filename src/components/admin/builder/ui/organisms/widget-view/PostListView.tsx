// Organism: dynamic post grid/list/carousel sourced from Supabase.
// All query knobs (categories, tags, exclusions, author, format, order,
// limit, offset, date range, popularity) are driven by widget content and
// edited via PostListEditor.
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { getNum, getStr } from "./frame";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

// Cover renders across a 1-4 column responsive grid. Images are always painted
// into a stable frame so mobile CSS cannot stretch/squash their crop.
const GRID_COVER_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw";
const COVER_IMG_CLASS = "absolute inset-0 block h-full w-full object-cover";
const TILE_FRAME_CLASS = "relative block aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted";
const OVERLAY_FRAME_CLASS = "relative block aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted";
const LIST_FRAME_CLASS = "relative block aspect-[4/3] w-[112px] sm:w-[128px] shrink-0 overflow-hidden rounded-sm bg-muted";

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
  const titleSizePx = getNum(c, "titleSizePx", 0);
  const titleWeight = getStr(c, "titleWeight");
  const excerptSizePx = getNum(c, "excerptSizePx", 0);
  const excerptWeight = getStr(c, "excerptWeight");
  const titleStyle: React.CSSProperties = {
    ...(titleSizePx > 0 ? { fontSize: `${titleSizePx}px`, lineHeight: 1.25 } : {}),
    ...(titleWeight ? { fontWeight: titleWeight as React.CSSProperties["fontWeight"] } : {}),
  };
  const excerptStyle: React.CSSProperties = {
    ...(excerptSizePx > 0 ? { fontSize: `${excerptSizePx}px`, lineHeight: 1.4 } : {}),
    ...(excerptWeight ? { fontWeight: excerptWeight as React.CSSProperties["fontWeight"] } : {}),
  };
  const tStyle = Object.keys(titleStyle).length ? titleStyle : undefined;
  const eStyle = Object.keys(excerptStyle).length ? excerptStyle : undefined;
  const variant = (getStr(c, "variant") || (carousel ? "card" : "card")) as Variant;
  const limit = Math.max(1, Math.min(100, getNum(c, "limit", 6)));
  const offset = Math.max(0, getNum(c, "offset", 0));
  const cols = Math.max(1, Math.min(6, getNum(c, "columns", 3)));
  const orderByRaw = getStr(c, "orderBy") || "published_at";
  const orderDir = (getStr(c, "orderDir") || "desc") === "asc" ? "asc" : "desc";
  const postFormat = getStr(c, "postFormat");
  const authorId = getStr(c, "authorId");
  const dateFrom = getStr(c, "dateFrom"); // ISO date "YYYY-MM-DD"
  const dateTo = getStr(c, "dateTo");
  const popularDays = Math.max(1, Math.min(365, getNum(c, "popularDays", 30)));
  const uniqueOnPage = c["uniqueOnPage"] === true || c["uniqueOnPage"] === "true";
  const mobileHScroll = c["mobileHorizontalScroll"] === true || c["mobileHorizontalScroll"] === "true";

  const includeCats = csv(c, "categoriesCsv");
  const excludeCats = csv(c, "excludeCategoriesCsv");
  const includeTags = csv(c, "tagsCsv");
  const excludeTags = csv(c, "excludeTagsCsv");
  const includeIds = csv(c, "includeIdsCsv");
  const excludeIds = csv(c, "excludeIdsCsv");

  const used = useUsedPostIds();
  // Snapshot once per mount so we don't re-fetch when other widgets register.
  const usedSnapshot = useMemo(
    () => (uniqueOnPage ? used.getSnapshot() : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uniqueOnPage],
  );

  const queryKey = [
    "builder-post-list",
    { variant, limit, offset, cols, orderByRaw, orderDir, postFormat, authorId,
      includeCats, excludeCats, includeTags, excludeTags, includeIds, excludeIds,
      dateFrom, dateTo, popularDays, usedSnapshot },
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

      const excludeSet = new Set<string>([...excCatIds, ...excTagIds, ...excludeIds, ...usedSnapshot]);

      // Popularity ordering (last N days, by user_read_history count).
      let popularIds: string[] | null = null;
      if (orderByRaw === "popular") {
        const sinceIso = new Date(Date.now() - popularDays * 86400 * 1000).toISOString();
        const { data: hist } = await supabase
          .from("user_read_history")
          .select("post_id")
          .gte("read_at", sinceIso);
        const counts = new Map<string, number>();
        for (const r of (hist ?? []) as { post_id: string }[]) {
          counts.set(r.post_id, (counts.get(r.post_id) ?? 0) + 1);
        }
        popularIds = Array.from(counts.entries())
          .sort((a, b) => (orderDir === "asc" ? a[1] - b[1] : b[1] - a[1]))
          .map(([id]) => id);
        if (!popularIds.length) return [];
        const popSet = new Set(popularIds);
        includeSet = includeSet ? new Set([...includeSet].filter((x) => popSet.has(x))) : popSet;
      }

      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id")
        .eq("status", "published");

      if (postFormat) q = q.eq("post_format", postFormat);
      if (authorId) q = q.eq("author_id", authorId);
      if (dateFrom) q = q.gte("published_at", `${dateFrom}T00:00:00Z`);
      if (dateTo) q = q.lte("published_at", `${dateTo}T23:59:59Z`);
      if (includeSet) q = q.in("id", Array.from(includeSet));
      if (excludeSet.size) q = q.not("id", "in", `(${Array.from(excludeSet).join(",")})`);

      const orderCol =
        orderByRaw === "title" ? `title_${lang}`
        : orderByRaw === "random" || orderByRaw === "popular" ? "published_at"
        : orderByRaw;
      if (orderByRaw !== "random" && orderByRaw !== "popular") {
        q = q.order(orderCol, { ascending: orderDir === "asc" });
      }
      // For popularity we fetch all matching rows (already constrained by includeSet)
      // and sort client-side; otherwise apply the requested DB range.
      if (orderByRaw !== "popular") {
        q = q.range(offset, offset + limit - 1);
      }

      const { data } = await q;
      let rows = (data ?? []) as PostRow[];
      if (orderByRaw === "random") rows = [...rows].sort(() => Math.random() - 0.5);
      if (orderByRaw === "popular" && popularIds) {
        const order = new Map(popularIds.map((id, i) => [id, i]));
        rows = [...rows].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
        rows = rows.slice(offset, offset + limit);
      }
      return rows;
    },
  });

  // Register fetched IDs so later "uniqueOnPage" widgets exclude them.
  useEffect(() => {
    if (data && data.length) used.register(data.map((r) => r.id));
  }, [data, used]);

  const rows = data ?? [];
  const effectiveCols = Math.max(1, Math.min(cols, rows.length || 1));
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
      <div className="w-full min-w-0 flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory">
        {rows.map((p) => (
          <PostCard key={p.id} p={p} variant={variant} carousel title={title(p)} excerpt={excerpt(p)} titleStyle={tStyle} excerptStyle={eStyle} />
        ))}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="w-full flex flex-col divide-y divide-border">
        {rows.map((p) => (
          <a
            key={p.id}
            href={`/post/${p.slug}`}
            className={`grid ${p.cover_image_url ? "grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[128px_minmax(0,1fr)]" : "grid-cols-1"} items-start gap-3 sm:gap-4 py-3 group`}
          >
            {p.cover_image_url && (
              <span data-widget-media className={LIST_FRAME_CLASS}>
                <OptimizedImage
                  src={p.cover_image_url}
                  alt=""
                  responsive
                  responsiveWidths={[128, 256, 384]}
                  sizes="(max-width: 640px) 112px, 128px"
                  className={COVER_IMG_CLASS}
                />
              </span>
            )}
            <div className="min-w-0">
              <h4
                className="font-display text-[15px] sm:text-base md:text-lg font-semibold leading-snug line-clamp-2 group-hover:text-brand transition"
                style={tStyle}
              >
                {title(p)}
              </h4>
              {excerpt(p) && (
                <p className="text-[13px] text-muted-foreground line-clamp-2 mt-1 leading-snug" style={eStyle}>
                  {excerpt(p)}
                </p>
              )}
            </div>
          </a>
        ))}
      </div>
    );
  }

  if (variant === "numbered") {
    const idxSize = getNum(c, "indexSizePx", 32);
    const idxColor = getStr(c, "indexColor") || "";
    const idxColorDark = getStr(c, "indexColorDark") || "";
    const idxOpacity = (() => {
      const v = getNum(c, "indexOpacity", -1);
      return v < 0 ? 0.05 : Math.max(0, Math.min(1, v));
    })();
    const idxWeight = getStr(c, "indexWeight") || "700";
    const lightColor = idxColor || `rgba(0,0,0,${idxOpacity})`;
    const darkColor = idxColorDark || `rgba(255,255,255,${idxOpacity})`;
    return (
      <div className="w-full flex flex-col divide-y divide-border">
        <style>{`.pl-num-light{color:${lightColor};} .dark .pl-num-light{color:${darkColor};}`}</style>
        {rows.map((p, i) => (
          <a key={p.id} href={`/post/${p.slug}`} className="relative flex items-center gap-3 py-3 group overflow-hidden">
            <span
              aria-hidden
              className="pl-num-light pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 font-display tabular-nums leading-none select-none"
              style={{ fontSize: `${idxSize}px`, fontWeight: idxWeight as React.CSSProperties["fontWeight"] }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1 relative text-left">
              <h4 className="font-display text-sm md:text-[15px] font-medium leading-snug group-hover:text-brand transition" style={tStyle}>
                {title(p)}
              </h4>
            </div>
          </a>
        ))}
      </div>
    );
  }




  return (
    <div
      className={`w-full grid gap-4 ${mobileHScroll ? "cms-mobile-hscroll" : ""}`}
      style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
    >
      {rows.map((p) => (
        <PostCard key={p.id} p={p} variant={variant} title={title(p)} excerpt={excerpt(p)} titleStyle={tStyle} excerptStyle={eStyle} />
      ))}
    </div>
  );
}

function PostCard({
  p, variant, carousel = false, title, excerpt, titleStyle, excerptStyle,
}: {
  p: PostRow;
  variant: Variant;
  carousel?: boolean;
  title: string;
  excerpt: string;
  titleStyle?: React.CSSProperties;
  excerptStyle?: React.CSSProperties;
}) {
  const base = `bg-card border border-border rounded-md overflow-hidden hover:border-brand transition ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`;

  if (variant === "overlay" && p.cover_image_url) {
    return (
      <a href={`/post/${p.slug}`} className={`relative block rounded-md overflow-hidden ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`}>
        <span data-widget-media className={OVERLAY_FRAME_CLASS}>
          <OptimizedImage src={p.cover_image_url} alt="" responsive sizes={GRID_COVER_SIZES} className={COVER_IMG_CLASS} />
        </span>
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-2.5 text-white">
          <h4 className="font-display text-sm leading-tight line-clamp-2" style={titleStyle}>{title}</h4>
        </div>
      </a>
    );
  }

  if (variant === "minimal") {
    return (
      <a href={`/post/${p.slug}`} className={`block ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`}>
        {p.cover_image_url && (
          <span data-widget-media className={`${TILE_FRAME_CLASS} rounded-sm mb-2`}>
            <OptimizedImage src={p.cover_image_url} alt="" responsive sizes={GRID_COVER_SIZES} className={COVER_IMG_CLASS} />
          </span>
        )}
        <h4 className="font-display text-sm leading-snug line-clamp-2 hover:text-brand transition" style={titleStyle}>{title}</h4>
      </a>
    );
  }

  // default - card
  return (
    <a href={`/post/${p.slug}`} className={base}>
      {p.cover_image_url && (
        <span data-widget-media className={TILE_FRAME_CLASS}>
          <OptimizedImage src={p.cover_image_url} alt="" responsive sizes={GRID_COVER_SIZES} className={COVER_IMG_CLASS} />
        </span>
      )}
      <div className="p-2.5">
        <h4 className="font-display text-sm font-medium leading-snug mb-1 line-clamp-2" style={titleStyle}>{title}</h4>
        {excerpt && <p className="text-xs text-muted-foreground leading-snug line-clamp-2" style={excerptStyle}>{excerpt}</p>}
      </div>
    </a>
  );
}
