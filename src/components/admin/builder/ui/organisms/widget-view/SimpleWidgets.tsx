// Read-only widget renderers (no inline editing). Returns null when the
// widget type isn't handled here — caller falls through to the main switch.
import { useEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
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
import { supabase } from "@/integrations/supabase/client";

type SearchResult = { id: string; slug: string; title: string; excerpt: string | null };

function SearchButtonWidget({ label, heading, liveResults, limit, lang }: {
  label: string;
  mode: "standalone" | "dropdown" | "fullscreen";
  heading: string;
  liveResults: boolean;
  limit: number;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30);
    else { setQ(""); setResults([]); setSearched(false); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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
    if (!open || !liveResults) return;
    const h = setTimeout(() => runSearch(q), 220);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, liveResults]);

  const placeholder = heading || (lang === "pl" ? "Czego dzisiaj szukasz?" : "What are you searching for?");
  const hasQuery = q.trim().length >= 2;
  const showEmpty = hasQuery && !loading && searched && results.length === 0;

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        aria-label="Search"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ borderRadius: 4 }}
        className="group inline-flex items-center gap-2 px-3.5 py-2 border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <LucideIcons.Search className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        <span className="text-xs font-medium leading-none text-foreground hidden sm:inline">
          {label}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-1/2 top-[calc(100%+12px)] z-50 w-[min(92vw,540px)] -translate-x-1/2 rounded-2xl bg-popover text-popover-foreground border border-border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Search"
        >
          {/* Input */}
          <form
            onSubmit={(e) => { e.preventDefault(); runSearch(q); }}
            className="flex items-center gap-3 p-4 border-b border-border"
          >
            <LucideIcons.Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-transparent border-none outline-none text-base text-foreground placeholder:text-muted-foreground"
            />
            {loading && <LucideIcons.Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            {q.length > 0 ? (
              <button
                type="button"
                aria-label="Clear"
                onClick={() => { setQ(""); setResults([]); setSearched(false); inputRef.current?.focus(); }}
                className="p-1 hover:bg-accent rounded-md transition-colors"
              >
                <LucideIcons.X className="w-4 h-4 text-muted-foreground" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-accent rounded-md transition-colors"
              >
                <LucideIcons.X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </form>

          {/* Results */}
          <div className="max-h-[380px] overflow-y-auto p-2">
            <div className="px-3 py-2 text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              {hasQuery
                ? (lang === "pl" ? "Wyniki" : "Results")
                : (lang === "pl" ? "Zacznij pisać, aby wyszukać" : "Start typing to search")}
            </div>

            {!hasQuery && (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                {lang === "pl"
                  ? "Wpisz co najmniej 2 znaki, aby zobaczyć wyniki."
                  : "Type at least 2 characters to see results."}
              </div>
            )}

            {showEmpty && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="p-3 rounded-full bg-muted mb-3">
                  <LucideIcons.Search className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium text-foreground">
                  {lang === "pl" ? "Nie znaleziono wyników" : "No results found"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {lang === "pl" ? "Spróbuj wpisać inne słowo kluczowe." : "Try a different keyword."}
                </div>
              </div>
            )}

            {hasQuery && results.length > 0 && (
              <div className="space-y-1">
                {results.map((r) => (
                  <a
                    key={r.id}
                    href={`/posts/${r.slug}`}
                    onClick={() => setOpen(false)}
                    className="w-full flex items-start gap-4 p-3 rounded-xl hover:bg-accent text-left transition-colors group cursor-pointer"
                  >
                    <div className="mt-0.5 p-2 rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors shrink-0">
                      <LucideIcons.FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{r.title}</div>
                      {r.excerpt && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{r.excerpt}</div>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

type Lang = "pl" | "en";

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
      const size = getNum(c, "size", 16);
      const box = Math.max(size + 16, COMPACT_ICON_BOX_SIZE);
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

      const XIcon = ({ size: s = 16 }: { size?: number }) => (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M18.244 2H21.5l-7.5 8.57L23 22h-6.84l-5.36-6.86L4.6 22H1.34l8.02-9.16L1 2h7.02l4.84 6.27L18.244 2Zm-1.2 18h1.86L7.06 4H5.1l11.944 16Z" />
        </svg>
      );

      type IconCmp = (props: { size?: number }) => ReactElement;
      const items: Array<{ k: string; altKeys?: string[]; Cmp: IconCmp; label: string }> = [
        { k: "facebook",  Cmp: (p) => <LucideIcons.Facebook {...p} />,  label: "Facebook" },
        { k: "x",         altKeys: ["twitter"], Cmp: (p) => <XIcon {...p} />, label: "X" },
        { k: "youtube",   Cmp: (p) => <LucideIcons.Youtube {...p} />,   label: "YouTube" },
        { k: "instagram", Cmp: (p) => <LucideIcons.Instagram {...p} />, label: "Instagram" },
        { k: "linkedin",  Cmp: (p) => <LucideIcons.Linkedin {...p} />,  label: "LinkedIn" },
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
        <div className={`flex flex-wrap items-center gap-1 text-foreground ${themeCls}`} style={compactRowStyle}>
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
              <a href={`mailto:${email}`} aria-label="Email" className={cls} style={style}><LucideIcons.Mail size={size} /></a>
            ) : (
              <span aria-label="Email (brak)" className={cls} style={style}><LucideIcons.Mail size={size} /></span>
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
      return (
        <button type="button" aria-label="Toggle theme" className="inline-flex items-center justify-center rounded-full hover:bg-muted transition" style={compactIconBoxStyle()}>
          <LucideIcons.Moon className="w-4 h-4" />
        </button>
      );
    case "account-link": {
      const signin = getStr(c, `signin_${lang}`) || getStr(c, "signin_pl") || "Zaloguj";
      const signup = getStr(c, `signup_${lang}`) || getStr(c, "signup_pl") || "Zarejestruj";
      return (
        <span className="inline-flex items-center gap-2 text-xs leading-none" style={compactRowStyle}>
          <a href="/login" className="inline-flex h-10 items-center gap-1 font-semibold text-muted-foreground hover:text-brand">
            <LucideIcons.LogIn className="w-3.5 h-3.5" /> {signin}
          </a>
          <span className="text-muted-foreground/40">|</span>
          <a href="/login?mode=signup" className="inline-flex h-10 items-center font-semibold text-brand hover:underline">{signup}</a>
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
            {imgs.map((src, i) => <img key={i} src={src} alt="" className="snap-start h-48 w-auto rounded object-cover" loading="lazy" />)}
          </div>
        );
      }
      if (variant === "masonry") {
        return (
          <div style={{ columnCount: cols, columnGap: gap === "lg" ? "1.5rem" : gap === "md" ? "1rem" : "0.5rem" }}>
            {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full mb-2 rounded break-inside-avoid" loading="lazy" />)}
          </div>
        );
      }
      if (variant === "polaroid") {
        return (
          <div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {imgs.map((src, i) => (
              <div key={i} className="bg-white p-2 pb-5 shadow-lg rotate-[-1deg] hover:rotate-0 transition">
                <img src={src} alt="" className="w-full h-32 object-cover" loading="lazy" />
              </div>
            ))}
          </div>
        );
      }
      return (
        <div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded" loading="lazy" />)}
        </div>
      );
    }
    case "image": {
      const src = safeImageUrl(getStr(c, "src"));
      const srcDark = safeImageUrl(getStr(c, "srcDark"));
      const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
      const caption = getStr(c, `caption_${lang}`) || getStr(c, "caption_pl");
      const variant = getStr(c, "variant") || "default";
      const fit = (getStr(c, "objectFit") || "cover") as CSSProperties["objectFit"];
      const ratio = getStr(c, "ratio");
      const widthPx = typeof c.widthPx === "number" ? c.widthPx : Number(c.widthPx) || 0;
      const maxWidthPx = typeof c.maxWidthPx === "number" ? c.maxWidthPx : Number(c.maxWidthPx) || 0;
      const align = (getStr(c, "align") || "center") as "left" | "center" | "right";
      const variantCls =
        variant === "rounded" ? "rounded-xl"
        : variant === "circle" ? "rounded-full aspect-square"
        : variant === "polaroid" ? "bg-white p-2 pb-6 shadow-lg rotate-[-1deg]"
        : variant === "shadow" ? "rounded shadow-2xl"
        : variant === "frame" ? "rounded border-4 border-foreground/10"
        : variant === "zoom-hover" ? "rounded overflow-hidden transition-transform duration-500 hover:scale-105"
        : "rounded";
      // Effective max-width: smaller of widthPx (preferred display width) and maxWidthPx (hard cap)
      const caps: number[] = [];
      if (widthPx > 0) caps.push(widthPx);
      if (maxWidthPx > 0) caps.push(maxWidthPx);
      const effectiveMaxPx = caps.length ? Math.min(...caps) : 0;
      const imgStyle: CSSProperties = {
        objectFit: fit,
        aspectRatio: ratio && ratio !== "auto" ? ratio.replace("/", " / ") : undefined,
        width: effectiveMaxPx > 0 ? `${effectiveMaxPx}px` : "100%",
        maxWidth: effectiveMaxPx > 0 ? "none" : "100%",
        height: "auto",
      };
      if (!src && !srcDark) return <div className="bg-muted rounded h-32 flex items-center justify-center text-xs text-muted-foreground">brak obrazka</div>;
      const activeSrc = theme === "dark" ? (srcDark || src) : (src || srcDark);
      const figureAlign = align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";
      const showResize = editable && !!onContentChange;
      return (
        <figure className={`space-y-2 flex flex-col ${figureAlign}`}>
          <ResizableImageWrap
            enabled={showResize}
            currentPx={widthPx > 0 ? widthPx : undefined}
            onCommit={(px) => onContentChange?.("widthPx", Math.round(px))}
          >
            <img src={activeSrc} alt={alt} className={`max-w-full h-auto ${variantCls}`} style={imgStyle} loading="lazy" />
          </ResizableImageWrap>
          {caption && <figcaption className="text-xs text-muted-foreground text-center">{caption}</figcaption>}
        </figure>
      );
    }
    case "slider": {
      const items = Array.isArray(c.items) ? (c.items as unknown[]).filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null) : [];
      const cfg = {
        variant: (getStr(c, "variant") || "classic") as SliderVariant,
        ratio: (getStr(c, "ratio") || "16/9") as "16/9" | "4/3" | "1/1" | "21/9" | "3/2",
        autoplay: c.autoplay !== false,
        intervalMs: getNum(c, "intervalMs", 4500),
        rounded: (getStr(c, "rounded") || "md") as "none" | "sm" | "md" | "lg" | "xl" | "full",
        overlayOpacity: typeof c.overlayOpacity === "number" ? c.overlayOpacity : 0.45,
        items: items.map((it) => ({
          image: typeof it.image === "string" ? it.image : "",
          title_pl: typeof it.title_pl === "string" ? it.title_pl : "",
          title_en: typeof it.title_en === "string" ? it.title_en : "",
          subtitle_pl: typeof it.subtitle_pl === "string" ? it.subtitle_pl : "",
          subtitle_en: typeof it.subtitle_en === "string" ? it.subtitle_en : "",
          href: typeof it.href === "string" ? it.href : "",
          cta_pl: typeof it.cta_pl === "string" ? it.cta_pl : "",
          cta_en: typeof it.cta_en === "string" ? it.cta_en : "",
        })),
      };
      return <SliderRender config={cfg} lang={lang} />;
    }
    case "animated-heading": {
      const rotateRaw = c[`rotateWords_${lang}`] ?? c.rotateWords_pl;
      const rotateWords = Array.isArray(rotateRaw)
        ? rotateRaw.filter((x): x is string => typeof x === "string")
        : typeof rotateRaw === "string"
          ? rotateRaw.split("\n").map((s) => s.trim()).filter(Boolean)
          : [];
      const ahCfg: AnimatedHeadingConfig = {
        mode: (getStr(c, "mode") || "highlight") as AnimatedHeadingMode,
        shape: (getStr(c, "shape") || "underline") as AnimatedHeadingShape,
        tag: (getStr(c, "tag") || "h2") as AnimatedHeadingConfig["tag"],
        align: (getStr(c, "align") || "left") as "left" | "center" | "right",
        textBefore: getStr(c, `textBefore_${lang}`) || getStr(c, "textBefore_pl"),
        textAfter:  getStr(c, `textAfter_${lang}`)  || getStr(c, "textAfter_pl"),
        highlight:  getStr(c, `highlight_${lang}`)  || getStr(c, "highlight_pl"),
        rotateWords,
        color: getStr(c, "color") || undefined,
        accentColor: getStr(c, "accentColor") || undefined,
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
      const accent = resolveAccentColor(color);
      return (
        <SectionLabelRender
          label={label}
          action={action || undefined}
          href={href || undefined}
          accent={accent}
          variant={variant}
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
    maxWidth: "none",
    width: displayPx ? `${displayPx}px` : "auto",
  };
  return (
    <div ref={ref} style={wrapStyle}>
      {children}
      <div
        role="slider"
        aria-label="Zmień rozmiar obrazka (zachowuje proporcje)"
        title={`Przeciągnij aby zmienić rozmiar${livePx ? ` — ${Math.round(livePx)}px` : ""}`}
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
