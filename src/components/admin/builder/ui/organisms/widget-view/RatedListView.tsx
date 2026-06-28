// Organism: rated/ranked post list with manual/dynamic sourcing and rich styling.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import * as LucideIcons from "@/lib/lucide-shim";
import type { WidgetContent } from "@/lib/builder/types";
import { getStr } from "./frame";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";
import { AppLink } from "@/components/atoms/AppLink";

// Auto-derive a dark-mode color from the light value when the user hasn't
// explicitly set one (and vice versa). Empty string === inherit/default.
const autoDark = (light: string, dark: string): string =>
  dark || (light ? autoInvertColor(light, "dark") : "");
const autoLight = (dark: string, light: string): string =>
  light || (dark ? autoInvertColor(dark, "light") : "");
void autoLight;

type Lang = "pl" | "en";

type RatedItem = {
  title: string;
  excerpt: string;
  author: string;
  rating: number;
  href?: string;
  category?: string;
  date?: string;
  format?: string;
};

export function RatedListView({ c, lang, mode = "light" }: { c: WidgetContent; lang: Lang; mode?: "light" | "dark" }) {
  const source = getStr(c, "source") || "manual";
  const numFont = getStr(c, "numberFont") || "display";
  const numWeight = getStr(c, "numberWeight") || "700";
  const numSize = typeof c.numberSizePx === "number" ? c.numberSizePx : 52;
  const numColor = getStr(c, "numberColor") || "#000000";
  const numColorDarkRaw = getStr(c, "numberColorDark");
  const numColorDark = numColorDarkRaw || autoInvertColor(numColor, "dark");
  const numOpacity = typeof c.numberOpacity === "number" ? c.numberOpacity : 0.05;
  const numPos = getStr(c, "numberPosition") || "behind";
  const showRating = c.showRating !== false;

  const showCategory = c.showCategory === true;
  const categoryColor = getStr(c, "categoryColor") || "#dc2626";
  const categoryColorDarkRaw = getStr(c, "categoryColorDark");
  const categoryColorDark = categoryColorDarkRaw || autoInvertColor(categoryColor, "dark");
  const categorySize = typeof c.categorySizePx === "number" ? c.categorySizePx : 11;
  const categoryWeight = getStr(c, "categoryWeight") || "700";
  const categoryUppercase = c.categoryUppercase !== false;

  const titleColor = getStr(c, "titleColor");
  const titleColorDark = autoDark(titleColor, getStr(c, "titleColorDark"));
  const titleHoverColor = getStr(c, "titleHoverColor");
  const titleHoverColorDark = titleHoverColor ? autoInvertColor(titleHoverColor, "dark") : "";
  const titleWeight = getStr(c, "titleWeight") || "700";
  const titleFont = getStr(c, "titleFont") || "display";

  const showAuthor = c.showAuthor !== false;
  const showDate = c.showDate === true;
  const metaColor = getStr(c, "metaColor");
  const metaColorDark = autoDark(metaColor, getStr(c, "metaColorDark"));
  const metaSize = typeof c.metaSizePx === "number" ? c.metaSizePx : 12;

  const showExcerpt = c.showExcerpt !== false;
  const excerptColor = getStr(c, "excerptColor");
  const excerptColorDark = autoDark(excerptColor, getStr(c, "excerptColorDark"));
  const excerptLines = typeof c.excerptLines === "number" ? c.excerptLines : 3;

  const showReadMore = c.showReadMore === true;
  const readMoreText = getStr(c, `readMoreText_${lang}`) || (lang === "pl" ? "Czytaj więcej" : "Read more");
  const readMoreColor = getStr(c, "readMoreColor");
  const readMoreColorDark = autoDark(readMoreColor, getStr(c, "readMoreColorDark"));

  const showBookmark = c.showBookmark === true;
  const bookmarkColor = getStr(c, "bookmarkColor");
  const bookmarkColorDark = autoDark(bookmarkColor, getStr(c, "bookmarkColorDark"));
  const bookmarkSize = typeof c.bookmarkSizePx === "number" ? c.bookmarkSizePx : 16;

  const showPostFormat = c.showPostFormat === true;
  const postFormatColor = getStr(c, "postFormatColor");
  const postFormatColorDark = autoDark(postFormatColor, getStr(c, "postFormatColorDark"));

  const colorScheme = getStr(c, "colorScheme") || "auto";

  const colsD = typeof c.columnsDesktop === "number" ? c.columnsDesktop : 1;
  const colsT = typeof c.columnsTablet === "number" ? c.columnsTablet : Math.min(colsD, 2);
  const colsM = typeof c.columnsMobile === "number" ? c.columnsMobile : 1;
  const colGap = typeof c.columnGapPx === "number" ? c.columnGapPx : 24;
  const rowGap = typeof c.rowGapPx === "number" ? c.rowGapPx : 28;
  const gridBorders = getStr(c, "gridBorders") || "none";
  const gridBorderColor = getStr(c, "gridBorderColor") || "";
  const gridBorderWidth = typeof c.gridBorderWidthPx === "number" ? c.gridBorderWidthPx : 1;
  const itemSpacing = typeof c.itemSpacingPx === "number" ? c.itemSpacingPx : rowGap;
  const itemPadding = typeof c.itemPaddingPx === "number" ? c.itemPaddingPx : 0;
  const scrollingMode = getStr(c, "scrollingMode") || "none";
  const scrollMaxHeight = typeof c.scrollMaxHeightPx === "number" ? c.scrollMaxHeightPx : 400;
  const pageSize = typeof c.pageSize === "number" ? c.pageSize : 4;

  const fontCls =
    numFont === "sans" ? "font-sans"
    : numFont === "serif" ? "font-serif"
    : numFont === "mono" ? "font-mono"
    : "font-display";
  const titleFontCls =
    titleFont === "sans" ? "font-sans"
    : titleFont === "serif" ? "font-serif"
    : titleFont === "mono" ? "font-mono"
    : "font-display";
  const numStyle: CSSProperties = {
    fontSize: `clamp(${Math.round(numSize * 0.6)}px, ${Math.round(numSize * 0.08)}vw + ${Math.round(numSize * 0.5)}px, ${numSize}px)`,
    fontWeight: numWeight as CSSProperties["fontWeight"],
    opacity: numOpacity,
  };

  const manualItems: RatedItem[] = (Array.isArray(c.items) ? c.items as Array<Record<string, unknown>> : []).map((it) => ({
    title: (it[`title_${lang}`] || it.title_pl || "") as string,
    excerpt: (it[`excerpt_${lang}`] || it.excerpt_pl || "") as string,
    author: (it.author || "") as string,
    rating: typeof it.rating === "number" ? it.rating : 0,
    category: (it[`category_${lang}`] || it.category_pl || "") as string,
    date: (it.date || "") as string,
    format: (it.format || "standard") as string,
  }));

  const csv = (k: string) => (getStr(c, k) || "").split(",").map((s) => s.trim()).filter(Boolean);
  const cats = csv("categoriesFilter");
  const excludeCats = csv("excludeCategories");
  const tagSlugs = csv("tagsFilter");
  const excludeTagSlugs = csv("excludeTags");
  const postFormat = getStr(c, "postFormatFilter");
  const authors = csv("authorFilter");
  const postIds = csv("postIdsFilter");
  const excludePostIds = csv("excludePostIds");
  const orderBy = getStr(c, "orderBy") || "last_published";
  const limit = typeof c.numberOfPosts === "number" ? c.numberOfPosts : 4;
  const offset = typeof c.postOffset === "number" ? c.postOffset : 0;

  const queryKey = ["rated-list-dyn", { cats, excludeCats, tagSlugs, excludeTagSlugs, postFormat, authors, postIds, excludePostIds, orderBy, limit, offset }];
  const { data: dynItems } = useQuery({
    queryKey,
    enabled: source === "dynamic",
    queryFn: async (): Promise<RatedItem[]> => {
      const resolveByCategory = async (slugs: string[]) => {
        if (!slugs.length) return null;
        const { data } = await supabase.from("post_categories").select("post_id, categories!inner(slug)").in("categories.slug", slugs);
        return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
      };
      const resolveByTag = async (slugs: string[]) => {
        if (!slugs.length) return null;
        const { data } = await supabase.from("post_tags").select("post_id, tags!inner(slug)").in("tags.slug", slugs);
        return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
      };

      const [incCat, excCat, incTag, excTag] = await Promise.all([
        resolveByCategory(cats), resolveByCategory(excludeCats),
        resolveByTag(tagSlugs), resolveByTag(excludeTagSlugs),
      ]);

      let q = supabase.from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, published_at, post_format, author_id")
        .eq("status", "published");

      if (postFormat && postFormat !== "all") q = q.eq("post_format", postFormat);
      if (postIds.length) q = q.in("id", postIds);

      const includeIds = new Set<string>();
      let haveInclude = false;
      if (incCat) { haveInclude = true; incCat.forEach((id) => includeIds.add(id)); }
      if (incTag) {
        if (haveInclude) {
          for (const id of Array.from(includeIds)) if (!incTag.has(id)) includeIds.delete(id);
        } else {
          haveInclude = true; incTag.forEach((id) => includeIds.add(id));
        }
      }
      if (haveInclude) {
        if (includeIds.size === 0) return [];
        q = q.in("id", Array.from(includeIds));
      }

      const excludeIds = new Set<string>([...excludePostIds]);
      excCat?.forEach((id) => excludeIds.add(id));
      excTag?.forEach((id) => excludeIds.add(id));
      if (excludeIds.size) q = q.not("id", "in", `(${Array.from(excludeIds).join(",")})`);

      if (orderBy === "title_asc") q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: true });
      else if (orderBy === "title_desc") q = q.order(lang === "pl" ? "title_pl" : "title_en", { ascending: false });
      else q = q.order("published_at", { ascending: false });

      const from = Math.max(0, offset);
      const to = from + Math.max(1, limit) - 1;
      q = q.range(from, to);

      const { data } = await q;
      let rows = (data ?? []) as Array<{
        id: string; slug: string; title_pl: string; title_en: string;
        excerpt_pl: string | null; excerpt_en: string | null;
        published_at: string | null; post_format: string | null;
        author_id: string | null;
      }>;

      const authorIds = Array.from(new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x)));
      const authorMap = new Map<string, string>();
      if (authorIds.length) {
        const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", authorIds);
        (profs ?? []).forEach((p) => { if (p.display_name) authorMap.set(p.id, p.display_name); });
      }
      if (authors.length) rows = rows.filter((r) => r.author_id && authors.includes(authorMap.get(r.author_id) ?? ""));
      if (orderBy === "random") rows = rows.sort(() => Math.random() - 0.5);

      return rows.map((r) => ({
        title: (lang === "pl" ? r.title_pl : r.title_en) || r.title_pl,
        excerpt: ((lang === "pl" ? r.excerpt_pl : r.excerpt_en) || r.excerpt_pl || "") as string,
        author: (r.author_id && authorMap.get(r.author_id)) || "",
        rating: 0,
        href: `/post/${r.slug}`,
        date: r.published_at || "",
        format: r.post_format || "standard",
      }));
    },
  });

  const allItems: RatedItem[] = source === "dynamic" ? (dynItems ?? []) : manualItems;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const items = scrollingMode === "loadmore" ? allItems.slice(0, visibleCount) : allItems;

  const isCarousel = scrollingMode === "carousel";
  const isScroll = scrollingMode === "scroll";
  const isGrid = colsD > 1 || colsT > 1 || colsM > 1;

  const gridStyle: CSSProperties = isCarousel
    ? { display: "flex", gap: colGap, overflowX: "auto", scrollSnapType: "x mandatory" }
    : isGrid
    ? { display: "grid", gridTemplateColumns: `repeat(${colsD}, minmax(0, 1fr))`, columnGap: colGap, rowGap }
    : { display: "block" };

  const containerStyle: CSSProperties = {
    ...(isScroll ? { maxHeight: scrollMaxHeight, overflowY: "auto", paddingRight: 8 } : {}),
    ...(gridBorders === "full" ? { border: `${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"}`, padding: 12, borderRadius: 8 } : {}),
  };

  const formatIcon = (fmt?: string) => {
    const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string; style?: CSSProperties }>>;
    const map: Record<string, string> = { video: "Video", gallery: "Images", audio: "Music", quote: "Quote", link: "Link" };
    const key = map[fmt || ""] || "";
    return key ? Icons[key] : null;
  };
  const BookmarkIcon = (LucideIcons as Record<string, React.ComponentType<{ className?: string; style?: CSSProperties }>>).Bookmark;

  const schemeCls = colorScheme === "dark" ? "dark" : colorScheme === "light" ? "" : mode === "dark" ? "dark" : "";

  // Mark unused locals (used in CSS template only)
  void colsT; void colsM;

  return (
    <div className={schemeCls}>
      <style>{`
        .rl-wrap .rl-num{color:${numColor};}
        .dark .rl-wrap .rl-num{color:${numColorDark};}
        .rl-wrap .rl-cat{color:${categoryColor};}
        .dark .rl-wrap .rl-cat{color:${categoryColorDark};}
        ${titleColor ? `.rl-wrap .rl-title{color:${titleColor};}` : ""}
        ${titleColorDark ? `.dark .rl-wrap .rl-title{color:${titleColorDark};}` : ""}
        ${titleHoverColor ? `.rl-wrap .rl-title:hover{color:${titleHoverColor};}` : ""}
        ${titleHoverColorDark ? `.dark .rl-wrap .rl-title:hover{color:${titleHoverColorDark};}` : ""}
        ${metaColor ? `.rl-wrap .rl-meta{color:${metaColor};}` : ""}
        ${metaColorDark ? `.dark .rl-wrap .rl-meta{color:${metaColorDark};}` : ""}
        ${excerptColor ? `.rl-wrap .rl-exc{color:${excerptColor};}` : ""}
        ${excerptColorDark ? `.dark .rl-wrap .rl-exc{color:${excerptColorDark};}` : ""}
        ${readMoreColor ? `.rl-wrap .rl-more{color:${readMoreColor};}` : ""}
        ${readMoreColorDark ? `.dark .rl-wrap .rl-more{color:${readMoreColorDark};}` : ""}
        ${bookmarkColor ? `.rl-wrap .rl-bookmark{color:${bookmarkColor};}` : ""}
        ${bookmarkColorDark ? `.dark .rl-wrap .rl-bookmark{color:${bookmarkColorDark};}` : ""}
        ${postFormatColor ? `.rl-wrap .rl-format{color:${postFormatColor};}` : ""}
        ${postFormatColorDark ? `.dark .rl-wrap .rl-format{color:${postFormatColorDark};}` : ""}
        .rl-wrap .rl-item + .rl-item{${gridBorders === "between" && !isGrid ? `border-top:${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"};padding-top:${itemSpacing}px;` : ""}}
      `}</style>
      <ol className="rl-wrap" style={{ ...containerStyle, ...gridStyle, listStyle: "none", margin: 0, padding: gridBorders === "full" ? 12 : 0 }}>
        {items.map((it, i) => {
          const n = String(i + 1).padStart(2, "0");
          const numCls = `rl-num ${fontCls} select-none leading-none`;
          const isLeft = numPos === "left";
          const isTop = numPos === "top";
          const FmtIcon = showPostFormat ? formatIcon(it.format) : null;
          const itemStyle: CSSProperties = {
            ...(scrollingMode === "none" && i > 0 && !isGrid && gridBorders !== "between" ? { marginTop: itemSpacing } : {}),
            ...(isCarousel ? { minWidth: 280, scrollSnapAlign: "start" } : {}),
            ...(itemPadding ? { padding: itemPadding } : {}),
            ...(gridBorders === "between" && isGrid ? { borderBottom: `${gridBorderWidth}px solid ${gridBorderColor || "var(--border)"}`, paddingBottom: itemSpacing } : {}),
          };
          const titleStyle: CSSProperties = {
            fontWeight: titleWeight as CSSProperties["fontWeight"],
            lineHeight: 1.3,
          };
          const titleEl = (
            <h3 className={`rl-title cms-post-title ${titleFontCls} cursor-pointer ${isLeft || isTop ? "" : "pr-12"}`} style={titleStyle}>{it.title}</h3>
          );
          return (
            <li key={i} className={`rl-item relative ${isLeft ? "flex items-start gap-4" : ""}`} style={itemStyle}>
              {isLeft ? (
                <span className={numCls} style={numStyle}>{n}</span>
              ) : isTop ? (
                <span className={`block mb-2 ${numCls}`} style={numStyle}>{n}</span>
              ) : (
                <span className={`absolute -top-2 right-0 ${numCls}`} style={numStyle}>{n}</span>
              )}
              <div className={isLeft ? "flex-1 min-w-0" : ""}>
                {showBookmark && BookmarkIcon && (
                  <div className="float-right ml-2">
                    <BookmarkIcon className="rl-bookmark" style={{ width: bookmarkSize, height: bookmarkSize }} />
                  </div>
                )}
                {showCategory && it.category && (
                  <div className="rl-cat mb-1" style={{
                    fontSize: `${categorySize}px`,
                    fontWeight: categoryWeight as CSSProperties["fontWeight"],
                    textTransform: categoryUppercase ? "uppercase" : "none",
                    letterSpacing: categoryUppercase ? "0.05em" : undefined,
                  }}>{it.category}</div>
                )}
                <div className="flex items-center gap-1.5">
                  {FmtIcon && <FmtIcon className="rl-format w-3.5 h-3.5" />}
                  {it.href ? <AppLink href={it.href} className="block flex-1">{titleEl}</AppLink> : <div className="flex-1">{titleEl}</div>}
                </div>
                {showExcerpt && it.excerpt && (
                  <p className="rl-exc cms-post-excerpt text-muted-foreground mt-2" style={{
                    display: "-webkit-box",
                    WebkitLineClamp: excerptLines,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>{it.excerpt}</p>
                )}
                {showRating && it.rating > 0 && (
                  <div className="mt-3 flex items-center gap-3">
                    <div className="relative h-1.5 w-32 overflow-hidden rounded-full">
                      <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, #ef4444 0%, #f97316 25%, #facc15 50%, #a3e635 75%, #22c55e 100%)" }} />
                      <div className="absolute top-0 bottom-0 bg-background/40" style={{ left: `${Math.min(100, Math.max(0, it.rating * 10))}%`, right: 0 }} />
                    </div>
                    <span className="text-xs font-semibold whitespace-nowrap">
                      {it.rating} <span className="text-muted-foreground font-normal">{lang === "pl" ? "na 10" : "out of 10"}</span>
                    </span>
                  </div>
                )}
                {(showAuthor && it.author) || (showDate && it.date) ? (
                  <p className="rl-meta mt-2 text-muted-foreground" style={{ fontSize: `${metaSize}px` }}>
                    {showAuthor && it.author && <>- <span className="font-semibold text-foreground/80">{it.author}</span></>}
                    {showAuthor && it.author && showDate && it.date && " · "}
                    {showDate && it.date && <span>{new Date(it.date).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-US")}</span>}
                  </p>
                ) : null}
                {showReadMore && it.href && (
                  <AppLink href={it.href} className="rl-more inline-block mt-2 text-xs font-semibold hover:underline">{readMoreText} →</AppLink>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {scrollingMode === "loadmore" && visibleCount < allItems.length && (
        <div className="mt-4 text-center">
          <button type="button" onClick={() => setVisibleCount((v) => v + pageSize)}
            className="px-4 py-2 text-xs font-semibold border border-border rounded-md hover:bg-muted">
            {lang === "pl" ? "Pokaż więcej" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
