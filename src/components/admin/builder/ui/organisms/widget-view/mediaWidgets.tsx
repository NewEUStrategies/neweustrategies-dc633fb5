// Image + posts-slider widgets and the site-logo hook, extracted from SimpleWidgets.
import { type CSSProperties, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode, WidgetTypography } from "@/lib/builder/types";
import { safeImageUrl } from "@/lib/sanitize";
import { getStr, type Lang } from "./frame";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
// UWAGA: importujemy z `sliderOptions` (czyste dane), NIE z `sliderVariants` -
// renderer slidera ma zostać w leniwym chunku (lazyWidgets), a nie wpaść tu
// przez import stałych.
import {
  NAV_ARROW_VARIANT_VALUES,
  NAV_BG_STYLES,
  NAV_POSITIONS,
  SLIDER_RATIOS,
  SLIDER_ROUNDED_VALUES,
  SLIDER_VARIANT_VALUES,
} from "@/lib/builder/sliderOptions";
import { asBool, asNum, asNumInRange, asOneOf, asStr } from "@/lib/content-model/contentValue";
import { resolveAuthorDisplay } from "@/lib/builder/authorDisplay";
import { SliderRender } from "./lazyWidgets";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { sliderAuthorIds, sliderAuthorsQueryOptions } from "@/lib/builder/sliderAuthorsQuery";
import { useAboveFold } from "@/lib/builder/aboveFold";
import { WIDGET_MEDIA_SPLIT_SIZES } from "@/lib/builder/widgetImageSizes";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
import { ResizableImageWrap } from "./resizeWrappers";

type SiteLogoVariant = "main" | "mobile" | "transparent";
type SiteLogoCfg = {
  logo?: {
    main?: string;
    main_dark?: string;
    mobile?: string;
    mobile_dark?: string;
    transparent?: string;
    transparent_dark?: string;
  };
};
type WidgetMediaFrameStyle = CSSProperties & { "--widget-media-fit"?: CSSProperties["objectFit"] };
/** Styl obrazka + zmienna z ustawioną wysokością (czyta ją zwijanie headera). */
type WidgetImageStyle = CSSProperties & { "--img-h"?: string };

/** Czy redakcja w ogóle ustawiła to pole. Puste/`null` traktujemy jak brak,
 *  żeby "nie ustawiono" (globalny default) nie zlało się z "ustawiono na 0". */
