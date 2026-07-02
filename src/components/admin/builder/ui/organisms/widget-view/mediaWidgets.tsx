// Image + posts-slider widgets and the site-logo hook, extracted from SimpleWidgets.
import { type CSSProperties, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode, WidgetTypography } from "@/lib/builder/types";
import { safeImageUrl } from "@/lib/sanitize";
import { getStr, getNum, type Lang } from "./frame";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { SliderRender, type SliderVariant } from "@/lib/builder/sliderVariants";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import { ResizableImageWrap } from "./resizeWrappers";

type SiteLogoVariant = "main" | "mobile" | "transparent";
type SiteLogoCfg = { logo?: { main?: string; main_dark?: string; mobile?: string; mobile_dark?: string; transparent?: string; transparent_dark?: string } };
type WidgetMediaFrameStyle = CSSProperties & { "--widget-media-fit"?: CSSProperties["objectFit"] };
export function useSiteLogo(variant: SiteLogoVariant = "main"): { light: string; dark: string } {
  const { data } = useQuery(siteSettingsQueryOptions);
  const cfg = resolveSetting<SiteLogoCfg>(data, "theme_options", {});
  const l = cfg.logo ?? {};
  const lightKey = variant;
  const darkKey = `${variant}_dark` as const;
  const logoMap = l as Record<string, string | undefined>;
  const main = safeImageUrl(logoMap.main ?? "");
  const mainDark = safeImageUrl(logoMap.main_dark ?? "");
  return {
    light: safeImageUrl(logoMap[lightKey] ?? "") || main,
    dark: safeImageUrl(logoMap[darkKey] ?? "") || mainDark || main,
  };
}

