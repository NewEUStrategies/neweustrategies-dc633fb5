// Image widget and the site-logo hook, extracted from SimpleWidgets.
// PostsSliderWidget wyjechał do ./PostsSliderWidget.tsx (leniwy chunk przez
// rejestr lazyWidgets) - ImageWidget zostaje eager, bo renderuje logo w chrome
// i obrazy-kandydatów LCP nad zgięciem.
import { useContext, type CSSProperties, type ReactElement, type SyntheticEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetNode } from "@/lib/builder/types";
import { safeImageUrl } from "@/lib/sanitizePure";
import { getStr, type Lang } from "./frame";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import { lcpCandidateAttr, type LcpImage } from "@/lib/builder/aboveFold";
import { altMarksLogo } from "@/lib/builder/logoAlt";
import { imageDimensionPx, imageWidgetSizes } from "@/lib/builder/widgetImageSizes";
import { useBuilderImageSlot } from "@/lib/builder/imageSlotContext";
import { HeaderChromeContext } from "@/lib/builder/headerChromeContext";
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

/** Zachowawczy limit szerokości logo, gdy panel nie ustawił żadnego rozmiaru. */
const LOGO_FALLBACK_MAX_PX = 200;

/** Poprawny GIF 1x1 - źródło `<picture>` logo poniżej `lg`: zero żądań sieciowych. */
const BLANK_GIF = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Logo nagłówka chrome eager tylko od `lg` (P3.2a, LP-6). Nagłówek desktopowy ma
 * poniżej `lg` (1024 px) `display: none`, ale obraz eager i tak by się pobrał -
 * `<source>` z pustym GIF-em `data:` zabiera telefonowi to żądanie. W zakresie
 * `<picture>` React nie emituje też automatycznego preloadu, więc `<head>` i
 * licznik preloadów obrazów zostają bez zmian. `contents` (klasa już w arkuszu
 * publicznym) nie tworzy pudełka: układ i selektory logo są te same.
 */