function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}
function useSiteLogo(variant: SiteLogoVariant = "main"): { light: string; dark: string } {
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

export function ImageWidget({
  c,
  lang,
  theme,
  editable,
  onContentChange,
}: {
  c: WidgetNode["content"];
  lang: Lang;
  theme: string | undefined;
  editable: boolean;
  onContentChange?: (key: string, value: string | number) => void;
}) {
  const rawSrc = safeImageUrl(getStr(c, "src"));
  const rawSrcDark = safeImageUrl(getStr(c, "srcDark"));
  // Kandydat LCP: obraz w sekcji nad zgięciem ładuje się eager z wysokim
  // priorytetem. Wyłącznie wariant jednoźródłowy - przy parze light/dark oba
  // obrazy są w DOM (jeden schowany CSS-em), więc eager podwajałby transfer.
  const aboveFold = useAboveFold();
  const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
  const caption = getStr(c, `caption_${lang}`) || getStr(c, "caption_pl");
  const variant = getStr(c, "variant") || "default";
  const fit = (getStr(c, "objectFit") || "cover") as CSSProperties["objectFit"];
  const ratio = getStr(c, "ratio");
  const widthPx = typeof c.widthPx === "number" ? c.widthPx : Number(c.widthPx) || 0;
  const maxWidthPx = typeof c.maxWidthPx === "number" ? c.maxWidthPx : Number(c.maxWidthPx) || 0;
  const heightPx = typeof c.heightPx === "number" ? c.heightPx : Number(c.heightPx) || 0;
  const align = (getStr(c, "align") || "center") as "left" | "center" | "right";

  // Fallback: use site logo from theme_options when no src is configured AND
  // either explicit useSiteLogo flag is set, or alt text indicates a logo
  // (matches default chrome seeds where alt = "Logo").
  const siteLogoVariant = (getStr(c, "useSiteLogo") || "") as "" | SiteLogoVariant;
  const altIsLogo = /logo/i.test(alt);
  const wantsSiteLogo = siteLogoVariant !== "" || altIsLogo;
  const siteLogo = useSiteLogo(siteLogoVariant || "main");
  const src = wantsSiteLogo ? siteLogo.light || rawSrc : rawSrc;
  const srcDark = wantsSiteLogo
    ? siteLogo.dark || rawSrcDark || siteLogo.light || rawSrc
    : rawSrcDark;
  // Also treat any image whose src matches the configured site logo as a logo
  // (e.g. header widgets pointing at the same asset without setting useSiteLogo).
  const srcMatchesSiteLogo =
    (!!siteLogo.light && (rawSrc === siteLogo.light || rawSrcDark === siteLogo.light)) ||
    (!!siteLogo.dark && (rawSrc === siteLogo.dark || rawSrcDark === siteLogo.dark));
  const isLogo = wantsSiteLogo || srcMatchesSiteLogo;

  const variantCls = isLogo
    ? "rounded"
    : variant === "rounded"
      ? "rounded-xl"
      : variant === "circle"
        ? "rounded-full aspect-square"
        : variant === "polaroid"
          ? "bg-white p-2 pb-6 shadow-lg rotate-[-1deg]"
          : variant === "shadow"
            ? "rounded shadow-2xl"
            : variant === "frame"
              ? "rounded border-4 border-foreground/10"
              : variant === "zoom-hover"
                ? "rounded overflow-hidden transition-transform duration-500 hover:scale-105"
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
  // Bez ramki (ratio=auto) obrazek rysuje się bezpośrednio - wcześniej dostawał
  // twarde `width: 100%`, więc "Szerokość (px)"/"Maks. szerokość (px)" nie miały
  // ŻADNEGO wpływu (logo w headerze rozlewało się na całą kolumnę). Teraz oba
  // limity oraz nowa "Wysokość (px)" trafiają na element realnie.
  const imgStyle: WidgetImageStyle = ratioCss
    ? { objectFit: fit, width: "100%", height: "100%" }
    : {
        objectFit: fit,
        width: heightPx > 0 && widthPx <= 0 ? "auto" : widthPx > 0 ? `${widthPx}px` : "100%",
        maxWidth: effectiveMaxPx > 0 ? `min(100%, ${effectiveMaxPx}px)` : "100%",
        height: heightPx > 0 ? `${heightPx}px` : "auto",
        ...(heightPx > 0 ? { "--img-h": `${heightPx}px` } : null),
      };
  if (!src && !srcDark) {
    return (
      <div className="cms-meta bg-muted rounded h-32 flex items-center justify-center">
        brak obrazka
      </div>
    );
  }
  const lightSrc = src || srcDark;
  const darkSrc = srcDark || src;
  const hasBoth = !!src && !!srcDark && src !== srcDark;
  const figureAlign =
    align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
  const showResize = editable && !!onContentChange;
  const isFramed = !!ratioCss;
  const imgCls = isFramed
    ? `absolute inset-0 block h-full w-full ${variantCls}`
    : `block ${variantCls}${isLogo ? " site-logo-img" : ""}`;
  const hoverEffect: import("@/components/atoms/OptimizedImage").HoverEffect =
    isLogo || variant === "zoom-hover" ? "none" : "zoom";
  const applyLogoFallback = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!wantsSiteLogo) return;
    const img = event.currentTarget;
    const fallback = img.classList.contains("gc-img-dark") ? srcDark || src : src || srcDark;
    if (fallback && img.src !== fallback) img.src = fallback;
  };
  const fgImgStyle: WidgetImageStyle = ratioCss ? { ...imgStyle, objectFit: fit } : imgStyle;
  const imgEl = hasBoth ? (
    <>
      <OptimizedImage
        src={lightSrc}
        alt={alt}
        responsive
        sizes={WIDGET_MEDIA_SPLIT_SIZES}
        className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-light`}
        style={fgImgStyle}
        onError={applyLogoFallback}
        hoverEffect={hoverEffect}
        fadeIn={!isLogo}
      />
      <OptimizedImage
        src={darkSrc}
        alt={alt}
        responsive
        sizes={WIDGET_MEDIA_SPLIT_SIZES}
        className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-dark`}
        style={fgImgStyle}
        onError={applyLogoFallback}
        hoverEffect={hoverEffect}
        fadeIn={!isLogo}
      />
    </>
  ) : isFramed ? (
    <OptimizedImage
      src={theme === "dark" ? darkSrc : lightSrc}
      alt={alt}
      responsive
      sizes={WIDGET_MEDIA_SPLIT_SIZES}
      priority={aboveFold}
      className={`${imgCls} widget-media-fg`}
      style={fgImgStyle}
      onError={applyLogoFallback}
      hoverEffect={hoverEffect}
      fadeIn={!isLogo}
    />
  ) : (
    <OptimizedImage
      src={theme === "dark" ? darkSrc : lightSrc}
      alt={alt}
      responsive
      sizes={WIDGET_MEDIA_SPLIT_SIZES}
      priority={aboveFold}
      className={imgCls}
      style={imgStyle}
      onError={applyLogoFallback}
      hoverEffect={hoverEffect}
      fadeIn={!isLogo}
    />
  );
  const framedImgEl = isFramed ? (
    <span
      data-widget-media
      className="relative block w-full overflow-hidden rounded bg-muted"
      style={wrapperStyle}
    >
      {imgEl}
    </span>
  ) : (
    imgEl
  );
  // Optional link wrapper - the editor exposes a "Link (opcjonalnie)" field
  // (`href`). When set, wrap the image in an <a> so logos and banners actually
  // navigate. External URLs open in a new tab; same-origin paths stay in-app.
  const href = (getStr(c, "href") || "").trim();
  const isExternal = /^https?:\/\//i.test(href);
  const linkedImg = href ? (
    <AppLink
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : null)}
      className="block"
      aria-label={alt || undefined}
    >
      {framedImgEl}
    </AppLink>
  ) : (
    framedImgEl
  );
  return (
    <figure className={`space-y-2 flex flex-col ${figureAlign}`}>
      <ResizableImageWrap
        enabled={showResize}
        currentPx={widthPx > 0 ? widthPx : undefined}
        onCommit={(px) => onContentChange?.("widthPx", Math.round(px))}
      >
        {linkedImg}
      </ResizableImageWrap>
      {caption && <figcaption className="cms-meta text-center">{caption}</figcaption>}
    </figure>
  );
}