export function ImageWidget({ c, lang, theme, editable, onContentChange }: {
  c: WidgetNode["content"];
  lang: Lang;
  theme: string | undefined;
  editable: boolean;
  onContentChange?: (key: string, value: string | number) => void;
}) {
  const rawSrc = safeImageUrl(getStr(c, "src"));
  const rawSrcDark = safeImageUrl(getStr(c, "srcDark"));
  const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
  const caption = getStr(c, `caption_${lang}`) || getStr(c, "caption_pl");
  const variant = getStr(c, "variant") || "default";
  const fit = (getStr(c, "objectFit") || "cover") as CSSProperties["objectFit"];
  const ratio = getStr(c, "ratio");
  const widthPx = typeof c.widthPx === "number" ? c.widthPx : Number(c.widthPx) || 0;
  const maxWidthPx = typeof c.maxWidthPx === "number" ? c.maxWidthPx : Number(c.maxWidthPx) || 0;
  const align = (getStr(c, "align") || "center") as "left" | "center" | "right";

  // Fallback: use site logo from theme_options when no src is configured AND
  // either explicit useSiteLogo flag is set, or alt text indicates a logo
  // (matches default chrome seeds where alt = "Logo").
  const siteLogoVariant = (getStr(c, "useSiteLogo") || "") as "" | SiteLogoVariant;
  const altIsLogo = /logo/i.test(alt);
  const wantsSiteLogo = siteLogoVariant !== "" || altIsLogo;
  const siteLogo = useSiteLogo(siteLogoVariant || "main");
  const src = wantsSiteLogo ? siteLogo.light || rawSrc : rawSrc;
  const srcDark = wantsSiteLogo ? siteLogo.dark || rawSrcDark || siteLogo.light || rawSrc : rawSrcDark;

  const variantCls =
    variant === "rounded" ? "rounded-xl"
    : variant === "circle" ? "rounded-full aspect-square"
    : variant === "polaroid" ? "bg-white p-2 pb-6 shadow-lg rotate-[-1deg]"
    : variant === "shadow" ? "rounded shadow-2xl"
    : variant === "frame" ? "rounded border-4 border-foreground/10"
    : variant === "zoom-hover" ? "rounded overflow-hidden transition-transform duration-500 hover:scale-105"
    : "rounded";
  const caps: number[] = [];
  if (widthPx > 0) caps.push(widthPx);
  if (maxWidthPx > 0) caps.push(maxWidthPx);
  const effectiveMaxPx = caps.length ? Math.min(...caps) : 0;
  const ratioCss = ratio && ratio !== "auto" ? ratio.replace("/", " / ") : undefined;
  const wrapperStyle: WidgetMediaFrameStyle = {
    width: effectiveMaxPx > 0 ? `min(100%, ${effectiveMaxPx}px)` : "100%",
    maxWidth: "100%",
    ...(ratioCss ? { aspectRatio: ratioCss } : null),
    ...(ratioCss ? { "--widget-media-fit": fit } : null),
  };
  const imgStyle: CSSProperties = ratioCss
    ? { objectFit: fit, width: "100%", height: "100%" }
    : {
      objectFit: fit,
      width: "100%",
      maxWidth: "100%",
      height: "auto",
    };
  if (!src && !srcDark) {
    return <div className="bg-muted rounded h-32 flex items-center justify-center text-xs text-muted-foreground">brak obrazka</div>;
  }
  const lightSrc = src || srcDark;
  const darkSrc = srcDark || src;
  const hasBoth = !!src && !!srcDark && src !== srcDark;
  const figureAlign = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  const showResize = editable && !!onContentChange;
  const isFramed = !!ratioCss;
  const imgCls = isFramed ? `absolute inset-0 block h-full w-full ${variantCls}` : `block max-w-full h-auto ${variantCls}`;
  const applyLogoFallback = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!wantsSiteLogo) return;
    const img = event.currentTarget;
    const fallback = img.classList.contains("gc-img-dark") ? srcDark || src : src || srcDark;
    if (fallback && img.src !== fallback) img.src = fallback;
  };
  const fgImgStyle: CSSProperties = ratioCss ? { ...imgStyle, objectFit: fit } : imgStyle;
  const imgEl = hasBoth ? (
    <>
      <OptimizedImage src={lightSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-light`} style={fgImgStyle} onError={applyLogoFallback} />
      <OptimizedImage src={darkSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-dark`} style={fgImgStyle} onError={applyLogoFallback} />
    </>
  ) : (
    isFramed ? (
      <OptimizedImage src={theme === "dark" ? darkSrc : lightSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={`${imgCls} widget-media-fg`} style={fgImgStyle} onError={applyLogoFallback} />
    ) : (
      <OptimizedImage src={theme === "dark" ? darkSrc : lightSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={imgCls} style={imgStyle} onError={applyLogoFallback} />
    )
  );
  const framedImgEl = isFramed ? (
    <span data-widget-media className="relative block w-full overflow-hidden rounded bg-muted" style={wrapperStyle}>
      {imgEl}
    </span>
  ) : imgEl;
  // Optional link wrapper - the editor exposes a "Link (opcjonalnie)" field
  // (`href`). When set, wrap the image in an <a> so logos and banners actually
  // navigate. External URLs open in a new tab; same-origin paths stay in-app.
  const href = (getStr(c, "href") || "").trim();
  const isExternal = /^https?:\/\//i.test(href);
  const linkedImg = href
    ? (
      <AppLink
        href={href}
        {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : null)}
        className="block"
        aria-label={alt || undefined}
      >
        {framedImgEl}
      </AppLink>
    )
    : framedImgEl;
  return (
    <figure className={`space-y-2 flex flex-col ${figureAlign}`}>
      <ResizableImageWrap
        enabled={showResize}
        currentPx={widthPx > 0 ? widthPx : undefined}
        onCommit={(px) => onContentChange?.("widthPx", Math.round(px))}
      >
        {linkedImg}
      </ResizableImageWrap>
      {caption && <figcaption className="text-xs text-muted-foreground text-center">{caption}</figcaption>}
    </figure>
  );
}

