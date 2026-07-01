// Organism: dynamic post grid/list/carousel sourced from Supabase.
// All query knobs (categories, tags, exclusions, author, format, order,
// limit, offset, date range, popularity) are driven by widget content and
// edited via PostListEditor.
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetContent } from "@/lib/builder/types";
import { getNum, getStr } from "./frame";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";
import { AppLink } from "@/components/atoms/AppLink";
import { readThumbnailOverrides } from "@/lib/builder/thumbnailOverrides";
import { dedupeAndSlice, postListQueryOptions, type Lang, type PostRow } from "@/lib/builder/postListQuery";

// Cover renders across a 1-4 column responsive grid. Images are always painted
// into a stable frame so mobile CSS cannot stretch/squash their crop.
const GRID_COVER_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw";
const COVER_IMG_CLASS = "absolute inset-0 block h-full w-full object-cover";

export type ImageAspect = "4/3" | "3/4" | "1/1" | "16/9";
const ASPECT_CLASS: Record<ImageAspect, string> = {
  "4/3": "aspect-[4/3]",
  "3/4": "aspect-[3/4]",
  "1/1": "aspect-square",
  "16/9": "aspect-[16/9]",
};
function aspectOf(c: WidgetContent): ImageAspect {
  const v = getStr(c, "imageAspect");
  return (v === "3/4" || v === "1/1" || v === "16/9" || v === "4/3") ? v : "4/3";
}
const tileFrame = (a: ImageAspect) => `relative block ${ASPECT_CLASS[a]} w-full shrink-0 overflow-hidden bg-muted`;
const overlayFrame = (a: ImageAspect) => `relative block ${ASPECT_CLASS[a]} w-full shrink-0 overflow-hidden bg-muted`;
const listFrame = (a: ImageAspect) => `relative block ${ASPECT_CLASS[a]} w-[112px] sm:w-[128px] shrink-0 overflow-hidden rounded-sm bg-muted`;

type Variant = "card" | "minimal" | "overlay" | "list" | "numbered" | "ranked" | "classic" | "flex-grid" | "boxed-grid" | "boxed-list";

