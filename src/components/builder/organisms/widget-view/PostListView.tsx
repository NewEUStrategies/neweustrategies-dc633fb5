// Organism: dynamic post grid/list/carousel sourced from Supabase.
// All query knobs (categories, tags, exclusions, author, format, order,
// limit, offset, date range, popularity) are driven by widget content and
// edited via PostListEditor.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { WidgetContent } from "@/lib/builder/types";
import { getBool, getNum, getStr } from "./frame";
import { useUsedPostIds } from "@/lib/builder/usedPostIds";
import { useAboveFold } from "@/lib/builder/aboveFold";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { WidgetMediaImage } from "@/components/atoms/WidgetMediaImage";
import { AppLink } from "@/components/atoms/AppLink";
import { readThumbnailOverrides } from "@/lib/builder/thumbnailOverrides";
import {
  dedupeAndSlice,
  postListQueryOptions,
  type Lang,
  type PostRow,
} from "@/lib/builder/postListQuery";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import { AuthorByline } from "@/components/molecules/AuthorByline";
import {
  carouselAutoplayEnabled,
  carouselAutoplayIntervalMs,
} from "@/lib/builder/postListCarousel";
import { normalizeTypographyGapPx } from "@/lib/builder/typographyCss";
import {
  POST_LIST_CLASSIC_COVER_SIZES,
  POST_LIST_FLEX_LEAD_SIZES,
  POST_LIST_GRID_COVER_SIZES,
} from "@/lib/builder/widgetImageSizes";

// Cover renders across a 1-4 column responsive grid. Images are always painted
// into a stable frame so mobile CSS cannot stretch/squash their crop.
// `sizes` przychodzi ze wspólnego widgetImageSizes - z tego samego modułu
// korzysta budowniczy preloadu LCP (heroImage), więc preload i render nie mogą
// się rozjechać.
const GRID_COVER_SIZES = POST_LIST_GRID_COVER_SIZES;
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
  return v === "3/4" || v === "1/1" || v === "16/9" || v === "4/3" ? v : "4/3";
}
const tileFrame = (a: ImageAspect) =>
  `relative block ${ASPECT_CLASS[a]} w-full shrink-0 overflow-hidden bg-muted`;
const overlayFrame = (a: ImageAspect) =>
  `relative block ${ASPECT_CLASS[a]} w-full shrink-0 overflow-hidden bg-muted`;
const listFrame = (a: ImageAspect) =>
  `relative block ${ASPECT_CLASS[a]} w-[112px] sm:w-[128px] shrink-0 overflow-hidden rounded-sm bg-muted`;

// Per-line underline on mobile: line-clamp forces `display: -webkit-box`,
// so the parent `.cms-post-title` gradient collapses to a single bar.
// Wrapping the text in an inline span restores the per-line underline.
function TitleSpan({ title }: { title: string }) {
  return <span className="cms-title-underline">{title}</span>;
}

type Variant =
  | "card"
  | "minimal"
  | "overlay"
  | "list"
  | "numbered"
  | "ranked"
  | "classic"
  | "flex-grid"
  | "boxed-grid"
  | "boxed-list";