export function PostsSliderWidget({ c, lang, typography }: { c: WidgetNode["content"]; lang: Lang; typography?: WidgetTypography }) {
  const variant = (getStr(c, "variant") || "hero-overlay") as SliderVariant;
  const ratio = (getStr(c, "ratio") || "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
  const autoplay = c.autoplay !== false;
  const intervalMs = getNum(c, "intervalMs", 4500);
  const rounded = (getStr(c, "rounded") || "md") as "none" | "sm" | "md" | "lg" | "xl" | "full";
  const overlayOpacity = typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45;
  const showExcerpt = c.showExcerpt !== false;
  const ctaLabel = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl") || "";

  // Shared with the SSR prefetch registry (lib/builder/prefetch), so the
  // streaming gate warms this exact cache entry and the slider ships as
  // complete server HTML instead of an empty state that pops in later.
  const { data: items = [], isPending } = useQuery(sliderPostsQueryOptions(c, lang));

  const columnsRaw = getNum(c, "columns", 3);
  const columns = (Math.max(1, Math.min(4, columnsRaw)) as 1 | 2 | 3 | 4);

  // While the initial fetch is in flight, hold layout with a quiet shimmer
  // instead of flashing the "Dodaj obrazki do slidera" empty state - that
  // message is only true once the query has settled with no posts.
  if (isPending) {
    return (
      <div
        aria-busy="true"
        className="w-full skeleton-shimmer"
        style={{
          aspectRatio: ratio.replace("/", " / "),
          borderRadius: { none: "0px", sm: "4px", md: "8px", lg: "16px", xl: "24px", full: "9999px" }[rounded],
        }}
      />
    );
  }

  const cfg = {
    variant, ratio, autoplay, intervalMs, rounded, overlayOpacity, columns,
    titleSizePx: typeof c.titleSizePx === "number" ? c.titleSizePx : undefined,
    titleWeight: typeof c.titleWeight === "number" ? c.titleWeight : undefined,
    subtitleSizePx: typeof c.subtitleSizePx === "number" ? c.subtitleSizePx : undefined,
    subtitleWeight: typeof c.subtitleWeight === "number" ? c.subtitleWeight : undefined,
    navSizePx: typeof c.navSizePx === "number" ? c.navSizePx : undefined,
    navRoundedPx: typeof c.navRoundedPx === "number" ? c.navRoundedPx : undefined,
    navBgColor: typeof c.navBgColor === "string" ? c.navBgColor : undefined,
    navArrowColor: typeof c.navArrowColor === "string" ? c.navArrowColor : undefined,
    navBgStyle: (typeof c.navBgStyle === "string" ? c.navBgStyle : undefined) as
      | "glass" | "solid" | "outline" | "soft" | "gradient" | "shadow" | undefined,
    navPosition: (typeof c.navPosition === "string" ? c.navPosition : undefined) as
      | "mid" | "mid-outside" | "bottom" | "top" | undefined,
    navArrowVariant: (typeof c.navArrowVariant === "string" ? c.navArrowVariant : undefined) as
      | "chevron" | "chevron-bold" | "arrow" | "arrow-long" | "caret" | "angle" | "double-chevron" | "arrow-tail" | undefined,
    navArrowStroke: typeof c.navArrowStroke === "number" ? c.navArrowStroke : undefined,
    typography,
    items: items
      .filter((p) => p.cover_image_url)
      .map((p) => ({
        image: p.cover_image_url ?? "",
        title_pl: p.title_pl ?? "",
        title_en: p.title_en ?? p.title_pl ?? "",
        subtitle_pl: showExcerpt ? (p.excerpt_pl ?? "") : "",
        subtitle_en: showExcerpt ? (p.excerpt_en ?? p.excerpt_pl ?? "") : "",
        href: `/post/${p.slug}`,
        cta_pl: ctaLabel,
        cta_en: ctaLabel,
      })),
  };
  return <SliderRender config={cfg} lang={lang} />;
}
