// Read-only widget renderers (no inline editing). Returns null when the
// widget type isn't handled here - caller falls through to the main switch.
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { WidgetNode } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import { sanitizeHtml, safeUrl, safeImageUrl } from "@/lib/sanitize";
import {
  SectionLabelRender, resolveAccentColor, type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";
import { SliderRender, type SliderVariant } from "@/lib/builder/sliderVariants";
import {
  AnimatedHeadingRender, type AnimatedHeadingConfig,
  type AnimatedHeadingMode, type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";
import { COMPACT_ICON_BOX_SIZE, COMPACT_WIDGET_MIN_HEIGHT, getStr, getNum, getStrArr } from "./frame";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/components/ThemeProvider";
import { useQuery } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";
import {
  LoginFormView, RegisterFormView, LostPasswordFormView, ResetPasswordFormView,
} from "@/components/blocks/AuthFormBlocks";
import { DynamicTagWidget } from "./DynamicTagWidgets";
import { ContactFormView } from "@/components/blocks/ContactFormView";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";

type AuthCfg = Record<string, unknown>;
function AuthFormWidget({ node, lang }: { node: WidgetNode; lang: Lang }) {
  const data = (node.content ?? {}) as AuthCfg;
  switch (node.type) {
    case "login-form": return <LoginFormView data={data} lang={lang} />;
    case "register-form": return <RegisterFormView data={data} lang={lang} />;
    case "lost-password-form": return <LostPasswordFormView data={data} lang={lang} />;
    case "reset-password-form": return <ResetPasswordFormView data={data} lang={lang} />;
    default: return null;
  }
}


type SiteLogoVariant = "main" | "mobile" | "transparent";
type SiteLogoCfg = { logo?: { main?: string; main_dark?: string; mobile?: string; mobile_dark?: string; transparent?: string; transparent_dark?: string } };
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

type Lang = "pl" | "en";

function ImageWidget({ c, lang, theme, editable, onContentChange }: {
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
  const wrapperStyle: CSSProperties = {
    width: effectiveMaxPx > 0 ? `min(100%, ${effectiveMaxPx}px)` : "100%",
    maxWidth: "100%",
    ...(ratioCss ? { aspectRatio: ratioCss } : null),
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
  const imgEl = hasBoth ? (
    <>
      <OptimizedImage src={lightSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={`${imgCls} gc-img-light`} style={imgStyle} onError={applyLogoFallback} />
      <OptimizedImage src={darkSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={`${imgCls} gc-img-dark`} style={imgStyle} onError={applyLogoFallback} />
    </>
  ) : (
    <OptimizedImage src={theme === "dark" ? darkSrc : lightSrc} alt={alt} responsive sizes="(max-width: 767px) 100vw, 50vw" className={imgCls} style={imgStyle} onError={applyLogoFallback} />
  );
  const framedImgEl = isFramed ? (
    <span data-widget-media className="relative block w-full overflow-hidden rounded bg-muted" style={wrapperStyle}>
      {imgEl}
    </span>
  ) : imgEl;
  return (
    <figure className={`space-y-2 flex flex-col ${figureAlign}`}>
      <ResizableImageWrap
        enabled={showResize}
        currentPx={widthPx > 0 ? widthPx : undefined}
        onCommit={(px) => onContentChange?.("widthPx", Math.round(px))}
      >
        {framedImgEl}
      </ResizableImageWrap>
      {caption && <figcaption className="text-xs text-muted-foreground text-center">{caption}</figcaption>}
    </figure>
  );
}

function PostsSliderWidget({ c, lang }: { c: WidgetNode["content"]; lang: Lang }) {
  const limit = Math.max(1, Math.min(20, getNum(c, "limit", 5)));
  const categoryId = getStr(c, "categoryId") || "";
  const categorySlugsRaw = getStr(c, "categorySlugs") || "";
  const tagSlugsRaw = getStr(c, "tagSlugs") || "";
  const excludeRaw = getStr(c, "excludeIds") || "";
  const orderBy = getStr(c, "orderBy") || "newest";
  const variant = (getStr(c, "variant") || "hero-overlay") as SliderVariant;
  const ratio = (getStr(c, "ratio") || "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2";
  const autoplay = c.autoplay !== false;
  const intervalMs = getNum(c, "intervalMs", 4500);
  const rounded = (getStr(c, "rounded") || "md") as "none" | "sm" | "md" | "lg" | "xl" | "full";
  const overlayOpacity = typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45;
  const showExcerpt = c.showExcerpt !== false;
  const ctaLabel = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl") || "";

  const categorySlugs = categorySlugsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const tagSlugs = tagSlugsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  const excludeIds = excludeRaw.split(",").map((s) => s.trim()).filter(Boolean);

  const { data: items = [] } = useQuery({
    queryKey: ["builder-slider-posts", { limit, categoryId, categorySlugs, tagSlugs, excludeIds, orderBy }],
    queryFn: async () => {
      let allowedIds: string[] | null = null;
      if (categoryId) {
        const { data } = await supabase.from("post_categories").select("post_id").eq("category_id", categoryId);
        allowedIds = (data ?? []).map((r) => r.post_id);
      }
      if (categorySlugs.length) {
        const { data } = await supabase.from("post_categories").select("post_id, categories!inner(slug)").in("categories.slug", categorySlugs);
        const ids = (data ?? []).map((r: { post_id: string }) => r.post_id);
        allowedIds = allowedIds ? allowedIds.filter((id) => ids.includes(id)) : ids;
      }
      if (tagSlugs.length) {
        const { data: tagRows } = await supabase.from("tags").select("id").in("slug", tagSlugs);
        const tagIds = (tagRows ?? []).map((r) => r.id);
        if (tagIds.length) {
          const { data: ptRows } = await supabase.from("post_tags").select("post_id").in("tag_id", tagIds);
          const ids = (ptRows ?? []).map((r) => r.post_id);
          allowedIds = allowedIds ? allowedIds.filter((id) => ids.includes(id)) : ids;
        } else {
          allowedIds = [];
        }
      }
      if (allowedIds && allowedIds.length === 0) return [];
      let q = supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
        .eq("status", "published");
      if (allowedIds) q = q.in("id", allowedIds);
      if (excludeIds.length) q = q.not("id", "in", `(${excludeIds.join(",")})`);
      const ascending = orderBy === "oldest";
      const orderCol = orderBy === "title" ? (lang === "en" ? "title_en" : "title_pl") : "published_at";
      q = q.order(orderCol, { ascending });
      q = q.limit(limit);
      const { data } = await q;
      return data ?? [];
    },
  });

  const cfg = {
    variant, ratio, autoplay, intervalMs, rounded, overlayOpacity,
    titleSizePx: typeof c.titleSizePx === "number" ? c.titleSizePx : undefined,
    titleWeight: typeof c.titleWeight === "number" ? c.titleWeight : undefined,
    subtitleSizePx: typeof c.subtitleSizePx === "number" ? c.subtitleSizePx : undefined,
    subtitleWeight: typeof c.subtitleWeight === "number" ? c.subtitleWeight : undefined,
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

type SearchResult = { id: string; slug: string; title: string; excerpt: string | null };

function SearchButtonWidget({ label, heading, liveResults, limit, lang }: {
  label: string;
  mode: "standalone" | "dropdown" | "fullscreen";
  heading: string;
  liveResults: boolean;
  limit: number;
  lang: Lang;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setFocused(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setFocused(false); inputRef.current?.blur(); }
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const runSearch = async (term: string) => {
    const t = term.trim();
    if (t.length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    const titleCol = lang === "pl" ? "title_pl" : "title_en";
    const excerptCol = lang === "pl" ? "excerpt_pl" : "excerpt_en";
    const { data } = await supabase
      .from("posts")
      .select(`id, slug, ${titleCol}, ${excerptCol}`)
      .eq("status", "published")
      .is("deleted_at", null)
      .ilike(titleCol, `%${t}%`)
      .limit(Math.max(1, Math.min(limit, 20)));
    setResults((data ?? []).map((r: any) => ({
      id: r.id, slug: r.slug, title: r[titleCol] || "", excerpt: r[excerptCol] || null,
    })));
    setLoading(false);
    setSearched(true);
  };

  useEffect(() => {
    if (!liveResults) return;
    const h = setTimeout(() => runSearch(q), 220);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, liveResults]);

  const placeholder = label || heading || (lang === "pl" ? "Szukaj" : "Search");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = hasQuery && !loading && searched && results.length === 0;
  const showPopover = focused && hasQuery;

  return (
    <div ref={wrapRef} className="builder-search-widget relative w-full max-w-full min-w-0">
      <div
        className="flex min-h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 text-foreground shadow-sm transition-colors"
        style={{ direction: "ltr" }}
      >
        <LucideIcons.Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(q); setFocused(true); } }}
          placeholder={placeholder}
          aria-label={label || placeholder}
          dir="ltr"
          style={{
            textAlign: "left",
            direction: "ltr",
            unicodeBidi: "plaintext",
            boxShadow: "none",
            background: "transparent",
            border: 0,
            outline: "none",
            borderRadius: 0,
            padding: 0,
            margin: 0,
            appearance: "none",
            WebkitAppearance: "none",
            MozAppearance: "none",
          }}
          className="h-10 flex-1 min-w-0 bg-transparent border-0 px-0 py-0 text-sm text-foreground outline-none ring-0 shadow-none [appearance:none] [-webkit-appearance:none] focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 placeholder:text-muted-foreground/70"
        />
        {loading && <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />}
        {q && (
          <button
            type="button"
            aria-label={lang === "pl" ? "Wyczyść" : "Clear"}
            onClick={() => { setQ(""); setResults([]); setSearched(false); inputRef.current?.focus(); }}
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:outline-none focus:ring-0"
          >
            <LucideIcons.X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showPopover && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-md border border-input bg-card text-card-foreground shadow-lg"
          role="dialog"
          aria-label={lang === "pl" ? "Wyniki wyszukiwania" : "Search results"}
        >
          <div className="max-h-[380px] overflow-y-auto py-1">
            {loading && (
              <div className="flex items-center gap-2 px-4 py-5 text-xs text-muted-foreground">
                <LucideIcons.Loader2 className="w-3.5 h-3.5 animate-spin" />
                {lang === "pl" ? "Szukam…" : "Searching…"}
              </div>
            )}

            {!loading && showEmpty && (
              <div className="px-4 py-5 text-xs text-muted-foreground">
                {lang === "pl" ? "Brak wyników dla " : "No results for "}
                <span className="font-medium text-foreground">„{q.trim()}"</span>
              </div>
            )}

            {!loading && results.length > 0 && (
              <ul className="divide-y divide-border/70">
                {results.map((r) => (
                  <li key={r.id}>
                    <a
                      href={`/posts/${r.slug}`}
                      onClick={() => setFocused(false)}
                      className="block px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <div className="text-sm font-medium text-foreground truncate">{r.title}</div>
                      {r.excerpt && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.excerpt}</div>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .builder-search-widget input::-webkit-search-decoration,
            .builder-search-widget input::-webkit-search-cancel-button,
            .builder-search-widget input::-webkit-search-results-button,
            .builder-search-widget input::-webkit-search-results-decoration {
              display: none;
              -webkit-appearance: none;
            }
            .builder-search-widget input::-ms-clear,
            .builder-search-widget input::-ms-reveal {
              display: none;
              width: 0;
              height: 0;
            }
          `,
        }}
      />
    </div>
  );
}




const compactRowStyle: CSSProperties = {
  minHeight: COMPACT_WIDGET_MIN_HEIGHT,
  boxSizing: "border-box",
  maxWidth: "100%",
};

const compactIconBoxStyle = (size = COMPACT_ICON_BOX_SIZE): CSSProperties => ({
  width: size,
  height: size,
  minWidth: size,
  minHeight: size,
  lineHeight: 0,
  boxSizing: "border-box",
});

export function renderSimpleWidget(
  node: WidgetNode,
  lang: Lang,
  theme: string | undefined,
  editable: boolean = false,
  onContentChange?: (key: string, value: string | number) => void,
): ReactNode | undefined {
  const c = node.content;

  switch (node.type) {
    case "divider": {
      const variant = getStr(c, "variant") || "line";
      const thickness = getNum(c, "thickness", 1);
      if (variant === "gradient") {
        return <div style={{ height: `${thickness}px` }} className="bg-gradient-to-r from-transparent via-border to-transparent" />;
      }
      if (variant === "icon") {
        const iconName = getStr(c, "iconName") || "Star";
        const reg = LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
        const Icon = reg[iconName] ?? LucideIcons.Star;
        return (
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="flex-1 border-t border-border" style={{ borderTopWidth: thickness }} />
            <Icon size={16} />
            <div className="flex-1 border-t border-border" style={{ borderTopWidth: thickness }} />
          </div>
        );
      }
      if (variant === "wave") {
        return (
          <svg viewBox="0 0 200 8" preserveAspectRatio="none" className="w-full h-3 text-border">
            <path d="M0 4 Q 25 0 50 4 T 100 4 T 150 4 T 200 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        );
      }
      const styleType = variant === "dashed" ? "dashed" : variant === "dotted" ? "dotted" : variant === "double" ? "double" : "solid";
      return <hr className="border-border" style={{ borderTopStyle: styleType, borderTopWidth: thickness }} />;
    }
    case "spacer": {
      const h = getNum(c, "height", 32);
      if (editable) {
        return (
          <div
            className="w-full flex items-center justify-center text-[10px] uppercase tracking-wider text-muted-foreground/70 border border-dashed border-border/70 rounded-sm bg-muted/30"
            style={{ height: `${h}px`, minHeight: `${h}px` }}
            aria-label="Spacer"
          >
            <span>↕ {h}px</span>
          </div>
        );
      }
      return <div style={{ height: `${h}px`, width: "100%" }} />;
    }
    case "social-icons": {
      const size = getNum(c, "size", 14);
      const gap = getNum(c, "gap", 4);
      const box = size + 6;
      const showEmpty = getStr(c, "showEmpty") === "show";
      const colorMode = getStr(c, "colorMode") || "inherit";
      const customColor = getStr(c, "customColor");
      const bgMode = getStr(c, "bgMode") || "none";
      const customBgColor = getStr(c, "customBgColor");
      const shape = getStr(c, "shape") || "md";
      const themeAdapt = getStr(c, "themeAdapt") || "auto";

      const OFFICIAL: Record<string, string> = {
        facebook: "#1877F2",
        x: "#000000",
        youtube: "#FF0000",
        instagram: "#E4405F",
        linkedin: "#0A66C2",
        email: "#6B7280",
      };

      const mkIcon = (path: string) => ({ size: s = 14 }: { size?: number }) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d={path} />
        </svg>
      );
      const XIcon = mkIcon("M18.244 2H21.5l-7.5 8.57L23 22h-6.84l-5.36-6.86L4.6 22H1.34l8.02-9.16L1 2h7.02l4.84 6.27L18.244 2Zm-1.2 18h1.86L7.06 4H5.1l11.944 16Z");
      const FacebookIcon = mkIcon("M12 2C6.48 2 2 6.48 2 12c0 4.84 3.44 8.87 8 9.8V15H8v-3h2V9.5C10 7.57 11.57 6 13.5 6H16v3h-2c-.55 0-1 .45-1 1v2h3v3h-3v6.95c5.05-.5 9-4.76 9-9.95 0-5.52-4.48-10-10-10z");
      const YoutubeIcon = mkIcon("M21.6 7.2c-.2-1-1-1.8-2-2C17.8 5 12 5 12 5s-5.8 0-7.6.2c-1 .2-1.8 1-2 2C2.2 9 2.2 12 2.2 12s0 3 .2 4.8c.2 1 1 1.8 2 2 1.8.2 7.6.2 7.6.2s5.8 0 7.6-.2c1-.2 1.8-1 2-2 .2-1.8.2-4.8.2-4.8s0-3-.2-4.8zM10 15.5v-7l6 3.5-6 3.5z");
      const InstagramIcon = ({ size: s = 14 }: { size?: number }) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" ry="5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="3.6" fill="none" stroke="var(--ig-bg, #fff)" strokeWidth="1.8" />
          <circle cx="17.3" cy="6.7" r="1.1" fill="var(--ig-bg, #fff)" stroke="none" />
        </svg>
      );
      const LinkedinIcon = mkIcon("M4.98 3.5a2.5 2.5 0 11-.02 5.02A2.5 2.5 0 014.98 3.5zM3 9h4v12H3V9zm7.5 0h3.8v1.7h.1c.5-.9 1.8-1.9 3.7-1.9 4 0 4.7 2.6 4.7 6V21h-4v-5.4c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9V21h-4V9z");
      const MailIcon = mkIcon("M3 5h18a1 1 0 011 1v12a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1zm9 8.2L3.8 7H20.2L12 13.2z");

      type IconCmp = (props: { size?: number }) => ReactElement;
      const items: Array<{ k: string; altKeys?: string[]; Cmp: IconCmp; label: string }> = [
        { k: "facebook",  Cmp: FacebookIcon,  label: "Facebook" },
        { k: "x",         altKeys: ["twitter"], Cmp: XIcon, label: "X" },
        { k: "youtube",   Cmp: YoutubeIcon,   label: "YouTube" },
        { k: "instagram", Cmp: InstagramIcon, label: "Instagram" },
        { k: "linkedin",  Cmp: LinkedinIcon,  label: "LinkedIn" },
      ];
      const email = getStr(c, "email");

      const radiusCls =
        shape === "none" ? "rounded-none"
        : shape === "sm" ? "rounded-sm"
        : shape === "lg" ? "rounded-lg"
        : shape === "full" ? "rounded-full"
        : shape === "square" ? "rounded-none"
        : "rounded-md";

      const themeCls =
        themeAdapt === "force-light" ? "[color-scheme:light]"
        : themeAdapt === "force-dark" ? "[color-scheme:dark]"
        : "";

      const resolveColor = (k: string): string | undefined => {
        if (colorMode === "official") return OFFICIAL[k];
        if (colorMode === "custom") return customColor || undefined;
        if (colorMode === "brand") return "var(--brand, currentColor)";
        if (colorMode === "dark") return themeAdapt === "auto" ? "currentColor" : "#0a0a0a";
        if (colorMode === "light") return themeAdapt === "auto" ? "currentColor" : "#ffffff";
        return undefined;
      };

      const resolveBg = (k: string, active: boolean): string | undefined => {
        if (!active && showEmpty) return undefined;
        if (bgMode === "none") return undefined;
        if (bgMode === "subtle") return "hsl(var(--muted))";
        if (bgMode === "brand") return "var(--brand, currentColor)";
        if (bgMode === "official") return OFFICIAL[k];
        if (bgMode === "contrast") return "hsl(var(--foreground))";
        if (bgMode === "custom") return customBgColor || undefined;
        return undefined;
      };

      const linkStyle = compactIconBoxStyle(box);

      return (
        <div className={`flex flex-wrap items-center text-foreground ${themeCls}`} style={{ ...compactRowStyle, gap: `${gap}px` }}>
          {items.map(({ k, altKeys, Cmp, label }) => {
            const href = getStr(c, k) || (altKeys?.map((ak) => getStr(c, ak)).find(Boolean) ?? "");
            const active = !!href;
            if (!active && !showEmpty) return null;
            const color = active ? resolveColor(k) : undefined;
            const bg = resolveBg(k, active);
            const onContrast = bgMode === "official" && active;
            const style: CSSProperties = {
              ...linkStyle,
              color: onContrast ? "#fff" : color,
              backgroundColor: bg,
              opacity: active ? 1 : 0.35,
            };
            const cls = `inline-flex items-center justify-center ${radiusCls} transition-colors shrink-0 ${active ? "hover:opacity-80" : "cursor-not-allowed"} ${!bg ? "hover:bg-muted/40" : ""}`;
            return active ? (
              <a key={k} href={safeUrl(href)} aria-label={label} className={cls} style={style}><Cmp size={size} /></a>
            ) : (
              <span key={k} aria-label={`${label} (brak linku)`} className={cls} style={style}><Cmp size={size} /></span>
            );
          })}
          {(email || showEmpty) && (() => {
            const active = !!email;
            const color = active ? resolveColor("email") : undefined;
            const bg = resolveBg("email", active);
            const onContrast = bgMode === "official" && active;
            const style: CSSProperties = {
              ...linkStyle,
              color: onContrast ? "#fff" : color,
              backgroundColor: bg,
              opacity: active ? 1 : 0.35,
            };
            const cls = `inline-flex items-center justify-center ${radiusCls} transition-colors shrink-0 ${active ? "hover:opacity-80" : "cursor-not-allowed"} ${!bg ? "hover:bg-muted/40" : ""}`;
            return active ? (
              <a href={`mailto:${email}`} aria-label="Email" className={cls} style={style}><MailIcon size={size} /></a>
            ) : (
              <span aria-label="Email (brak)" className={cls} style={style}><MailIcon size={size} /></span>
            );
          })()}
        </div>
      );
    }

    case "lang-switcher": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Zmień język";
      return (
        <div className="inline-flex items-center text-xs leading-none" style={compactRowStyle}>
          <LangSwitcherDropdown label={label} />
        </div>
      );
    }



    case "theme-toggle":
      return <ThemeToggleWidget />;
    case "account-link": {
      const signin = getStr(c, `signin_${lang}`) || getStr(c, "signin_pl") || "Zaloguj";
      const signup = getStr(c, `signup_${lang}`) || getStr(c, "signup_pl") || "Zarejestruj";
      return (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none max-w-full" style={compactRowStyle}>
          <a href="/login" className="inline-flex h-7 items-center gap-1 whitespace-nowrap text-foreground hover:opacity-80 transition-colors">
            <LucideIcons.LogIn className="w-3 h-3" /> {signin}
          </a>
          <span className="text-muted-foreground/40" aria-hidden>|</span>
          <a href="/login?mode=signup" className="inline-flex h-7 items-center whitespace-nowrap text-brand hover:underline">{signup}</a>
        </span>
      );
    }
    case "search-button": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Szukaj";
      const mode = (getStr(c, "mode") || "dropdown") as "standalone" | "dropdown" | "fullscreen";
      const heading = getStr(c, `heading_${lang}`) || getStr(c, "heading_pl") || "";
      const liveResults = getStr(c, "liveResults") !== "off";
      const limit = getNum(c, "limit", 8);
      return <SearchButtonWidget label={label} mode={mode} heading={heading} liveResults={liveResults} limit={limit} lang={lang} />;
    }

    case "copyright": {
      const txt = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const showYear = c.showYear !== false;
      const brand = getStr(c, "brand");
      return (
        <div className="text-xs text-muted-foreground text-center">
          {showYear && `© ${new Date().getFullYear()} `}{brand}{brand && txt ? ". " : ""}{txt}{txt && "."}
        </div>
      );
    }
    case "icon": {
      const name = getStr(c, "name") || "Star";
      const size = getNum(c, "size", 32);
      const variant = getStr(c, "variant") || "plain";
      const spin = getStr(c, "spin") || "none";
      const reg = LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Cmp = reg[name] ?? LucideIcons.Star;
      const spinCls = spin === "spin" ? "animate-spin" : spin === "pulse" ? "animate-pulse" : spin === "bounce" ? "animate-bounce" : "";
      const wrapperCls =
        variant === "circle" ? "inline-flex items-center justify-center rounded-full bg-brand/10 text-brand p-3"
        : variant === "square" ? "inline-flex items-center justify-center rounded-md bg-brand/10 text-brand p-3"
        : variant === "soft" ? "inline-flex items-center justify-center rounded-lg bg-muted p-3"
        : variant === "outlined" ? "inline-flex items-center justify-center rounded-lg border border-border p-3"
        : "inline-flex";
      return <span className={`${wrapperCls} ${spinCls}`.trim()}><Cmp size={size} /></span>;
    }
    case "map": {
      const q = getStr(c, "query") || "Warszawa";
      const ratio = getStr(c, "ratio") || "16/9";
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      return <div style={{ aspectRatio: ratio.replace("/", " / ") }}><iframe src={src} title="map" className="w-full h-full rounded border-0" /></div>;
    }
    case "video": {
      const url = getStr(c, "url");
      const ratio = getStr(c, "ratio") || "16/9";
      const autoplay = getStr(c, "autoplay") === "on";
      const loop = getStr(c, "loop") === "on";
      const controls = getStr(c, "controls") !== "off";
      const ratioStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / ") };
      if (!url) return <div className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground" style={ratioStyle}>brak wideo</div>;
      const ytMatch = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        const params = new URLSearchParams();
        if (autoplay) { params.set("autoplay", "1"); params.set("mute", "1"); }
        if (loop) { params.set("loop", "1"); params.set("playlist", ytMatch[1]); }
        if (!controls) params.set("controls", "0");
        const q = params.toString();
        return <div style={ratioStyle}><iframe src={`https://www.youtube.com/embed/${ytMatch[1]}${q ? `?${q}` : ""}`} title="video" className="w-full h-full rounded" allowFullScreen /></div>;
      }
      const safe = safeImageUrl(url) || (url.startsWith("https://") ? url : "");
      if (!safe) return <div className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground" style={ratioStyle}>niedozwolony URL</div>;
      return <video src={safe} controls={controls} autoPlay={autoplay} muted={autoplay} loop={loop} playsInline className="w-full rounded" style={ratioStyle} />;
    }
    case "gallery": {
      const imgs = getStrArr(c, "images").map(safeImageUrl).filter(Boolean);
      const cols = getNum(c, "columns", 3);
      const variant = getStr(c, "variant") || "grid";
      const gap = getStr(c, "gap") || "sm";
      const gapCls = gap === "none" ? "gap-0" : gap === "xs" ? "gap-1" : gap === "md" ? "gap-4" : gap === "lg" ? "gap-6" : "gap-2";
      if (imgs.length === 0) return <div className="bg-muted rounded h-24 flex items-center justify-center text-xs text-muted-foreground">brak zdjęć</div>;
      if (variant === "carousel") {
        return (
          <div className={`flex ${gapCls} overflow-x-auto snap-x pb-2`}>
            {imgs.map((src, i) => (
              <span key={i} data-widget-media className="relative block h-48 flex-[0_0_80%] snap-start overflow-hidden rounded bg-muted sm:flex-[0_0_42%] lg:flex-[0_0_30%]">
                <OptimizedImage src={src} alt="" responsive sizes="(max-width: 640px) 80vw, (max-width: 1024px) 42vw, 30vw" className="absolute inset-0 block h-full w-full object-cover" />
              </span>
            ))}
          </div>
        );
      }
      if (variant === "masonry") {
        return (
          <div style={{ columnCount: cols, columnGap: gap === "lg" ? "1.5rem" : gap === "md" ? "1rem" : "0.5rem" }}>
            {imgs.map((src, i) => <OptimizedImage key={i} src={src} alt="" responsive sizes="(max-width: 767px) 100vw, 33vw" className="mb-2 block w-full break-inside-avoid rounded" />)}
          </div>
        );
      }
      if (variant === "polaroid") {
        return (
          <div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {imgs.map((src, i) => (
              <div key={i} className="bg-white p-2 pb-5 shadow-lg rotate-[-1deg] hover:rotate-0 transition">
                <span data-widget-media className="relative block h-32 w-full overflow-hidden bg-muted">
                  <OptimizedImage src={src} alt="" responsive sizes="(max-width: 767px) 100vw, 33vw" className="absolute inset-0 block h-full w-full object-cover" />
                </span>
              </div>
            ))}
          </div>
        );
      }
      return (
        <div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {imgs.map((src, i) => (
            <span key={i} data-widget-media className="relative block h-32 w-full overflow-hidden rounded bg-muted">
              <OptimizedImage src={src} alt="" responsive sizes="(max-width: 767px) 100vw, 33vw" className="absolute inset-0 block h-full w-full object-cover" />
            </span>
          ))}
        </div>
      );
    }
    case "image": {
      return (
        <ImageWidget
          c={c}
          lang={lang}
          theme={theme}
          editable={editable}
          onContentChange={onContentChange}
        />
      );
    }
    case "slider": {
      if (getStr(c, "source") === "posts") {
        return <PostsSliderWidget c={c} lang={lang} />;
      }
      const rawItems = Array.isArray(c.items) ? (c.items as unknown[]).filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
      const hasRealItems = rawItems.length > 0;
      // In the builder canvas, fall back to demo slides so changing the
      // variant on the left is immediately reflected on the right preview
      // even before the user adds any images. On the published site
      // (editable=false) we still show the empty placeholder.
      const sampleItems = (!hasRealItems && editable)
        ? [
            { image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=1200", title_pl: "Przykładowy slajd", title_en: "Sample slide", subtitle_pl: "Podgląd wariantu – dodaj własne slajdy poniżej", subtitle_en: "Variant preview – add your own slides below", href: "#", cta_pl: "Zobacz", cta_en: "View" },
            { image: "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200", title_pl: "Drugi slajd", title_en: "Second slide", subtitle_pl: "Podtytuł", subtitle_en: "Subtitle", href: "#", cta_pl: "Zobacz", cta_en: "View" },
            { image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200", title_pl: "Trzeci slajd", title_en: "Third slide", subtitle_pl: "Podtytuł", subtitle_en: "Subtitle", href: "#", cta_pl: "Zobacz", cta_en: "View" },
          ]
        : rawItems.map((it) => ({
            image: typeof it.image === "string" ? it.image : "",
            title_pl: typeof it.title_pl === "string" ? it.title_pl : "",
            title_en: typeof it.title_en === "string" ? it.title_en : "",
            subtitle_pl: typeof it.subtitle_pl === "string" ? it.subtitle_pl : "",
            subtitle_en: typeof it.subtitle_en === "string" ? it.subtitle_en : "",
            href: typeof it.href === "string" ? it.href : "",
            cta_pl: typeof it.cta_pl === "string" ? it.cta_pl : "",
            cta_en: typeof it.cta_en === "string" ? it.cta_en : "",
          }));
      const cfg = {
        variant: (getStr(c, "variant") || "classic") as SliderVariant,
        ratio: (getStr(c, "ratio") || "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2",
        autoplay: c.autoplay !== false,
        intervalMs: getNum(c, "intervalMs", 4500),
        rounded: (getStr(c, "rounded") || "md") as "none" | "sm" | "md" | "lg" | "xl" | "full",
        overlayOpacity: typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45,
        titleSizePx: typeof c.titleSizePx === "number" ? c.titleSizePx : undefined,
        titleWeight: typeof c.titleWeight === "number" ? c.titleWeight : undefined,
        subtitleSizePx: typeof c.subtitleSizePx === "number" ? c.subtitleSizePx : undefined,
        subtitleWeight: typeof c.subtitleWeight === "number" ? c.subtitleWeight : undefined,
        items: sampleItems,
      };
      if (!hasRealItems && editable) {
        return (
          <div className="relative w-full">
            <SliderRender config={cfg} lang={lang} />
            <div className="pointer-events-none absolute top-2 left-2 z-10 rounded-md bg-background/85 backdrop-blur px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground border border-border">
              Podgląd · dodaj slajdy w panelu
            </div>
          </div>
        );
      }
      return <SliderRender config={cfg} lang={lang} />;
    }
    case "animated-heading": {
      const rotateRaw = c[`rotateWords_${lang}`] ?? c.rotateWords_pl;
      const rotateWords = Array.isArray(rotateRaw)
        ? rotateRaw.filter((x): x is string => typeof x === "string")
        : typeof rotateRaw === "string"
          ? rotateRaw.split("\n").map((s) => s.trim()).filter(Boolean)
          : [];
      const rawColor = getStr(c, "color") || undefined;
      const rawAccent = getStr(c, "accentColor") || undefined;
      // Auto-invert when rendering in dark mode and the user set a single
      // (light-mode) color - so headings stay readable on dark backgrounds.
      const isDark = theme === "dark";
      const ahCfg: AnimatedHeadingConfig = {
        mode: (getStr(c, "mode") || "highlight") as AnimatedHeadingMode,
        shape: (getStr(c, "shape") || "underline") as AnimatedHeadingShape,
        tag: (getStr(c, "tag") || "h2") as AnimatedHeadingConfig["tag"],
        align: (getStr(c, "align") || "left") as "left" | "center" | "right",
        textBefore: getStr(c, `textBefore_${lang}`) || getStr(c, "textBefore_pl"),
        textAfter:  getStr(c, `textAfter_${lang}`)  || getStr(c, "textAfter_pl"),
        highlight:  getStr(c, `highlight_${lang}`)  || getStr(c, "highlight_pl"),
        rotateWords,
        color: isDark && rawColor ? autoInvertColor(rawColor, "dark") : rawColor,
        accentColor: isDark && rawAccent ? autoInvertColor(rawAccent, "dark") : rawAccent,
        durationMs: getNum(c, "durationMs", 1600),
        delayMs: getNum(c, "delayMs", 200),
        loop: c.loop !== false,
      };
      return <AnimatedHeadingRender config={ahCfg} />;
    }
    case "contact": {
      const variant = getStr(c, "variant") || "stacked";
      const wrapCls = variant === "card" ? "space-y-3 bg-card border border-border rounded-xl p-5" : "space-y-3";
      if (variant === "compact") {
        return (
          <form className="flex flex-col sm:flex-row gap-2">
            <input placeholder="Email" className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm" />
            <input placeholder="Wiadomość" className="flex-[2] bg-background border border-border rounded px-3 py-2 text-sm" />
            <button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button>
          </form>
        );
      }
      return (
        <form className={wrapCls}>
          <input placeholder="Imię" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <input placeholder="Email" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <textarea placeholder="Wiadomość" rows={4} className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button>
        </form>
      );
    }
    case "accordion": {
      const items = Array.isArray(c.items) ? c.items as Array<Record<string, string>> : [];
      const variant = getStr(c, "variant") || "bordered";
      const containerCls =
        variant === "separated" ? "space-y-2"
        : variant === "minimal" ? "divide-y divide-border"
        : "divide-y divide-border border border-border rounded-lg overflow-hidden";
      const itemCls = variant === "separated" ? "group border border-border rounded-lg overflow-hidden" : "group";
      return (
        <div className={containerCls}>
          {items.map((it, i) => (
            <details key={i} className={itemCls}>
              <summary className="cursor-pointer list-none px-4 py-3 flex justify-between items-center hover:bg-muted/30 font-medium text-sm">
                <span>{it[`q_${lang}`] || it.q_pl}</span>
                <span className="text-muted-foreground group-open:rotate-180 transition">▾</span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: sanitizeHtml(it[`a_${lang}`] || it.a_pl || "") }} />
            </details>
          ))}
        </div>
      );
    }
    case "testimonial": {
      const quote = getStr(c, `quote_${lang}`) || getStr(c, "quote_pl");
      const author = getStr(c, "author");
      const role = getStr(c, `role_${lang}`) || getStr(c, "role_pl");
      const avatar = safeImageUrl(getStr(c, "avatar"));
      const rating = getNum(c, "rating", 0);
      const variant = getStr(c, "variant") || "card";
      const containerCls =
        variant === "minimal" ? "space-y-3"
        : variant === "quote" ? "relative pl-10 space-y-3"
        : variant === "centered" ? "text-center space-y-4 max-w-xl mx-auto"
        : "bg-muted/30 rounded-lg p-6 space-y-4";
      const stars = rating > 0 && (
        <div className={`flex gap-0.5 text-brand ${variant === "centered" ? "justify-center" : ""}`}>
          {Array.from({ length: 5 }).map((_, i) => (
            <LucideIcons.Star key={i} size={14} fill={i < rating ? "currentColor" : "none"} />
          ))}
        </div>
      );
      return (
        <figure className={containerCls}>
          {variant === "quote" && <LucideIcons.Quote className="absolute left-0 top-0 w-7 h-7 text-brand/40" />}
          {stars}
          <blockquote className={`${variant === "centered" ? "text-lg" : "text-base"} italic leading-relaxed`}>"{quote}"</blockquote>
          <figcaption className={`flex items-center gap-3 ${variant === "centered" ? "justify-center" : ""}`}>
            {avatar && <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover" />}
            <div>
              <div className="font-medium text-sm">{author}</div>
              {role && <div className="text-xs text-muted-foreground">{role}</div>}
            </div>
          </figcaption>
        </figure>
      );
    }
    case "pricing": {
      const plans = Array.isArray(c.plans) ? c.plans as Array<Record<string, unknown>> : [];
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {plans.map((p, i) => {
            const name = (p[`name_${lang}`] || p.name_pl) as string;
            const price = (p.price ?? "") as string;
            const currency = (p.currency ?? "") as string;
            const period = (p[`period_${lang}`] || p.period_pl || "") as string;
            const featuresRaw = (p[`features_${lang}`] || p.features_pl || []) as unknown;
            const features = Array.isArray(featuresRaw) ? featuresRaw.filter((x): x is string => typeof x === "string") : [];
            const cta = (p[`cta_${lang}`] || p.cta_pl || "Wybierz") as string;
            const href = safeUrl(typeof p.href === "string" ? p.href : "#");
            const featured = !!p.featured;
            return (
              <div key={i} className={`rounded-lg border p-6 flex flex-col ${featured ? "border-brand bg-brand/5 shadow-lg" : "border-border bg-card"}`}>
                <h3 className="font-display text-xl mb-2">{name}</h3>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold">{price}</span>
                  <span className="text-sm text-muted-foreground">{currency}{period}</span>
                </div>
                <ul className="space-y-2 mb-6 flex-1 text-sm">
                  {features.map((f, j) => (
                    <li key={j} className="flex items-start gap-2"><span className="text-brand mt-0.5">✓</span>{f}</li>
                  ))}
                </ul>
                <a href={href} className={`text-center px-4 py-2 rounded font-medium text-sm ${featured ? "bg-brand text-brand-foreground" : "border border-border hover:bg-muted"}`}>{cta}</a>
              </div>
            );
          })}
        </div>
      );
    }
    case "section-label": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Sekcja";
      const action = getStr(c, `action_${lang}`) || getStr(c, "action_pl");
      const href = safeUrl(getStr(c, "href"));
      const variant = (getStr(c, "variant") || "left-bar") as SectionLabelVariant;
      const customAccent = getStr(c, "accentColor");
      const color = customAccent || getStr(c, "color") || "brand";
      const accent = resolveAccentColor(theme === "dark" ? autoInvertColor(color, "dark") : color);
      return (
        <SectionLabelRender
          label={label}
          action={action || undefined}
          href={href || undefined}
          accent={accent}
          variant={variant}
          labelColor={getStr(c, "labelColor") || undefined}
          labelSize={getStr(c, "labelSize") || undefined}
          actionColor={getStr(c, "actionColor") || undefined}
          actionSize={getStr(c, "actionSize") || undefined}
        />
      );
    }

    case "hot-topic-bar": {
      const badge = getStr(c, `badge_${lang}`) || getStr(c, "badge_pl") || "Hot topic";
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl");
      const href = safeUrl(getStr(c, "href"));
      const iconName = getStr(c, "iconName") || "Flame";
      const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
      const Icon = Icons[iconName] || Icons.Flame;
      const ArrowRight = Icons.ArrowRight;
      const inner = (
        <div className="flex items-center gap-4 text-sm">
          <span className="inline-flex items-center gap-2 bg-brand text-brand-foreground font-bold px-3 py-1 rounded text-xs uppercase tracking-wider shrink-0">
            {Icon && <Icon className="w-3.5 h-3.5" />} {badge}
          </span>
          <p className="truncate flex-1">{title}</p>
          {ArrowRight && <ArrowRight className="w-4 h-4 text-brand shrink-0" />}
        </div>
      );
      return (
        <div className="border-y border-border bg-muted/40 py-3 px-4">
          {href ? <a href={href} className="block hover:opacity-90 transition">{inner}</a> : inner}
        </div>
      );
    }
    case "login-form":
    case "register-form":
    case "lost-password-form":
    case "reset-password-form":
      return <AuthFormWidget node={node} lang={lang} />;
    case "post-title":
    case "post-meta":
    case "post-tags-dyn":
    case "post-categories-dyn":
    case "post-author-card":
    case "post-breadcrumbs":
    case "post-cover":
    case "post-excerpt":
    case "archive-title":
    case "search-form":
      return <DynamicTagWidget node={node} lang={lang} />;
    case "contact-form":
      return <ContactFormView data={(node.content ?? {}) as Record<string, unknown>} lang={lang} />;
    default:
      return undefined;
  }
}


function LangSwitcherDropdown({ label }: { label: string }) {
  const { i18n } = useTranslation();
  const current: "pl" | "en" = (i18n.language ?? "pl").startsWith("en") ? "en" : "pl";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const options: { code: "pl" | "en"; flag: string; label: string }[] = [
    { code: "pl", flag: "🇵🇱", label: "PL" },
    { code: "en", flag: "🇬🇧", label: "EN" },
  ];
  const cur = options.find((o) => o.code === current)!;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
        className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-md border border-border bg-background hover:bg-muted transition text-xs font-medium"
      >
        <span className="text-base leading-none">{cur.flag}</span>
        <span>{cur.label}</span>
        <LucideIcons.ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute right-0 top-full mt-1 z-50 min-w-[7rem] rounded-md border border-border bg-popover shadow-md py-1"
        >
          {options.map((o) => {
            const active = o.code === current;
            return (
              <li key={o.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    i18n.changeLanguage(o.code);
                    setOpen(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-muted transition ${active ? "font-semibold" : ""}`}
                >
                  <span className="text-base leading-none">{o.flag}</span>
                  <span className="flex-1">{o.label}</span>
                  {active && <LucideIcons.Check className="w-3.5 h-3.5 opacity-70" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ResizableImageWrap({
  enabled,
  currentPx,
  onCommit,
  children,
}: {
  enabled: boolean;
  currentPx: number | undefined;
  onCommit: (px: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [livePx, setLivePx] = useState<number | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number; ratio: number } | null>(null);

  if (!enabled) return <>{children}</>;

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const img = el.querySelector("img") as HTMLImageElement | null;
    const rect = (img ?? el).getBoundingClientRect();
    const ratio = rect.height > 0 ? rect.width / rect.height : 1;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height, ratio };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    // Use larger delta for natural feel; preserve aspect ratio.
    const newW = Math.max(20, d.startW + Math.max(dx, dy * d.ratio));
    setLivePx(newW);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (d && livePx !== undefined) onCommit(livePx);
    dragRef.current = null;
    setLivePx(undefined);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const displayPx = livePx ?? currentPx;
  const wrapStyle: CSSProperties = {
    position: "relative",
    display: "inline-block",
    maxWidth: "100%",
    width: displayPx ? `min(100%, ${displayPx}px)` : "auto",
  };
  return (
    <div ref={ref} style={wrapStyle}>
      {children}
      <div
        role="slider"
        aria-label="Zmień rozmiar obrazka (zachowuje proporcje)"
        title={`Przeciągnij aby zmienić rozmiar${livePx ? ` - ${Math.round(livePx)}px` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 14,
          height: 14,
          borderRadius: 3,
          background: "hsl(var(--brand, 220 90% 56%))",
          border: "2px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
          cursor: "nwse-resize",
          zIndex: 20,
          touchAction: "none",
        }}
      />
      {livePx !== undefined && (
        <div
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            background: "rgba(0,0,0,.7)",
            color: "white",
            fontSize: 10,
            padding: "2px 6px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          {Math.round(livePx)}px
        </div>
      )}
    </div>
  );
}

/**
 * Generic 2-axis resize wrapper for inline widgets (buttons, CTAs).
 * - When `enabled` is false, renders children as-is.
 * - Width / height are independent (corner handle resizes both axes freely).
 * - `display: inline-block` so it doesn't stretch full row width by default.
 */
export function ResizableBox({
  enabled,
  widthPx,
  heightPx,
  minW = 40,
  minH = 24,
  onCommit,
  children,
}: {
  enabled: boolean;
  widthPx?: number;
  heightPx?: number;
  minW?: number;
  minH?: number;
  onCommit: (w: number, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<{ w: number; h: number } | undefined>(undefined);
  const dragRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const baseStyle: CSSProperties = {
    position: "relative",
    display: "inline-flex",
    alignItems: "stretch",
    justifyContent: "stretch",
    width: (live?.w ?? widthPx) ? `${live?.w ?? widthPx}px` : "auto",
    height: (live?.h ?? heightPx) ? `${live?.h ?? heightPx}px` : "auto",
    maxWidth: "100%",
    verticalAlign: "top",
  };

  if (!enabled) {
    // Still apply user-chosen size so production renders respect resize.
    if (widthPx || heightPx) {
      return <div style={baseStyle}>{children}</div>;
    }
    return <>{children}</>;
  }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const w = Math.max(minW, d.startW + (e.clientX - d.startX));
    const h = Math.max(minH, d.startH + (e.clientY - d.startY));
    setLive({ w, h });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const l = live;
    if (dragRef.current && l) onCommit(Math.round(l.w), Math.round(l.h));
    dragRef.current = null;
    setLive(undefined);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div ref={ref} style={baseStyle}>
      <div style={{ width: "100%", height: "100%", display: "flex" }}>{children}</div>
      <div
        role="slider"
        aria-label="Zmień rozmiar"
        title={`Przeciągnij aby zmienić rozmiar${live ? ` - ${Math.round(live.w)}×${Math.round(live.h)}px` : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: -6,
          bottom: -6,
          width: 12,
          height: 12,
          borderRadius: 3,
          background: "hsl(var(--brand, 220 90% 56%))",
          border: "2px solid white",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
          cursor: "nwse-resize",
          zIndex: 20,
          touchAction: "none",
        }}
      />
      {live && (
        <div
          style={{
            position: "absolute",
            top: -18,
            left: 0,
            background: "rgba(0,0,0,.7)",
            color: "white",
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            pointerEvents: "none",
            zIndex: 20,
            whiteSpace: "nowrap",
          }}
        >
          {Math.round(live.w)}×{Math.round(live.h)}px
        </div>
      )}
    </div>
  );
}

function ThemeToggleWidget() {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Przełącz na tryb jasny" : "Przełącz na tryb ciemny"}
      title={isDark ? "Tryb ciemny (kliknij, aby zmienić)" : "Tryb jasny (kliknij, aby zmienić)"}
      className="inline-flex items-center justify-center rounded-[2px] hover:opacity-80 transition-opacity"
      style={{ width: 14, height: 14 }}
    >
      {isDark ? (
        <LucideIcons.Sun className="w-3.5 h-3.5" style={{ color: "#FA9346" }} />
      ) : (
        <LucideIcons.Moon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}