export function PostListView({ c, lang, carousel = false, typography }: { c: WidgetContent; lang: Lang; carousel?: boolean; typography?: import("@/lib/builder/types").WidgetTypography }) {
  const { t } = useTranslation();
  const byLabel = t("hero.by", { defaultValue: lang === "pl" ? "Autor" : "By" });
  const titleWeight = getStr(c, "titleWeight");
  const excerptWeight = getStr(c, "excerptWeight");
  const titleSize = typography?.fontSize?.desktop;
  const descSize = typography?.descriptionFontSize?.desktop;
  const gapPx = typeof typography?.titleDescriptionGapPx === "number" ? typography.titleDescriptionGapPx : undefined;
  const titleStyle: React.CSSProperties = {
    ...(titleWeight ? { fontWeight: titleWeight as React.CSSProperties["fontWeight"] } : {}),
    ...(titleSize ? { fontSize: titleSize } : {}),
  };
  const excerptStyle: React.CSSProperties = {
    ...(excerptWeight ? { fontWeight: excerptWeight as React.CSSProperties["fontWeight"] } : {}),
    ...(descSize ? { fontSize: descSize } : {}),
    ...(typeof gapPx === "number" ? { marginTop: `${gapPx}px` } : {}),
  };
  const tStyle = Object.keys(titleStyle).length ? titleStyle : undefined;
  const eStyle = Object.keys(excerptStyle).length ? excerptStyle : undefined;
  const variant = (getStr(c, "variant") || (carousel ? "card" : "card")) as Variant;
  const aspect = aspectOf(c);
  const limit = Math.max(1, Math.min(100, getNum(c, "limit", 6)));
  const cols = Math.max(1, Math.min(6, getNum(c, "columns", 3)));
  const uniqueOnPage = c["uniqueOnPage"] === true || c["uniqueOnPage"] === "true";
  const mobileHScroll = c["mobileHorizontalScroll"] === true || c["mobileHorizontalScroll"] === "true";

  const used = useUsedPostIds();
  // Stable, snapshot-independent query: the server prefetch / stream gate and the
  // client resolve the SAME cache entry, so a streamed uniqueOnPage widget reuses
  // the dehydrated rows instead of refetching under a divergent key (no skeleton
  // flash). When uniqueOnPage the query over-fetches (see postListInput) so the
  // client de-dup below can still fill the grid.
  const { data, isPending, isFetching } = useQuery(postListQueryOptions(c, lang));

  // uniqueOnPage de-dup is a CLIENT-ONLY display refinement, never part of the
  // query key. `excludeIds` starts empty - so the server render and the first
  // client (hydration) render are identical (no hydration mismatch) - then adopts
  // the page snapshot after mount, refining the visible rows from already-cached
  // data without any network round-trip.
  const [excludeIds, setExcludeIds] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!uniqueOnPage) return;
    setExcludeIds(used.getSnapshot());
  }, [uniqueOnPage, used, data]);

  const overrides = useMemo(() => readThumbnailOverrides(c), [c]);
  const visibleRows = uniqueOnPage ? dedupeAndSlice(data ?? [], excludeIds, limit) : (data ?? []).slice(0, limit);
  const rows = visibleRows.map((p) =>
    overrides[p.id] ? { ...p, cover_image_url: overrides[p.id] } : p,
  );

  // Register the IDs this widget actually DISPLAYS (not the over-fetched extras)
  // so later uniqueOnPage widgets exclude exactly what the reader saw. Keyed on
  // the joined id list so it re-runs only when the visible set changes;
  // register() is idempotent (set union).
  const visibleIdsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (visibleIdsKey) used.register(visibleIdsKey.split(","));
  }, [visibleIdsKey, used]);

  // Fetch author display names for variants that show "By <author>".
  const authorIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))),
    [rows],
  );
  const { data: authorMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["builder-post-authors", authorIds],
    enabled: authorIds.length > 0 && (variant === "ranked" || variant === "numbered"),
    queryFn: async () => {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", authorIds);
      const m: Record<string, string> = {};
      for (const r of (profs ?? []) as Array<{ id: string; display_name: string | null }>) {
        if (r.display_name) m[r.id] = r.display_name;
      }
      return m;
    },
  });
  const authorName = (p: PostRow) => (p.author_id ? authorMap[p.author_id] ?? "" : "");

  const effectiveCols = Math.max(1, Math.min(cols, rows.length || 1));
  if (!rows.length) {
    // While the query is still running (initial mount or background refetch
    // with no cached data yet) render a neutral skeleton instead of the
    // "no results" copy - that copy was flashing on first paint before the
    // network request resolved, which read like a broken render.
    if (isPending || (isFetching && data === undefined)) {
      const skeletonCount = Math.max(1, Math.min(limit, cols * 2));
      return (
        <div
          className="grid gap-4 w-full"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, cols)}, minmax(0, 1fr))` }}
          aria-busy="true"
          aria-live="polite"
        >
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="aspect-[4/3] w-full rounded-md skeleton-shimmer" />
              <div className="h-4 w-3/4 rounded skeleton-shimmer" />
              <div className="h-3 w-1/2 rounded skeleton-shimmer" />
            </div>
          ))}
        </div>
      );
    }
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
          <PostCard key={p.id} p={p} variant={variant} aspect={aspect} carousel title={title(p)} excerpt={excerpt(p)} titleStyle={tStyle} excerptStyle={eStyle} />
        ))}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div className="w-full flex flex-col divide-y divide-border">
        {rows.map((p) => (
          <AppLink
            key={p.id}
            href={`/post/${p.slug}`}
            className={`grid ${p.cover_image_url ? "grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[128px_minmax(0,1fr)]" : "grid-cols-1"} items-start gap-3 sm:gap-4 py-3 group`}
          >
            {p.cover_image_url && (
              <WidgetMediaImage
                src={p.cover_image_url}
                alt=""
                frameClassName={listFrame(aspect)}
                responsiveWidths={[128, 256, 384]}
                sizes="(max-width: 640px) 112px, 128px"
                foregroundClassName={COVER_IMG_CLASS}
              />
            )}
            <div className="min-w-0">
              <h4
                className="cms-post-title leading-snug line-clamp-2"
                style={tStyle}
              >
                {title(p)}
              </h4>
              {excerpt(p) && (
                <p className="cms-post-excerpt line-clamp-2" style={eStyle}>
                  {excerpt(p)}
                </p>
              )}
            </div>
          </AppLink>
        ))}
      </div>
    );
  }

  if (variant === "ranked") {
    // Ranked list - no image, big translucent number on the right, title + "By <author>".
    const idxSize = getNum(c, "indexSizePx", 52);
    const idxColor = getStr(c, "indexColor") || "var(--td-li-light, rgb(35,31,32))";
    const idxColorDark = getStr(c, "indexColorDark") || "var(--td-li-dark, rgb(250,147,70))";
    const idxOpacity = (() => {
      const v = getNum(c, "indexOpacity", -1);
      return v < 0 ? "var(--td-li-opacity, 0.18)" : String(Math.max(0, Math.min(1, v)));
    })();
    const idxWeight = getStr(c, "indexWeight") || "var(--td-li-weight, 800)";
    const idxSide = (getStr(c, "indexSide") || "right") === "left" ? "left" : "right";
    const idxVAlign = (() => {
      const v = getStr(c, "indexVAlign") || "top";
      return v === "middle" || v === "bottom" ? v : "top";
    })();
    // Override the CSS class transform that defaults to translate(-0.08em, -50%).
    const vPos: React.CSSProperties =
      idxVAlign === "top"
        ? { top: 0, bottom: "auto", transform: "translate(0, 0)" }
        : idxVAlign === "bottom"
        ? { top: "auto", bottom: 0, transform: "translate(0, 0)" }
        : { top: "50%", bottom: "auto", transform: "translateY(-50%)" };

    return (
      <div
        className="w-full flex flex-col divide-y divide-border"
        style={{
          "--pl-num-light": idxColor,
          "--pl-num-dark": idxColorDark,
          "--pl-num-opacity": idxOpacity,
        } as React.CSSProperties}
      >
        {rows.map((p, i) => (
          <AppLink
            key={p.id}
            href={`/post/${p.slug}`}
            className="block py-4 sm:py-5 group"
          >
            {/* Title-anchored wrapper - the number is positioned relative to this
                box so its top edge aligns exactly with the title's top edge and
                never overflows the row. */}
            <div className="relative isolate overflow-hidden min-w-0 w-full text-left">
              <span
                aria-hidden
                className="post-list-numbered-index font-display tabular-nums select-none leading-none"
                style={{
                  ["--pl-num-fs" as string]: `${idxSize}px`,
                  fontWeight: idxWeight as React.CSSProperties["fontWeight"],
                  position: "absolute",
                  left: idxSide === "left" ? 0 : "auto",
                  right: idxSide === "right" ? 0 : "auto",
                  ...vPos,
                  textAlign: idxSide,
                  pointerEvents: "none",
                  zIndex: 0,
                } as React.CSSProperties}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="relative z-10">
                <h4
                  className="cms-post-title leading-snug line-clamp-3"
                  style={tStyle}
                >
                  {title(p)}
                </h4>
                {authorName(p) && (
                  <div className="mt-2 text-[13px] text-muted-foreground">
                    <span className="opacity-70">{byLabel}</span>{" "}
                    <span className="font-medium text-foreground">{authorName(p)}</span>
                  </div>
                )}
              </div>
            </div>
          </AppLink>
        ))}
      </div>
    );
  }



  if (variant === "numbered") {
    // Big faint index on the left, title in the middle, thumbnail on the right.
    // Defaults unified with the "ranked" variant (size 52, opacity 0.18) so both
    // numbered styles share the same visual rhythm out of the box.
    const idxSize = getNum(c, "indexSizePx", 52);
    const idxColor = getStr(c, "indexColor") || "";
    const idxColorDark = getStr(c, "indexColorDark") || "";
    const idxOpacity = (() => {
      const v = getNum(c, "indexOpacity", -1);
      return v < 0 ? "var(--td-li-opacity, 0.18)" : String(Math.max(0, Math.min(1, v)));
    })();
    const idxWeight = getStr(c, "indexWeight") || "var(--td-li-weight, 800)";
    const idxSide = (getStr(c, "indexSide") || "right") === "left" ? "left" : "right";
    const idxVAlign = (() => {
      const v = getStr(c, "indexVAlign") || "top";
      return v === "middle" || v === "bottom" ? v : "top";
    })();
    const showExcerpt = false;
    // Fall back to global Theme Design tokens when widget colors are empty.
    const lightColor = idxColor || "var(--td-li-light, rgb(35,31,32))";
    const darkColor = idxColorDark || "var(--td-li-dark, rgb(250,147,70))";
    // Inline vertical position - aligns numeral to the title row (top) by default
    // so it shares the baseline with the headline, not the geometric row center.
    const vPos: React.CSSProperties =
      idxVAlign === "top"
        ? { top: "0", bottom: "auto", transform: "translateY(0)" }
        : idxVAlign === "bottom"
        ? { top: "auto", bottom: "0", transform: "translateY(0)" }
        : { top: "50%", bottom: "auto", transform: "translateY(-50%)" };
    return (
      <div
        className="w-full flex flex-col divide-y divide-border"
        style={{
          "--pl-num-light": lightColor,
          "--pl-num-dark": darkColor,
          "--pl-num-opacity": idxOpacity,
        } as React.CSSProperties}
      >
        {rows.map((p, i) => (
          <AppLink
            key={p.id}
            href={`/post/${p.slug}`}
            className={`grid items-start gap-3 sm:gap-4 py-4 sm:py-5 group ${
              p.cover_image_url
                ? "grid-cols-[minmax(0,1fr)_minmax(90px,32%)] sm:grid-cols-[minmax(0,1fr)_minmax(120px,28%)]"
                : "grid-cols-1"
            }`}

          >
            <div className="relative min-w-0 text-left isolate overflow-hidden">
              <span
                aria-hidden
                className="post-list-numbered-index font-display tabular-nums"
                style={{
                  ["--pl-num-fs" as string]: `${idxSize}px`,
                  fontWeight: idxWeight as React.CSSProperties["fontWeight"],
                  left: idxSide === "left" ? "0" : "auto",
                  right: idxSide === "right" ? "0" : "auto",
                  ...vPos,
                  textAlign: idxSide,
                } as React.CSSProperties}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className={`relative z-10 ${idxSide === "left" ? "pl-1 pr-1" : "pr-1 pl-1"}`}>

                <h4
                  className="cms-post-title leading-snug line-clamp-3"
                  style={tStyle}
                >
                  {title(p)}
                </h4>
                {showExcerpt && excerpt(p) && (
                  <p
                    className="cms-post-excerpt hidden sm:block line-clamp-2"
                    style={eStyle}
                  >
                    {excerpt(p)}
                  </p>
                )}
              </div>
            </div>
            {p.cover_image_url && (
              <WidgetMediaImage
                src={p.cover_image_url}
                alt=""
                frameClassName={`relative block ${ASPECT_CLASS[aspect]} w-full shrink-0 overflow-hidden rounded-md bg-muted`}
                responsiveWidths={[120, 160, 240, 320]}
                sizes="(max-width: 640px) 96px, (max-width: 1024px) 140px, 180px"
                foregroundClassName={COVER_IMG_CLASS}
              />
            )}


          </AppLink>
        ))}
      </div>
    );
  }
  if (variant === "classic") {
    // Single-column lead layout - big cover, headline + excerpt below. Stacks N items.
    return (
      <div className="w-full flex flex-col gap-8">
        {rows.map((p) => (
          <AppLink key={p.id} href={`/post/${p.slug}`} className="block group">
            {p.cover_image_url && (
              <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName={`${tileFrame(aspect)} rounded-md mb-4`} sizes="(max-width: 1024px) 100vw, 900px" foregroundClassName={COVER_IMG_CLASS} />
            )}
            <h3 className="cms-post-title leading-tight line-clamp-3" style={tStyle}>{title(p)}</h3>
            {excerpt(p) && <p className="cms-post-excerpt mt-2 line-clamp-3" style={eStyle}>{excerpt(p)}</p>}
          </AppLink>
        ))}
      </div>
    );
  }

  if (variant === "flex-grid" && rows.length > 0) {
    // 1 large lead (asymmetric ~1.35fr) + remaining as compact side rows.
    const [lead, ...rest] = rows;
    return (
        <div className="w-full grid gap-5 md:gap-8 grid-cols-1 md:grid-cols-[1.35fr_minmax(0,1fr)]">
        <AppLink href={`/post/${lead.slug}`} className="group block">
          {lead.cover_image_url && (
            <div className="relative mb-3 sm:mb-4 overflow-hidden rounded-md">
              <WidgetMediaImage
                src={lead.cover_image_url}
                alt=""
                frameClassName={`relative block aspect-[16/9] md:aspect-[16/10] w-full shrink-0 overflow-hidden bg-muted`}
                sizes="(max-width: 768px) 100vw, 58vw"
                foregroundClassName={`${COVER_IMG_CLASS} transition-transform duration-500 group-hover:scale-[1.03]`}
              />
            </div>
          )}
          <h3 className="cms-post-title text-[1.35em] leading-tight line-clamp-3 transition-colors group-hover:text-brand" style={tStyle}>{title(lead)}</h3>
          {excerpt(lead) && <p className="cms-post-excerpt mt-2 line-clamp-3 text-muted-foreground" style={eStyle}>{excerpt(lead)}</p>}
        </AppLink>
        <ol className="flex flex-col">
          {rest.map((p, i) => (
            <li key={p.id} className="border-b border-border/60 last:border-0">
              <AppLink
                href={`/post/${p.slug}`}
                className={`grid ${p.cover_image_url ? "grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[104px_minmax(0,1fr)]" : "grid-cols-[28px_minmax(0,1fr)]"} items-start gap-2.5 sm:gap-3 py-3 sm:py-3.5 first:pt-0 group`}
              >
                {p.cover_image_url ? (
                  <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName={`relative block aspect-[4/3] w-full shrink-0 overflow-hidden rounded-sm bg-muted`} sizes="104px" foregroundClassName={COVER_IMG_CLASS} />
                ) : (
                  <span className="font-serif text-lg tabular-nums text-brand/80 leading-none pt-0.5">{String(i + 1).padStart(2, "0")}</span>
                )}
                <h4 className="cms-post-title leading-snug line-clamp-3 transition-colors group-hover:text-brand" style={tStyle}>{title(p)}</h4>
              </AppLink>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (variant === "boxed-list") {
    return (
      <div data-widget-grid className={`w-full grid gap-3 sm:gap-4 ${mobileHScroll ? "cms-mobile-hscroll" : ""}`} style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}>
        {rows.map((p) => (
          <AppLink
            key={p.id}
            href={`/post/${p.slug}`}
            className={`group grid ${p.cover_image_url ? "grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[128px_minmax(0,1fr)] lg:grid-cols-[144px_minmax(0,1fr)]" : "grid-cols-1"} items-stretch gap-3 sm:gap-4 p-2.5 sm:p-3.5 rounded-lg bg-card border border-border/70 hover:border-brand/60 hover:shadow-[0_6px_20px_-8px_rgba(0,0,0,0.18)] transition-all`}
          >
            {p.cover_image_url && (
              <div className="overflow-hidden rounded-md">
                <WidgetMediaImage
                  src={p.cover_image_url}
                  alt=""
                  frameClassName={`relative block ${ASPECT_CLASS[aspect]} w-full shrink-0 overflow-hidden bg-muted`}
                  sizes="144px"
                  foregroundClassName={`${COVER_IMG_CLASS} transition-transform duration-500 group-hover:scale-[1.05]`}
                />
              </div>
            )}
            <div className="min-w-0 flex flex-col justify-center py-0.5">
              <h4 className="cms-post-title leading-snug line-clamp-2 transition-colors group-hover:text-brand" style={tStyle}>{title(p)}</h4>
              {excerpt(p) && <p className="cms-post-excerpt mt-1.5 line-clamp-2 text-muted-foreground" style={eStyle}>{excerpt(p)}</p>}
            </div>
          </AppLink>
        ))}
      </div>
    );
  }

  return (
    <div
      data-widget-grid
      className={`w-full grid gap-4 ${mobileHScroll ? "cms-mobile-hscroll" : ""}`}
      style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
    >

      {rows.map((p) => (
        <PostCard key={p.id} p={p} variant={variant} aspect={aspect} title={title(p)} excerpt={excerpt(p)} titleStyle={tStyle} excerptStyle={eStyle} />
      ))}
    </div>
  );
}

function PostCard({
  p, variant, aspect, carousel = false, title, excerpt, titleStyle, excerptStyle,
}: {
  p: PostRow;
  variant: Variant;
  aspect: ImageAspect;
  carousel?: boolean;
  title: string;
  excerpt: string;
  titleStyle?: React.CSSProperties;
  excerptStyle?: React.CSSProperties;
}) {
  const isBoxed = variant === "boxed-grid";
  const base = `${isBoxed ? "bg-card" : "bg-transparent"} border border-border rounded-md overflow-hidden hover:border-brand transition ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`;

  if (variant === "overlay" && p.cover_image_url) {
    return (
      <AppLink
        href={`/post/${p.slug}`}
        className={`group relative block overflow-hidden rounded-md ring-1 ring-black/5 shadow-[0_4px_18px_-8px_rgba(0,0,0,0.35)] hover:shadow-[0_10px_28px_-10px_rgba(0,0,0,0.55)] transition-shadow min-h-[180px] sm:min-h-[220px] ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`}
      >
        <WidgetMediaImage
          src={p.cover_image_url}
          alt=""
          frameClassName={overlayFrame(aspect)}
          sizes={GRID_COVER_SIZES}
          foregroundClassName={`${COVER_IMG_CLASS} transition-transform duration-700 group-hover:scale-[1.06]`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/5 sm:from-black/90 sm:via-black/45" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 text-white">
          <span className="inline-block h-[3px] w-8 bg-brand mb-2 rounded-full transition-all duration-300 group-hover:w-12" />
          <h4 className="cms-post-title text-sm sm:text-base leading-tight line-clamp-2 sm:line-clamp-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]" style={titleStyle}>{title}</h4>
        </div>
      </AppLink>
    );
  }

  if (variant === "minimal") {
    return (
      <AppLink href={`/post/${p.slug}`} className={`block group ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`}>
        {p.cover_image_url && (
          <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName={`${tileFrame(aspect)} rounded-sm mb-3`} sizes={GRID_COVER_SIZES} foregroundClassName={COVER_IMG_CLASS} />
        )}
        <h4 className="cms-post-title leading-snug line-clamp-2" style={titleStyle}>{title}</h4>
        {excerpt && <p className="cms-post-excerpt text-[13px] text-muted-foreground line-clamp-2 mt-1.5 leading-snug" style={excerptStyle}>{excerpt}</p>}
      </AppLink>
    );
  }

  // default - card
  return (
    <AppLink href={`/post/${p.slug}`} className={base}>
      {p.cover_image_url && (
        <WidgetMediaImage src={p.cover_image_url} alt="" frameClassName={tileFrame(aspect)} sizes={GRID_COVER_SIZES} foregroundClassName={COVER_IMG_CLASS} />
      )}
      <div className="p-3">
        <h4 className="cms-post-title leading-snug mb-1.5 line-clamp-2" style={titleStyle}>{title}</h4>
        {excerpt && <p className="cms-post-excerpt text-[13px] text-muted-foreground leading-snug line-clamp-2" style={excerptStyle}>{excerpt}</p>}
      </div>
    </AppLink>
  );
}