export function PostsSliderWidget({
  c,
  lang,
  typography,
}: {
  c: WidgetNode["content"];
  lang: Lang;
  typography?: WidgetTypography;
}) {
  const variant = asOneOf(c.variant, SLIDER_VARIANT_VALUES, "editorial-hero");
  const ratio = asOneOf(c.ratio, SLIDER_RATIOS, "16/9");
  // Jawna wartość z inspektora wygrywa; brak = globalny default karuzeli
  // (Motyw -> Karuzele), rozstrzygany w SliderRender. `isSet` odróżnia "nie
  // ustawiono" od "ustawiono na fałsz/zero" - inaczej wyłączony autoplay
  // wracałby do globalnego domyślnego włączenia.
  const autoplay = isSet(c.autoplay) ? asBool(c.autoplay, true) : undefined;
  const intervalMs = isSet(c.intervalMs) ? asNum(c.intervalMs, 4500) : undefined;
  const rounded = asOneOf(c.rounded, SLIDER_ROUNDED_VALUES, "md");
  const overlayOpacity = asNumInRange(c.overlayOpacity, 0.45, 0, 1);
  // Sekcja "Wyświetlanie" panelu: te ustawienia muszą dojechać do SliderRender,
  // inaczej przełączniki w edytorze są martwe (renderer domyślnie pokazuje wszystko).
  const showExcerpt = asBool(c.showExcerpt, true);
  const showCover = asBool(c.showCover, true);
  const showTitle = asBool(c.showTitle, true);
  // Prezentacja autora rozstrzygana wspólnym rezolwerem (`authorDisplay`),
  // ten sam kontrakt co w post-liście, liście z oceną i metadanych wpisu.
  const author = resolveAuthorDisplay(c, lang);
  const showAuthor = author.visible;
  const ctaLabel = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl") || "";

  // Shared with the SSR prefetch registry (lib/builder/prefetch), so the
  // streaming gate warms this exact cache entry and the slider ships as
  // complete server HTML instead of an empty state that pops in later.
  const { data: items = [], isPending } = useQuery(sliderPostsQueryOptions(c, lang));

  // Batch-fetch author profiles for the resolved slider posts so name+avatar
  // propagate live to the byline without one query per slide. Opcje zapytania
  // (klucz + queryFn + izolacja najemcy przez `profiles_public`) mieszkają we
  // współdzielonym `sliderAuthorsQuery`, tym samym, który rozgrzewa prefetch
  // SSR - hero wychodzi z serwera Z byline zamiast doklejać ją po hydratacji.
  const authorIds = sliderAuthorIds(items);
  const { data: authorMap = {} } = useQuery({
    ...sliderAuthorsQueryOptions(authorIds),
    enabled: authorIds.length > 0,
  });

  const columns = Math.round(asNumInRange(c.columns, 3, 1, 4)) as 1 | 2 | 3 | 4;

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
          borderRadius: {
            none: "0px",
            sm: "4px",
            md: "8px",
            lg: "16px",
            xl: "24px",
            full: "9999px",
          }[rounded],
        }}
      />
    );
  }

  const cfg = {
    variant,
    ratio,
    autoplay,
    intervalMs,
    rounded,
    overlayOpacity,
    columns,
    titleSizePx: isSet(c.titleSizePx) ? asNum(c.titleSizePx, 0) : undefined,
    titleWeight: isSet(c.titleWeight) ? asNum(c.titleWeight, 0) : undefined,
    subtitleSizePx: isSet(c.subtitleSizePx) ? asNum(c.subtitleSizePx, 0) : undefined,
    subtitleWeight: isSet(c.subtitleWeight) ? asNum(c.subtitleWeight, 0) : undefined,
    navSizePx: isSet(c.navSizePx) ? asNumInRange(c.navSizePx, 52, 28, 96) : undefined,
    navRoundedPx: isSet(c.navRoundedPx) ? asNum(c.navRoundedPx, 999) : undefined,
    navBgColor: asStr(c.navBgColor) || undefined,
    navArrowColor: asStr(c.navArrowColor) || undefined,
    navBgStyle: asOneOf(c.navBgStyle, NAV_BG_STYLES, "glass"),
    navPosition: asOneOf(c.navPosition, NAV_POSITIONS, "mid"),
    navArrowVariant: asOneOf(c.navArrowVariant, NAV_ARROW_VARIANT_VALUES, "chevron"),
    navArrowStroke: isSet(c.navArrowStroke)
      ? asNumInRange(c.navArrowStroke, 2.25, 0.5, 4)
      : undefined,
    typography,
    showExcerpt,
    showAuthor,
    showTitle,
    showCover,
    // Obie osie widoczności i oba rozmiary jadą do renderera JUŻ rozstrzygnięte
    // - `SliderRender` nie może dojść do innego wyniku niż kanwa i panel.
    showAuthorName: author.showName,
    showAuthorAvatar: author.showAvatar,
    authorLabel_pl: asStr(c.authorLabel_pl),
    authorLabel_en: asStr(c.authorLabel_en),
    authorSizePx: author.nameSizePx,
    authorAvatarSizePx: author.avatarSizePx,
    // Nie odfiltrowujemy slajdów po braku cover_image_url - inaczej wyłączenie
    // "Pokaż cover" (lub post bez okładki) trwale usuwałoby slajd z karuzeli
    // i nie dałoby się go przywrócić bez ponownego dodania okładki do wpisu.
    items: items.map((p) => {
      const author = p.author_id ? authorMap[p.author_id] : undefined;
      return {
        image: p.cover_image_url ?? "",
        title_pl: p.title_pl ?? "",
        title_en: p.title_en ?? p.title_pl ?? "",
        subtitle_pl: showExcerpt ? (p.excerpt_pl ?? "") : "",
        subtitle_en: showExcerpt ? (p.excerpt_en ?? p.excerpt_pl ?? "") : "",
        href: `/post/${p.slug}`,
        cta_pl: ctaLabel,
        cta_en: ctaLabel,
        author: author?.name ?? "",
        authorAvatar: author?.avatar ?? "",
        authorSlug: author?.slug ?? "",
      };
    }),
  };
  return <SliderRender config={cfg} lang={lang} />;
}