export function PostListView({
  c,
  lang,
  carousel = false,
  typography,
}: {
  c: WidgetContent;
  lang: Lang;
  carousel?: boolean;
  typography?: import("@/lib/builder/types").WidgetTypography;
}) {
  // Prezentacje autora rozstrzyga JEDEN rezolwer wspoldzielony z warstwa
  // zapytania (`authorDisplayMode` w postListQuery) i z panelem wlasciwosci.
  // Wczesniej widok mial wlasna kopie tej reguly (sztywne 20 px awatara, brak
  // rozmiaru czcionki), wiec ten sam autor renderowal sie inaczej niz w
  // sliderze, a redakcja nie miala jak tego zmienic.
  const authorDisplay = resolveAuthorDisplay(c, lang);
  const showAuthorAny = authorDisplay.visible;
  // Global display toggles - apply to every variant.
  const showCover = getStr(c, "showCover") !== "0";
  const showTitleGlobal = getStr(c, "showTitle") !== "0";
  const showExcerptGlobal = getStr(c, "showExcerpt") !== "0";

  const titleWeight = getStr(c, "titleWeight");
  const excerptWeight = getStr(c, "excerptWeight");
  const gapPx = normalizeTypographyGapPx(typography?.titleDescriptionGapPx);
  // Shared typography (font family, alignment, transform, decoration, line-height,
  // letter-spacing, italic/normal) is applied to BOTH title and excerpt so the
  // Typography tab produces real-time visual changes in every variant.
  const sharedTypo: React.CSSProperties = {
    ...(typography?.fontFamily ? { fontFamily: typography.fontFamily } : {}),
    ...(typography?.fontStyle ? { fontStyle: typography.fontStyle } : {}),
    ...(typography?.textAlign
      ? { textAlign: typography.textAlign as React.CSSProperties["textAlign"] }
      : {}),
    ...(typography?.textTransform
      ? { textTransform: typography.textTransform as React.CSSProperties["textTransform"] }
      : {}),
    ...(typography?.textDecoration ? { textDecoration: typography.textDecoration } : {}),
    ...(typography?.lineHeight ? { lineHeight: typography.lineHeight } : {}),
    ...(typography?.letterSpacing ? { letterSpacing: typography.letterSpacing } : {}),
  };
  // Widget-content weight (titleWeight/excerptWeight) wins over the shared
  // typography.fontWeight so per-part overrides keep working.
  const typoWeight = typography?.fontWeight;
  const titleStyle: React.CSSProperties = {
    ...sharedTypo,
    ...(typoWeight ? { fontWeight: typoWeight as React.CSSProperties["fontWeight"] } : {}),
    ...(titleWeight ? { fontWeight: titleWeight as React.CSSProperties["fontWeight"] } : {}),
  };
  const excerptStyle: React.CSSProperties = {
    ...sharedTypo,
    ...(typoWeight ? { fontWeight: typoWeight as React.CSSProperties["fontWeight"] } : {}),
    ...(excerptWeight ? { fontWeight: excerptWeight as React.CSSProperties["fontWeight"] } : {}),
    ...(typeof gapPx === "number" ? { marginTop: `${gapPx}px` } : {}),
  };
  const tStyle = Object.keys(titleStyle).length ? titleStyle : undefined;
  const eStyle = Object.keys(excerptStyle).length ? excerptStyle : undefined;
  const variant = (getStr(c, "variant") || (carousel ? "card" : "card")) as Variant;
  const aspect = aspectOf(c);
  const limit = Math.max(1, Math.min(100, getNum(c, "limit", 6)));
  const cols = Math.max(1, Math.min(6, getNum(c, "columns", 3)));
  const uniqueOnPage = getBool(c, "uniqueOnPage", false);
  const mobileHScroll = getBool(c, "mobileHorizontalScroll", false);

  const used = useUsedPostIds();
  // Widget w sekcji nad zgięciem: WYŁĄCZNIE obraz wiodący (pierwsza karta /
  // lead) dostaje eager + fetchpriority=high - to on bywa elementem LCP, gdy
  // strona otwiera się post-listą zamiast sliderem. Miniatury list zostają
  // leniwe: nie konkurują o pasmo z prawdziwym kandydatem LCP.
  const aboveFold = useAboveFold();
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
  const visibleRows = uniqueOnPage
    ? dedupeAndSlice(data ?? [], excludeIds, limit)
    : (data ?? []).slice(0, limit);
  const rows = visibleRows.map((p) => {
    const withOverride = overrides[p.id] ? { ...p, cover_image_url: overrides[p.id] } : p;
    return showCover ? withOverride : { ...withOverride, cover_image_url: null };
  });

  // Register the IDs this widget actually DISPLAYS (not the over-fetched extras)
  // so later uniqueOnPage widgets exclude exactly what the reader saw. Keyed on
  // the joined id list so it re-runs only when the visible set changes;
  // register() is idempotent (set union).
  const visibleIdsKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    if (visibleIdsKey) used.register(visibleIdsKey.split(","));
  }, [visibleIdsKey, used]);

  // Author display names arrive WITH the rows (resolved inside the post-list
  // query, see attachAuthorNames) - covered by the SSR prefetch, so bylines
  // never pop in via a late client-side fetch.
  const authorName = (p: PostRow) => p.author_display_name ?? "";

  // Byline NIE jest linkiem: karta/wiersz listy jest juz opakowana w <AppLink>,
  // a zagniezdzony <a> to nieprawidlowy HTML (przegladarka rozrywa DOM i psuje
  // nawigacje klawiatura).
  const AuthorMeta = ({ p, tone = "default" }: { p: PostRow; tone?: "default" | "onDark" }) => {
    if (!showAuthorAny) return null;
    const name = authorName(p);
    if (!name) return null;
    return (
      <div className="cms-meta mt-2 flex min-w-0 items-center">
        <AuthorByline
          name={name}
          avatarUrl={p.author_avatar_url}
          display={authorDisplay}
          tone={tone}
        />
      </div>
    );
  };

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
      <div className="cms-meta w-full border border-dashed border-border rounded-md p-4 text-center">
        {lang === "pl" ? "Brak wpisów spełniających kryteria." : "No posts match the criteria."}
      </div>
    );
  }

  const title = (p: PostRow) => {
    if (!showTitleGlobal) return "";
    return (
      (lang === "pl" ? p.title_pl : p.title_en) ||
      p.title_pl ||
      p.title_en ||
      (lang === "pl" ? "(bez tytułu)" : "(untitled)")
    );
  };
  const excerpt = (p: PostRow) => {
    if (!showExcerptGlobal) return "";
    return (lang === "pl" ? p.excerpt_pl : p.excerpt_en) || "";
  };

  if (carousel) {
    return (
      <PostListCarousel
        autoplay={carouselAutoplayEnabled(c)}
        intervalMs={carouselAutoplayIntervalMs(c)}
      >
        {rows.map((p, i) => (
          <PostCard
            key={p.id}
            p={p}
            variant={variant}
            aspect={aspect}
            carousel
            title={title(p)}
            excerpt={excerpt(p)}
            titleStyle={tStyle}
            excerptStyle={eStyle}
            priority={aboveFold && i === 0}
            authorNode={<AuthorMeta p={p} />}
            authorOverlayNode={<AuthorMeta p={p} tone="onDark" />}
          />
        ))}
      </PostListCarousel>
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
                hoverEffect="zoom"
              />
            )}
            <div className="min-w-0">
              {title(p) && (
                <h4 className="cms-post-title line-clamp-2" style={tStyle}>
                  {title(p)}
                </h4>
              )}
              {excerpt(p) && (
                <p className="cms-post-excerpt line-clamp-2" style={eStyle}>
                  {excerpt(p)}
                </p>
              )}
              <AuthorMeta p={p} />
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
        style={
          {
            "--pl-num-light": idxColor,
            "--pl-num-dark": idxColorDark,
            "--pl-num-opacity": idxOpacity,
          } as React.CSSProperties
        }
      >
        {rows.map((p, i) => (
          <AppLink key={p.id} href={`/post/${p.slug}`} className="block py-4 sm:py-5 group">
            {/* Title-anchored wrapper - the number is positioned relative to this
                box so its top edge aligns exactly with the title's top edge and
                never overflows the row. */}
            <div className="post-list-numbered-shell relative isolate overflow-visible min-w-0 w-full text-left">
              <span
                aria-hidden
                className="post-list-numbered-index font-display tabular-nums select-none leading-none"
                style={
                  {
                    ["--pl-num-fs" as string]: `${idxSize}px`,
                    fontWeight: idxWeight as React.CSSProperties["fontWeight"],
                    position: "absolute",
                    left: idxSide === "left" ? 0 : "auto",
                    right: idxSide === "right" ? 0 : "auto",
                    ...vPos,
                    textAlign: idxSide,
                    pointerEvents: "none",
                    zIndex: 0,
                  } as React.CSSProperties
                }
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div
                className={`relative z-10 ${idxSide === "left" ? "pl-10 sm:pl-12 lg:pl-0" : "pr-10 sm:pr-12 lg:pr-0"}`}
              >
                {title(p) && (
                  <h4 className="cms-post-title line-clamp-3" style={tStyle}>
                    {title(p)}
                  </h4>
                )}
                {<AuthorMeta p={p} />}
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
    const showExcerpt = getBool(c, "showExcerpt", true);
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
        style={
          {
            "--pl-num-light": lightColor,
            "--pl-num-dark": darkColor,
            "--pl-num-opacity": idxOpacity,
          } as React.CSSProperties
        }
      >
        {rows.map((p, i) => (
          <AppLink
            key={p.id}
            href={`/post/${p.slug}`}
            className={`post-list-numbered-row grid items-start gap-3 sm:gap-4 py-4 sm:py-5 group ${
              p.cover_image_url
                ? "grid-cols-[minmax(0,1fr)_minmax(90px,32%)] sm:grid-cols-[minmax(0,1fr)_minmax(120px,28%)]"
                : "grid-cols-1"
            }`}
          >
            <div className="post-list-numbered-shell relative min-w-0 text-left isolate overflow-visible">
              <span
                aria-hidden
                className="post-list-numbered-index font-display tabular-nums"
                style={
                  {
                    ["--pl-num-fs" as string]: `${idxSize}px`,
                    fontWeight: idxWeight as React.CSSProperties["fontWeight"],
                    left: idxSide === "left" ? "0" : "auto",
                    right: idxSide === "right" ? "0" : "auto",
                    ...vPos,
                    textAlign: idxSide,
                  } as React.CSSProperties
                }
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <div
                className={`relative z-10 ${idxSide === "left" ? "pl-10 sm:pl-12 lg:pl-1" : "pr-10 sm:pr-12 lg:pr-1"}`}
              >
                {title(p) && (
                  <h4 className="cms-post-title line-clamp-3" style={tStyle}>
                    <TitleSpan title={title(p)} />
                  </h4>
                )}
                {showExcerpt && excerpt(p) && (
                  <p className="cms-post-excerpt mt-1.5 line-clamp-2" style={eStyle}>
                    {excerpt(p)}
                  </p>
                )}
                {/* Byline: wariant numbered oferuje ustawienie "Autor" w
                    edytorze, wiec MUSI je tez rysowac. Wczesniej pole bylo
                    widoczne, zapisywalo sie i nie robilo nic. */}
                <AuthorMeta p={p} />
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
                hoverEffect="zoom"
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
        {rows.map((p, i) => (
          <AppLink key={p.id} href={`/post/${p.slug}`} className="block group">
            {p.cover_image_url && (
              <WidgetMediaImage
                src={p.cover_image_url}
                alt=""
                frameClassName={`${tileFrame(aspect)} rounded-md mb-4`}
                sizes={POST_LIST_CLASSIC_COVER_SIZES}
                priority={aboveFold && i === 0}
                foregroundClassName={COVER_IMG_CLASS}
                hoverEffect="zoom"
              />
            )}
            {title(p) && (
              <h3 className="cms-post-title line-clamp-3" style={tStyle}>
                <TitleSpan title={title(p)} />
              </h3>
            )}
            {excerpt(p) && (
              <p className="cms-post-excerpt mt-2 line-clamp-3" style={eStyle}>
                {excerpt(p)}
              </p>
            )}
            <AuthorMeta p={p} />
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
                sizes={POST_LIST_FLEX_LEAD_SIZES}
                priority={aboveFold}
                foregroundClassName={`${COVER_IMG_CLASS} transition-transform duration-500 group-hover:scale-[1.03]`}
              />
            </div>
          )}
          {title(lead) && (
            <h3
              className="cms-post-title text-[1.35em] line-clamp-3 transition-colors group-hover:text-brand"
              style={tStyle}
            >
              <TitleSpan title={title(lead)} />
            </h3>
          )}
          {excerpt(lead) && (
            <p className="cms-post-excerpt mt-2 line-clamp-3" style={eStyle}>
              {excerpt(lead)}
            </p>
          )}
          <AuthorMeta p={lead} />
        </AppLink>
        <ol className="flex flex-col">
          {rest.map((p, i) => (
            <li key={p.id} className="border-b border-border/60 last:border-0">
              <AppLink
                href={`/post/${p.slug}`}
                className={`grid ${p.cover_image_url ? "grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[104px_minmax(0,1fr)]" : "grid-cols-[28px_minmax(0,1fr)]"} items-start gap-2.5 sm:gap-3 py-3 sm:py-3.5 first:pt-0 group`}
              >
                {p.cover_image_url ? (
                  <WidgetMediaImage
                    src={p.cover_image_url}
                    alt=""
                    frameClassName={`relative block aspect-[4/3] w-full shrink-0 overflow-hidden rounded-sm bg-muted`}
                    sizes="104px"
                    foregroundClassName={COVER_IMG_CLASS}
                    hoverEffect="zoom"
                  />
                ) : (
                  <span className="font-serif text-lg tabular-nums text-brand/80 leading-none pt-0.5">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                )}
                {title(p) && (
                  <h4
                    className="cms-post-title line-clamp-3 transition-colors group-hover:text-brand"
                    style={tStyle}
                  >
                    <TitleSpan title={title(p)} />
                  </h4>
                )}
              </AppLink>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  if (variant === "boxed-list") {
    return (
      <div
        data-widget-grid
        className={`w-full grid gap-3 sm:gap-4 ${mobileHScroll ? "cms-mobile-hscroll" : ""}`}
        style={{ gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))` }}
      >
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
              {title(p) && (
                <h4
                  className="cms-post-title line-clamp-2 transition-colors group-hover:text-brand"
                  style={tStyle}
                >
                  <TitleSpan title={title(p)} />
                </h4>
              )}
              {excerpt(p) && (
                <p className="cms-post-excerpt mt-1.5 line-clamp-2" style={eStyle}>
                  {excerpt(p)}
                </p>
              )}
              <AuthorMeta p={p} />
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
      {rows.map((p, i) => (
        <PostCard
          key={p.id}
          p={p}
          variant={variant}
          aspect={aspect}
          title={title(p)}
          excerpt={excerpt(p)}
          titleStyle={tStyle}
          excerptStyle={eStyle}
          priority={aboveFold && i === 0}
          authorNode={<AuthorMeta p={p} />}
          authorOverlayNode={<AuthorMeta p={p} tone="onDark" />}
        />
      ))}
    </div>
  );
}

/**
 * Sciezka karuzeli: scroll-snap + OPCJONALNE autoodtwarzanie.
 *
 * Autoplay jest wylaczony domyslnie i nie rusza, gdy czytelnik prosi o
 * ograniczenie ruchu (`prefers-reduced-motion`). Zatrzymuje sie na hover, na
 * fokusie klawiatury wewnatrz toru oraz na zadanie uzytkownika (przycisk
 * pauzy) - WCAG 2.2.2 wymaga mozliwosci zatrzymania ruchomej tresci trwajacej
 * dluzej niz 5 s. Gdy autoplay jest wylaczony, renderujemy dokladnie ten sam
 * tor co wczesniej, bez dodatkowych kontrolek.
 */
function PostListCarousel({
  autoplay,
  intervalMs,
  children,
}: {
  autoplay: boolean;
  intervalMs: number;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [userPaused, setUserPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const slides = Array.isArray(children) ? children.length : children ? 1 : 0;
  const controllable = autoplay && slides > 1;
  const running = controllable && !reducedMotion && !userPaused && !interacting;

  // Przewijamy do KRAWEDZI kolejnego slajdu (a nie o stala liczbe pikseli),
  // dzieki czemu snap nie zostawia karty przycietej w polowie. Na koncu toru
  // zawijamy na poczatek, zeby autoplay nie zatrzymywal sie po cichu.
  const step = useCallback(
    (direction: 1 | -1) => {
      const el = trackRef.current;
      if (!el) return;
      const items = Array.from(el.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      );
      if (!items.length) return;
      const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const current = el.scrollLeft;
      const target =
        direction === 1
          ? (items.find((item) => item.offsetLeft > current + 1)?.offsetLeft ?? 0)
          : ([...items].reverse().find((item) => item.offsetLeft < current - 1)?.offsetLeft ??
            maxLeft);
      const left = Math.min(Math.max(0, target), maxLeft);
      if (typeof el.scrollTo === "function") {
        el.scrollTo({ left, behavior: reducedMotion ? "auto" : "smooth" });
      } else {
        el.scrollLeft = left;
      }
    },
    [reducedMotion],
  );

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => step(1), intervalMs);
    return () => window.clearInterval(id);
  }, [running, intervalMs, step]);

  const track = (
    <div
      ref={trackRef}
      className="w-full min-w-0 flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory"
      {...(controllable
        ? {
            role: "group",
            "aria-roledescription": t("postCarousel.roleDescription"),
            "aria-label": t("postCarousel.label"),
            tabIndex: 0,
            "data-autoplay": running ? "running" : "paused",
          }
        : {})}
    >
      {children}
    </div>
  );

  if (!controllable) return track;

  const btn =
    "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground transition-colors hover:border-brand/60 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const pauseLabel = t("postCarousel.pause");
  const playLabel = t("postCarousel.play");

  return (
    <div
      className="w-full min-w-0"
      onMouseEnter={() => setInteracting(true)}
      onMouseLeave={() => setInteracting(false)}
      onFocus={() => setInteracting(true)}
      onBlur={() => setInteracting(false)}
    >
      {track}
      <div
        className="mt-2 flex items-center justify-end gap-1.5"
        role="group"
        aria-label={t("postCarousel.controls")}
      >
        <button
          type="button"
          className={btn}
          onClick={() => step(-1)}
          aria-label={t("postCarousel.prev")}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className={btn}
          aria-pressed={userPaused}
          aria-label={userPaused ? playLabel : pauseLabel}
          onClick={() => setUserPaused((v) => !v)}
        >
          {userPaused ? (
            <Play className="h-4 w-4" aria-hidden />
          ) : (
            <Pause className="h-4 w-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className={btn}
          onClick={() => step(1)}
          aria-label={t("postCarousel.next")}
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PostCard({
  p,
  variant,
  aspect,
  carousel = false,
  title,
  excerpt,
  titleStyle,
  excerptStyle,
  priority = false,
  authorNode,
  authorOverlayNode,
}: {
  p: PostRow;
  variant: Variant;
  aspect: ImageAspect;
  carousel?: boolean;
  title: string;
  excerpt: string;
  titleStyle?: React.CSSProperties;
  excerptStyle?: React.CSSProperties;
  /** Karta wiodąca widgetu nad zgięciem - okładka jako kandydat LCP. */
  priority?: boolean;
  authorNode?: React.ReactNode;
  authorOverlayNode?: React.ReactNode;
}) {
  const isBoxed = variant === "boxed-grid";
  const base = `${isBoxed ? "bg-card" : "bg-transparent"} border border-border rounded-md overflow-hidden transition ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`;

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
          priority={priority}
          foregroundClassName={`${COVER_IMG_CLASS} transition-transform duration-700 group-hover:scale-[1.06]`}
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/5 sm:from-black/90 sm:via-black/45" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="absolute inset-x-0 bottom-0 p-3 sm:p-4 text-white">
          {title && (
            <h4
              className="cms-post-title line-clamp-2 sm:line-clamp-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]"
              style={titleStyle}
            >
              <TitleSpan title={title} />
            </h4>
          )}
          {authorOverlayNode}
        </div>
      </AppLink>
    );
  }

  if (variant === "minimal") {
    return (
      <AppLink
        href={`/post/${p.slug}`}
        className={`block group ${carousel ? "w-full basis-full shrink-0 snap-start" : ""}`}
      >
        {p.cover_image_url && (
          <WidgetMediaImage
            src={p.cover_image_url}
            alt=""
            frameClassName={`${tileFrame(aspect)} rounded-sm mb-3`}
            sizes={GRID_COVER_SIZES}
            priority={priority}
            foregroundClassName={COVER_IMG_CLASS}
            hoverEffect="zoom"
          />
        )}
        {title && (
          <h4 className="cms-post-title line-clamp-2" style={titleStyle}>
            <TitleSpan title={title} />
          </h4>
        )}
        {excerpt && (
          <p className="cms-post-excerpt line-clamp-2 mt-1.5" style={excerptStyle}>
            {excerpt}
          </p>
        )}
        {authorNode}
      </AppLink>
    );
  }

  // default - card
  return (
    <AppLink href={`/post/${p.slug}`} className={base}>
      {p.cover_image_url && (
        <WidgetMediaImage
          src={p.cover_image_url}
          alt=""
          frameClassName={tileFrame(aspect)}
          sizes={GRID_COVER_SIZES}
          priority={priority}
          foregroundClassName={COVER_IMG_CLASS}
          hoverEffect="zoom"
        />
      )}
      <div className="p-3">
          {title && (
            <h4 className="cms-post-title mb-1.5 line-clamp-2" style={titleStyle}>
              <TitleSpan title={title} />
            </h4>
          )}
        {excerpt && (
          <p className="cms-post-excerpt line-clamp-2" style={excerptStyle}>
            {excerpt}
          </p>
        )}
        {authorNode}
      </div>
    </AppLink>
  );
}