const desktopOnlyPicture = (img: ReactElement) => (
  <picture className="contents">
    <source media="(max-width: 1023px)" srcSet={BLANK_GIF} />
    {img}
  </picture>
);

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
  lcp = false,
}: {
  c: WidgetNode["content"];
  lang: Lang;
  theme: string | undefined;
  editable: boolean;
  onContentChange?: (key: string, value: string | number) => void;
  /**
   * Kandydat LCP strony (P1.4, `lcpCandidates`): wyłącznie wtedy (`true`) obraz
   * ładuje się eager z wysokim priorytetem i niesie `data-lcp-candidate`;
   * `"eager"` (pierwsza sekcja renderu czysto klienckiego) daje sam priorytet,
   * bez znacznika. Każdy inny obraz - także logo w nagłówku i stopce - jest
   * leniwy. Para light/dark nie dostaje priorytetu nigdy (oba obrazy są w DOM,
   * eager podwajałby transfer).
   */
  lcp?: LcpImage;
}) {
  const rawSrc = safeImageUrl(getStr(c, "src"));
  const rawSrcDark = safeImageUrl(getStr(c, "srcDark"));
  const sizes = imageWidgetSizes(c, useBuilderImageSlot());
  const inHeaderChrome = useContext(HeaderChromeContext);
  const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
  const caption = getStr(c, `caption_${lang}`) || getStr(c, "caption_pl");
  const variant = getStr(c, "variant") || "default";
  const fit = (getStr(c, "objectFit") || "cover") as CSSProperties["objectFit"];
  const ratio = getStr(c, "ratio");
  // Rozmiary bywają zapisane dwiema drogami: liczbowo (uchwyt zmiany rozmiaru
  // na kanwie: `widthPx`/`maxWidthPx`/`heightPx`) albo jako długość CSS w
  // treści (`width`/`maxWidth`/`height`, tak siały domyślne chrome: logo
  // stopki "180px"). Druga droga była wcześniej IGNOROWANA, więc logo dostawało
  // `width: 100%` i rozlewało się na całą kolumnę stopki - wbrew ustawieniu.
  const pxLen = imageDimensionPx;
  const widthPx = pxLen(c.widthPx) || pxLen(c.width);
  const maxWidthPx = pxLen(c.maxWidthPx) || pxLen(c.maxWidth);
  const heightPx = pxLen(c.heightPx) || pxLen(c.height);
  const align = (getStr(c, "align") || "center") as "left" | "center" | "right";

  // Fallback: use site logo from theme_options when no src is configured AND
  // either explicit useSiteLogo flag is set, or alt text indicates a logo
  // (matches default chrome seeds where alt = "Logo"). Całe słowo, nie fragment:
  // „Zegar analogowy” to zwykłe zdjęcie (altMarksLogo, ten sam predykat co kandydat LCP).
  const siteLogoVariant = (getStr(c, "useSiteLogo") || "") as "" | SiteLogoVariant;
  const altIsLogo = altMarksLogo(alt);
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
  // Logo w desktopowym nagłówku chrome: eager bez wysokiego priorytetu (P3.2a).
  // Deterministyczne (nie zależy od motywu) - brak rozjazdu hydratacji.
  const eagerLogo = inHeaderChrome && isLogo;
  const logoFrame = (img: ReactElement) => (eagerLogo ? desktopOnlyPicture(img) : img);

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
  // Logo bez ŻADNEGO limitu rozmiaru nie ma rozlewać się na całą kolumnę
  // (stopka: kolumna 6/12 to ponad 500 px). Domyślny limit jest zachowawczy i
  // ustępuje każdej wartości ustawionej w panelu.
  if (caps.length === 0 && isLogo && heightPx <= 0) caps.push(LOGO_FALLBACK_MAX_PX);
  const effectiveMaxPx = caps.length ? Math.min(...caps) : 0;
  const ratioCss = ratio && ratio !== "auto" ? ratio.replace("/", " / ") : undefined;
  // Logo bez jawnego dopasowania rysujemy w całości (`contain`) - domyślne
  // `cover` przycinało znak firmowy do ramki.
  const mediaFit: CSSProperties["objectFit"] = isLogo && !getStr(c, "objectFit") ? "contain" : fit;
  const wrapperStyle: WidgetMediaFrameStyle = {
    width: effectiveMaxPx > 0 ? `min(100%, ${effectiveMaxPx}px)` : "100%",
    maxWidth: "100%",
    ...(ratioCss ? { aspectRatio: ratioCss } : null),
    ...(ratioCss ? { "--widget-media-fit": mediaFit } : null),
  };
  // Bez ramki (ratio=auto) obrazek rysuje się bezpośrednio - wcześniej dostawał
  // twarde `width: 100%`, więc "Szerokość (px)"/"Maks. szerokość (px)" nie miały
  // ŻADNEGO wpływu (logo w headerze rozlewało się na całą kolumnę). Teraz oba
  // limity oraz nowa "Wysokość (px)" trafiają na element realnie.
  const imgStyle: WidgetImageStyle = ratioCss
    ? { objectFit: mediaFit, width: "100%", height: "100%" }
    : {
        objectFit: mediaFit,
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
    : `block ${variantCls}${isLogo ? " site-logo-img" : ""}${heightPx > 0 ? " h-[var(--img-h)]" : ""}`;
  const hoverEffect: import("@/components/atoms/OptimizedImage").HoverEffect =
    isLogo || variant === "zoom-hover" ? "none" : "zoom";
  const applyLogoFallback = (event: SyntheticEvent<HTMLImageElement>) => {
    if (!wantsSiteLogo) return;
    const img = event.currentTarget;
    const fallback = img.classList.contains("gc-img-dark") ? srcDark || src : src || srcDark;
    if (fallback && img.src !== fallback) img.src = fallback;
  };
  const fgImgStyle: WidgetImageStyle = ratioCss ? { ...imgStyle, objectFit: fit } : imgStyle;
  // Para light/dark: eager dostaje WYŁĄCZNIE wariant jasny (decyzja orkiestratora,
  // PLAN-FALI-3 §3a) - ciemny jest w jasnym motywie schowany CSS-em, a eager
  // pobierałby go zawsze. Ciemny zostaje leniwy i poza `<picture>`.
  const imgEl = hasBoth ? (
    <>
      {logoFrame(
        <OptimizedImage
          src={lightSrc}
          alt={alt}
          responsive
          sizes={sizes}
          autoSizes={isFramed}
          eager={eagerLogo}
          className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-light`}
          style={fgImgStyle}
          onError={applyLogoFallback}
          hoverEffect={hoverEffect}
          fadeIn={!isLogo}
        />,
      )}
      <OptimizedImage
        src={darkSrc}
        alt={alt}
        responsive
        sizes={sizes}
        autoSizes={isFramed}
        className={`${imgCls} ${isFramed ? "widget-media-fg" : ""} gc-img-dark`}
        style={fgImgStyle}
        onError={applyLogoFallback}
        hoverEffect={hoverEffect}
        fadeIn={!isLogo}
      />
    </>
  ) : (
    logoFrame(
      <OptimizedImage
        src={theme === "dark" ? darkSrc : lightSrc}
        alt={alt}
        responsive
        sizes={sizes}
        autoSizes={isFramed}
        priority={lcp !== false}
        eager={eagerLogo}
        data-lcp-candidate={lcpCandidateAttr(lcp)}
        className={isFramed ? `${imgCls} widget-media-fg` : imgCls}
        style={isFramed ? fgImgStyle : imgStyle}
        onError={applyLogoFallback}
        hoverEffect={hoverEffect}
        fadeIn={!isLogo}
      />,
    )
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
    <figure className={`w-full space-y-2 flex flex-col ${figureAlign}`}>
      <ResizableImageWrap
        enabled={showResize}
        currentPx={widthPx > 0 ? widthPx : undefined}
        onCommit={(px) => onContentChange?.("widthPx", Math.round(px))}
      >
        {/* Give the hover/link wrapper a definite width. Lazy images using
            sizes="auto" have size containment: a centred flex child must not
            shrink to their intrinsic 300px fallback instead of the column. */}
        <div
          style={{
            width: heightPx > 0 && widthPx <= 0 && !ratioCss ? "auto" : wrapperStyle.width,
            maxWidth: "100%",
          }}
        >
          {linkedImg}
        </div>
      </ResizableImageWrap>
      {caption && <figcaption className="cms-meta text-center">{caption}</figcaption>}
    </figure>
  );
}
