// Renders a widget (read-only by default; opt-in inline editing in the builder
// canvas via `editable` + `onContentChange`). Used in the live preview inside
// the builder canvas and on public pages. All user-authored strings (custom
// CSS, ids, classes, html, urls) go through src/lib/sanitize.ts.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, WidgetContent, CommonStyle, AdvancedSettings, Device } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import {
  sanitizeHtml,
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
} from "@/lib/sanitize";
import { useInView } from "@/hooks/use-in-view";
import { hoverCss } from "@/lib/builder/hoverCss";
import { useTheme } from "@/components/ThemeProvider";
import { NewsletterForm as NewsletterFormLive } from "@/components/NewsletterForm";
import {
  SectionLabelRender,
  resolveAccentColor,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";
import { SliderRender, type SliderVariant } from "@/lib/builder/sliderVariants";
import {
  AnimatedHeadingRender,
  type AnimatedHeadingConfig,
  type AnimatedHeadingMode,
  type AnimatedHeadingShape,
} from "@/lib/builder/animatedHeadingVariants";

type Lang = "pl" | "en";

import {
  styleToCSS, getWidgetFrameStyle, hiddenOnDevice,
  DEFAULT_WIDGET_WIDTH_BY_DEVICE, DEFAULT_WIDGET_MIN_HEIGHT, AUTO_SIZE_WIDGETS,
  getStr, getNum, getStrArr, normalizeNewsletterVariant,
} from "./ui/organisms/widget-view/frame";
import { MOTION_INITIAL, MOTION_FINAL } from "./ui/organisms/widget-view/motion";
import { Editable } from "./ui/molecules/Editable";
import { TtsPlayerHost } from "./ui/molecules/TtsPlayerHost";
import { PostListView } from "./ui/organisms/widget-view/PostListView";
import { RatedListView } from "./ui/organisms/widget-view/RatedListView";
import { CategoriesView } from "./ui/organisms/widget-view/CategoriesView";
import { TagsView } from "./ui/organisms/widget-view/TagsView";
import { TabsBlock } from "./ui/organisms/widget-view/TabsBlock";
import { renderSimpleWidget } from "./ui/organisms/widget-view/SimpleWidgets";
export {
  styleToCSS, getWidgetFrameStyle, hiddenOnDevice,
  DEFAULT_WIDGET_WIDTH_BY_DEVICE, DEFAULT_WIDGET_MIN_HEIGHT, AUTO_SIZE_WIDGETS,
};

const EASING_MAP: Record<string, string> = {
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  linear: "linear",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  bounce: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
};

interface ViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
  /** When true, click-to-edit text fields are enabled in canvas. */
  editable?: boolean;
  /** Commit a single content field. Called on blur / Enter. */
  onContentChange?: (key: string, value: string) => void;
}

export function WidgetView({ node, lang, device, editable = false, onContentChange }: ViewProps) {
  const { theme } = useTheme();
  const baseStyle = styleToCSS(node.style, device);
  const cls = sanitizeCssClass(node.advanced?.cssClass) ?? "";
  const htmlId = sanitizeHtmlId(node.advanced?.htmlId);
  const motion = node.advanced?.animation && node.advanced.animation !== "none"
    ? node.advanced.animation : undefined;

  const { ref: motionRef, inView } = useInView<HTMLDivElement>({
    once: node.advanced?.animationOnce !== false,
  });

  const dur = node.advanced?.animationDuration ?? 600;
  const delay = node.advanced?.animationDelay ?? 0;
  const dist = node.advanced?.animationDistance ?? 24;
  const ease = EASING_MAP[node.advanced?.animationEasing ?? "ease-out"] ?? "ease-out";
  const motionStyle: CSSProperties = motion
    ? {
        ...(inView ? MOTION_FINAL : (MOTION_INITIAL[motion]?.(dist) ?? {})),
        transition: `opacity ${dur}ms ${ease} ${delay}ms, transform ${dur}ms ${ease} ${delay}ms, filter ${dur}ms ${ease} ${delay}ms, clip-path ${dur}ms ${ease} ${delay}ms`,
        willChange: "opacity, transform, filter, clip-path",
      }
    : {};

  const scopedCss = scopeCustomCss(node.advanced?.customCss, node.id);
  const hover = hoverCss(node.id, node.style, device);

  const wrap = (children: React.ReactNode) => (
    <div
      id={htmlId}
      data-w-id={node.id}
      ref={motion ? motionRef : undefined}
      className={`${cls}`.trim()}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", width: "100%", height: "100%", maxWidth: "100%", ...baseStyle, ...motionStyle }}
    >
      {children}
      {hover && <style dangerouslySetInnerHTML={{ __html: hover }} />}
      {scopedCss && <style dangerouslySetInnerHTML={{ __html: scopedCss }} />}
    </div>
  );

  const c = node.content;
  const canEdit = editable && !!onContentChange;
  const commit = (k: string, v: string) => onContentChange?.(k, v);

  switch (node.type) {
    case "heading": {
      const key = `text_${lang}`;
      const text = getStr(c, key) || getStr(c, "text_pl");
      const subtitle = getStr(c, `subtitle_${lang}`) || getStr(c, "subtitle_pl");
      const tag = (getStr(c, "tag") || "h2") as "h1"|"h2"|"h3"|"h4"|"h5"|"h6";
      const variant = getStr(c, "variant") || "default";
      const sizePreset = getStr(c, "sizePreset") || "md";
      const sizePx = getNum(c, "sizePx", 0);
      const sizePxMobile = getNum(c, "sizePxMobile", 0);
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const iconName = getStr(c, "iconName");
      const iconPos = getStr(c, "iconPosition") || "left";
      const usePx = sizePx > 0;
      const sizeCls = usePx
        ? ""
        : sizePreset === "sm" ? "text-xl"
        : sizePreset === "lg" ? "text-4xl"
        : sizePreset === "xl" ? "text-5xl"
        : sizePreset === "display" ? "text-6xl md:text-7xl"
        : "text-3xl";
      const variantCls =
        variant === "gradient" ? "bg-gradient-to-r from-brand to-foreground bg-clip-text text-transparent"
        : variant === "outlined" ? "[-webkit-text-stroke:1px_currentColor] text-transparent"
        : variant === "highlight" ? "decoration-brand decoration-4 underline-offset-4 underline"
        : variant === "uppercase" ? "uppercase tracking-widest"
        : variant === "serif" ? "font-serif"
        : "";
      const headCls = `font-display ${sizeCls} ${variantCls}`.trim();
      const headStyle: React.CSSProperties | undefined = usePx
        ? { fontSize: `${sizePxMobile > 0 ? sizePxMobile : sizePx}px`, lineHeight: 1.1 }
        : undefined;
      // Desktop override via media query (inline style can't do MQ — use CSS var + class)
      const mqStyle: React.CSSProperties | undefined = usePx && sizePxMobile > 0
        ? ({ ["--h-px" as never]: `${sizePx}px` } as React.CSSProperties)
        : undefined;
      const finalStyle = mqStyle ? { ...headStyle, ...mqStyle } : headStyle;
      const finalCls = usePx && sizePxMobile > 0
        ? `${headCls} md:[font-size:var(--h-px)]`
        : headCls;
      const reg: Record<string, React.ComponentType<{ size?: number; className?: string }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number; className?: string }> | undefined>;
      const Icon = iconName ? (reg[iconName] ?? null) : null;
      const inner = canEdit
        ? <Editable as={tag} value={text} onCommit={(v) => commit(key, v)} className={finalCls} style={finalStyle} placeholder="Nagłówek…" />
        : (() => { const Tag = tag as React.ElementType; return <Tag className={finalCls} style={finalStyle}>{text}</Tag>; })();
      const titleRow = (
        <span className={`inline-flex items-center gap-2 ${iconPos === "right" ? "flex-row-reverse" : ""}`}>
          {Icon && <Icon size={28} className="opacity-80" />}
          <span className="contents">{inner}</span>
        </span>
      );
      const block = (
        <div className="space-y-1">
          {href ? <a href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} className="hover:opacity-80 transition">{titleRow}</a> : titleRow}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      );
      return wrap(block);
    }
    case "text": {
      const key = `html_${lang}`;
      const html = getStr(c, key) || getStr(c, "html_pl");
      const cols = getNum(c, "columns", 1);
      const dropCap = getStr(c, "dropCap") === "on";
      const proseCls = `prose prose-sm max-w-none dark:prose-invert ${dropCap ? "first-letter:float-left first-letter:text-5xl first-letter:font-display first-letter:mr-2 first-letter:leading-none" : ""}`;
      const colStyle = cols > 1 ? { columnCount: cols, columnGap: "1.5rem" } as CSSProperties : undefined;
      if (canEdit) {
        return wrap(<Editable as="div" html multiline value={html} onCommit={(v) => commit(key, v)} className={proseCls} placeholder="Wpisz tekst…" />);
      }
      return wrap(<div className={proseCls} style={colStyle} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />);
    }
    case "image": {
      const src = safeImageUrl(getStr(c, "src"));
      const srcDark = safeImageUrl(getStr(c, "srcDark"));
      const alt = getStr(c, `alt_${lang}`) || getStr(c, "alt_pl");
      const caption = getStr(c, `caption_${lang}`) || getStr(c, "caption_pl");
      const variant = getStr(c, "variant") || "default";
      const fit = (getStr(c, "objectFit") || "cover") as CSSProperties["objectFit"];
      const ratio = getStr(c, "ratio");
      const variantCls =
        variant === "rounded" ? "rounded-xl"
        : variant === "circle" ? "rounded-full aspect-square"
        : variant === "polaroid" ? "bg-white p-2 pb-6 shadow-lg rotate-[-1deg]"
        : variant === "shadow" ? "rounded shadow-2xl"
        : variant === "frame" ? "rounded border-4 border-foreground/10"
        : variant === "zoom-hover" ? "rounded overflow-hidden transition-transform duration-500 hover:scale-105"
        : "rounded";
      const imgStyle: CSSProperties = {
        objectFit: fit,
        aspectRatio: ratio && ratio !== "auto" ? ratio.replace("/", " / ") : undefined,
        width: "100%",
        height: "auto",
      };
      if (!src && !srcDark) return wrap(<div className="bg-muted rounded h-32 flex items-center justify-center text-xs text-muted-foreground">brak obrazka</div>);
      const activeSrc = theme === "dark" ? (srcDark || src) : (src || srcDark);
      const imgEl = (
        <img src={activeSrc} alt={alt} className={`max-w-full h-auto ${variantCls}`} style={imgStyle} loading="lazy" />
      );
      return wrap(
        <figure className="space-y-2">
          {imgEl}
          {caption && <figcaption className="text-xs text-muted-foreground text-center">{caption}</figcaption>}
        </figure>,
      );
    }
    case "button": {
      const key = `label_${lang}`;
      const label = getStr(c, key) || getStr(c, "label_pl");
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const variant = getStr(c, "variant") || "primary";
      const size = getStr(c, "size") || "md";
      const iconName = getStr(c, "iconName");
      const iconPos = getStr(c, "iconPosition") || "left";
      const fullWidth = getStr(c, "fullWidth") === "full";
      const variantCls =
        variant === "outline" ? "border border-border hover:bg-muted"
        : variant === "ghost" ? "hover:bg-muted"
        : variant === "gradient" ? "bg-gradient-to-r from-brand to-foreground text-brand-foreground hover:opacity-90"
        : variant === "soft" ? "bg-brand/10 text-brand hover:bg-brand/20"
        : variant === "link" ? "underline-offset-4 hover:underline text-brand px-0"
        : "bg-brand text-brand-foreground hover:opacity-90";
      const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "px-7 py-3 text-base" : "px-5 py-2.5 text-sm";
      const cls = `inline-flex items-center gap-2 rounded-md font-medium transition ${sizeCls} ${variantCls} ${fullWidth ? "w-full justify-center" : ""} ${iconPos === "right" ? "flex-row-reverse" : ""}`;
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Icon = iconName ? (reg[iconName] ?? null) : null;
      if (canEdit) {
        return wrap(<span className={cls}>{Icon && <Icon size={16} />}<Editable as="span" value={label} onCommit={(v) => commit(key, v)} placeholder="Etykieta…" /></span>);
      }
      return wrap(<a href={href} target={target} rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined} className={cls}>{Icon && <Icon size={16} />}{label}</a>);
    }
    case "nav-link": {
      const key = `label_${lang}`;
      const label = getStr(c, key) || getStr(c, "label_pl");
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const variant = getStr(c, "variant") || "text";
      const iconName = getStr(c, "iconName");
      const variantCls =
        variant === "primary" ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand text-brand-foreground hover:opacity-90"
        : variant === "outline" ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border hover:bg-muted"
        : variant === "pill" ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70"
        : variant === "underline" ? "inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
        : "inline-flex items-center gap-1.5 hover:text-brand";
      const cls = `text-xs font-bold tracking-wider transition ${variantCls}`;
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Cmp = iconName ? (reg[iconName] ?? null) : null;
      if (canEdit) {
        return wrap(
          <span className={cls}>
            {Cmp ? <Cmp size={14} /> : null}
            <Editable as="span" value={label} onCommit={(v) => commit(key, v)} placeholder="Etykieta…" />
          </span>,
        );
      }
      return wrap(
        <a
          href={href}
          target={target}
          rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined}
          className={cls}
        >
          {Cmp ? <Cmp size={14} /> : null}
          {label}
        </a>,
      );
    }
    case "divider": {
      const variant = getStr(c, "variant") || "line";
      const thickness = getNum(c, "thickness", 1);
      if (variant === "gradient") {
        return wrap(<div style={{ height: `${thickness}px` }} className="bg-gradient-to-r from-transparent via-border to-transparent" />);
      }
      if (variant === "icon") {
        const iconName = getStr(c, "iconName") || "Star";
        const reg = LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
        const Icon = reg[iconName] ?? LucideIcons.Star;
        return wrap(
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="flex-1 border-t border-border" style={{ borderTopWidth: thickness }} />
            <Icon size={16} />
            <div className="flex-1 border-t border-border" style={{ borderTopWidth: thickness }} />
          </div>,
        );
      }
      if (variant === "wave") {
        return wrap(
          <svg viewBox="0 0 200 8" preserveAspectRatio="none" className="w-full h-3 text-border">
            <path d="M0 4 Q 25 0 50 4 T 100 4 T 150 4 T 200 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>,
        );
      }
      const styleType = variant === "dashed" ? "dashed" : variant === "dotted" ? "dotted" : variant === "double" ? "double" : "solid";
      return wrap(<hr className="border-border" style={{ borderTopStyle: styleType, borderTopWidth: thickness }} />);
    }
    case "spacer":
      return wrap(<div style={{ height: `${getNum(c, "height", 32)}px` }} />);
    case "social-icons": {
      const size = getNum(c, "size", 16);
      const items: Array<{ k: string; Cmp: LucideIcons.LucideIcon; label: string; href?: string }> = [
        { k: "facebook",  Cmp: LucideIcons.Facebook,  label: "Facebook" },
        { k: "twitter",   Cmp: LucideIcons.Twitter,   label: "X" },
        { k: "youtube",   Cmp: LucideIcons.Youtube,   label: "YouTube" },
        { k: "instagram", Cmp: LucideIcons.Instagram, label: "Instagram" },
        { k: "linkedin",  Cmp: LucideIcons.Linkedin,  label: "LinkedIn" },
      ];
      const email = getStr(c, "email");
      return wrap(
        <div className="flex items-center gap-3 text-muted-foreground">
          {items.map(({ k, Cmp, label }) => {
            const href = getStr(c, k);
            if (!href) return null;
            return <a key={k} href={safeUrl(href)} aria-label={label} className="hover:text-brand"><Cmp size={size} /></a>;
          })}
          {email && <a href={`mailto:${email}`} aria-label="Email" className="hover:text-brand"><LucideIcons.Mail size={size} /></a>}
        </div>,
      );
    }
    case "lang-switcher": {
      const showLabel = c.showLabel !== false;
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Zmień język";
      return wrap(
        <div className="inline-flex items-center gap-3 text-xs">
          {showLabel && <span className="hidden md:inline text-muted-foreground">{label}</span>}
          <button type="button" aria-label="English" className="text-base leading-none opacity-60 hover:opacity-100">🇬🇧</button>
          <button type="button" aria-label="Polski" className="text-base leading-none opacity-60 hover:opacity-100">🇵🇱</button>
        </div>,
      );
    }
    case "theme-toggle": {
      return wrap(
        <button type="button" aria-label="Toggle theme" className="p-2 rounded-full hover:bg-muted transition">
          <LucideIcons.Moon className="w-4 h-4" />
        </button>,
      );
    }
    case "account-link": {
      const signin = getStr(c, `signin_${lang}`) || getStr(c, "signin_pl") || "Zaloguj";
      const signup = getStr(c, `signup_${lang}`) || getStr(c, "signup_pl") || "Zarejestruj";
      return wrap(
        <span className="inline-flex items-center gap-2 text-xs">
          <a href="/login" className="inline-flex items-center gap-1 font-semibold text-muted-foreground hover:text-brand">
            <LucideIcons.LogIn className="w-3.5 h-3.5" /> {signin}
          </a>
          <span className="text-muted-foreground/40">|</span>
          <a href="/login?mode=signup" className="font-semibold text-brand hover:underline">{signup}</a>
        </span>,
      );
    }
    case "search-button": {
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || "Szukaj";
      return wrap(
        <button type="button" aria-label="Search" className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition">
          <LucideIcons.Search className="w-4 h-4" />
          <span className="hidden sm:inline">{label}</span>
        </button>,
      );
    }
    case "copyright": {
      const txt = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const showYear = c.showYear !== false;
      const brand = getStr(c, "brand");
      return wrap(
        <div className="text-xs text-muted-foreground text-center">
          {showYear && `© ${new Date().getFullYear()} `}{brand}{brand && txt ? ". " : ""}{txt}{txt && "."}
        </div>,
      );
    }
    case "video": {
      const url = getStr(c, "url");
      const ratio = getStr(c, "ratio") || "16/9";
      const autoplay = getStr(c, "autoplay") === "on";
      const loop = getStr(c, "loop") === "on";
      const controls = getStr(c, "controls") !== "off";
      const ratioStyle: CSSProperties = { aspectRatio: ratio.replace("/", " / ") };
      if (!url) return wrap(<div className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground" style={ratioStyle}>brak wideo</div>);
      const ytMatch = url.match(/(?:youtube\.com\/.*v=|youtu\.be\/)([\w-]+)/);
      if (ytMatch) {
        const params = new URLSearchParams();
        if (autoplay) { params.set("autoplay", "1"); params.set("mute", "1"); }
        if (loop) { params.set("loop", "1"); params.set("playlist", ytMatch[1]); }
        if (!controls) params.set("controls", "0");
        const q = params.toString();
        return wrap(<div style={ratioStyle}><iframe src={`https://www.youtube.com/embed/${ytMatch[1]}${q ? `?${q}` : ""}`} title="video" className="w-full h-full rounded" allowFullScreen /></div>);
      }
      const safe = safeImageUrl(url) || (url.startsWith("https://") ? url : "");
      if (!safe) return wrap(<div className="bg-muted rounded flex items-center justify-center text-xs text-muted-foreground" style={ratioStyle}>niedozwolony URL</div>);
      return wrap(<video src={safe} controls={controls} autoPlay={autoplay} muted={autoplay} loop={loop} playsInline className="w-full rounded" style={ratioStyle} />);
    }
    case "gallery": {
      const imgs = getStrArr(c, "images").map(safeImageUrl).filter(Boolean);
      const cols = getNum(c, "columns", 3);
      const variant = getStr(c, "variant") || "grid";
      const gap = getStr(c, "gap") || "sm";
      const gapCls = gap === "none" ? "gap-0" : gap === "xs" ? "gap-1" : gap === "md" ? "gap-4" : gap === "lg" ? "gap-6" : "gap-2";
      if (imgs.length === 0) return wrap(<div className="bg-muted rounded h-24 flex items-center justify-center text-xs text-muted-foreground">brak zdjęć</div>);
      if (variant === "carousel") {
        return wrap(
          <div className={`flex ${gapCls} overflow-x-auto snap-x pb-2`}>
            {imgs.map((src, i) => <img key={i} src={src} alt="" className="snap-start h-48 w-auto rounded object-cover" loading="lazy" />)}
          </div>,
        );
      }
      if (variant === "masonry") {
        return wrap(
          <div style={{ columnCount: cols, columnGap: gap === "lg" ? "1.5rem" : gap === "md" ? "1rem" : "0.5rem" }}>
            {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full mb-2 rounded break-inside-avoid" loading="lazy" />)}
          </div>,
        );
      }
      if (variant === "polaroid") {
        return wrap(
          <div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {imgs.map((src, i) => (
              <div key={i} className="bg-white p-2 pb-5 shadow-lg rotate-[-1deg] hover:rotate-0 transition">
                <img src={src} alt="" className="w-full h-32 object-cover" loading="lazy" />
              </div>
            ))}
          </div>,
        );
      }
      return wrap(<div className={`grid ${gapCls}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {imgs.map((src, i) => <img key={i} src={src} alt="" className="w-full h-32 object-cover rounded" loading="lazy" />)}
      </div>);
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
      return wrap(<SliderRender config={cfg} lang={lang} />);
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
      return wrap(<AnimatedHeadingRender config={ahCfg} />);
    }
    case "icon": {
      const name = getStr(c, "name") || "Star";
      const size = getNum(c, "size", 32);
      const variant = getStr(c, "variant") || "plain";
      const spin = getStr(c, "spin") || "none";
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Cmp = reg[name] ?? LucideIcons.Star;
      const spinCls = spin === "spin" ? "animate-spin" : spin === "pulse" ? "animate-pulse" : spin === "bounce" ? "animate-bounce" : "";
      const wrapperCls =
        variant === "circle" ? "inline-flex items-center justify-center rounded-full bg-brand/10 text-brand p-3"
        : variant === "square" ? "inline-flex items-center justify-center rounded-md bg-brand/10 text-brand p-3"
        : variant === "soft" ? "inline-flex items-center justify-center rounded-lg bg-muted p-3"
        : variant === "outlined" ? "inline-flex items-center justify-center rounded-lg border border-border p-3"
        : "inline-flex";
      return wrap(<span className={`${wrapperCls} ${spinCls}`.trim()}><Cmp size={size} /></span>);
    }
    case "map": {
      const q = getStr(c, "query") || "Warszawa";
      const ratio = getStr(c, "ratio") || "16/9";
      const src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
      return wrap(<div style={{ aspectRatio: ratio.replace("/", " / ") }}><iframe src={src} title="map" className="w-full h-full rounded border-0" /></div>);
    }
    case "tts": {
      const source = getStr(c, "source") || "post";
      const customText = getStr(c, `text_${lang}`) || getStr(c, "text_pl");
      const label = getStr(c, `label_${lang}`) || getStr(c, "label_pl") || (lang === "pl" ? "Odsłuchaj artykuł" : "Listen to article");
      const voiceId = getStr(c, "voiceId") || "JBFqnCBsd6RMkjVDRZzb";
      const model = getStr(c, "model") || "eleven_multilingual_v2";
      return wrap(
        <TtsPlayerHost
          source={source}
          customText={customText}
          label={label}
          voiceId={voiceId}
          model={model}
          nodeId={node.id}
        />,
      );
    }
    case "post-list":
      return wrap(<PostListView c={c} lang={lang} />);
    case "carousel":
      return wrap(<PostListView c={c} lang={lang} carousel />);
    case "categories":
      return wrap(<CategoriesView lang={lang} />);
    case "tags":
      return wrap(<TagsView />);
    case "newsletter": {
      const tKey = `title_${lang}`;
      const title = getStr(c, tKey) || getStr(c, "title_pl") || "Newsletter";
      const variant = normalizeNewsletterVariant(getStr(c, "variant") || "icon");
      const placeholder = getStr(c, `placeholder_${lang}`) || getStr(c, "placeholder_pl") || "Twój email";
      const ctaLabel = getStr(c, `cta_${lang}`) || getStr(c, "cta_pl") || "Zapisz";
      const iconName = getStr(c, "iconName") || "Mail";
      const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
      const IconCmp = Icons[iconName] || Icons.Mail;

      // Builder canvas → statyczny podgląd (bez submitu do bazy).
      // Public render → realny <NewsletterForm/> z RLS-insert.
      if (!editable) {
        if (variant === "minimal") {
          return wrap(<span className="text-sm font-medium border-b border-dashed border-foreground/30 hover:border-brand transition cursor-pointer">{title}</span>);
        }
        if (variant === "icon-only") {
          return wrap(
            <a href="#newsletter" className="inline-flex items-center justify-center w-10 h-10 rounded-full text-foreground/80 hover:text-brand hover:bg-foreground/5 transition-colors" title={title} aria-label={title}>
              {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
            </a>,
          );
        }
        if (variant === "icon") {
          return wrap(
            <a href="#newsletter" className="inline-flex items-center gap-2 text-foreground/80 hover:text-brand transition-colors" title={title}>
              {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
              <span className="text-sm font-medium">{title}</span>
            </a>,
          );
        }
        return wrap(
          <NewsletterFormLive
            lang={lang}
            variant={variant === "inline" ? "inline" : "card"}
            source={`widget:${node.id}`}
          />,
        );
      }

      // editable=true → builder preview (oryginalna statyczna grafika)
      if (variant === "inline") {
        return wrap(
          <form className="flex gap-2 w-full max-w-md" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder={placeholder} className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm" />
            <button type="submit" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium hover:opacity-90">{ctaLabel}</button>
          </form>,
        );
      }
      if (variant === "card") {
        return wrap(
          <div className="rounded-xl border border-border bg-card p-6 space-y-3 max-w-md">
            <div className="flex items-center gap-2">{IconCmp && <IconCmp className="w-5 h-5 text-brand" />}<h4 className="font-display text-lg">{title}</h4></div>
            <form className="flex gap-2" onSubmit={(e) => e.preventDefault()}>
              <input type="email" placeholder={placeholder} className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm" />
              <button type="submit" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm font-medium hover:opacity-90">{ctaLabel}</button>
            </form>
          </div>,
        );
      }
      if (variant === "minimal") {
        return wrap(<span className="text-sm font-medium border-b border-dashed border-foreground/30 hover:border-brand transition cursor-pointer">{title}</span>);
      }
      if (variant === "icon-only") {
        return wrap(
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full text-foreground/80 hover:text-brand hover:bg-foreground/5 transition-colors cursor-pointer" title={title} aria-label={title}>
            {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          </div>,
        );
      }
      return wrap(
        <div className="inline-flex items-center gap-2 text-foreground/80 hover:text-brand transition-colors cursor-pointer" title={title}>
          {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          <span className="text-sm font-medium">{title}</span>
        </div>,
      );
    }

    case "contact": {
      const variant = getStr(c, "variant") || "stacked";
      const wrapCls = variant === "card" ? "space-y-3 bg-card border border-border rounded-xl p-5" : "space-y-3";
      if (variant === "compact") {
        return wrap(
          <form className="flex flex-col sm:flex-row gap-2">
            <input placeholder="Email" className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm" />
            <input placeholder="Wiadomość" className="flex-[2] bg-background border border-border rounded px-3 py-2 text-sm" />
            <button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button>
          </form>,
        );
      }
      return wrap(
        <form className={wrapCls}>
          <input placeholder="Imię" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <input placeholder="Email" className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <textarea placeholder="Wiadomość" rows={4} className="w-full bg-background border border-border rounded px-3 py-2 text-sm" />
          <button type="button" className="bg-brand text-brand-foreground px-4 py-2 rounded text-sm">Wyślij</button>
        </form>,
      );
    }
    case "cta": {
      const tKey = `title_${lang}`;
      const cKey = `cta_${lang}`;
      const title = getStr(c, tKey) || getStr(c, "title_pl");
      const subtitle = getStr(c, `subtitle_${lang}`) || getStr(c, "subtitle_pl");
      const cta = getStr(c, cKey) || getStr(c, "cta_pl");
      const href = safeUrl(getStr(c, "href"));
      const variant = getStr(c, "variant") || "default";
      const align = getStr(c, "align") || "between";
      const containerCls =
        variant === "gradient" ? "bg-gradient-to-r from-brand to-foreground text-brand-foreground rounded-xl p-8"
        : variant === "bar" ? "bg-brand text-brand-foreground rounded-md py-3 px-5"
        : variant === "card" ? "bg-card border border-border rounded-xl p-8 shadow-2xl"
        : "bg-brand text-brand-foreground rounded-lg p-8";
      const layoutCls = variant === "split"
        ? "flex flex-col items-start gap-4"
        : `flex flex-col sm:flex-row gap-4 ${align === "left" ? "items-start sm:items-center" : align === "center" ? "items-center justify-center text-center" : "items-center justify-between"}`;
      const ctaBtn = canEdit
        ? <Editable as="span" value={cta} onCommit={(v) => commit(cKey, v)} className="bg-brand-foreground text-brand px-5 py-2.5 rounded font-medium" placeholder="Etykieta…" />
        : <a href={href} className="bg-brand-foreground text-brand px-5 py-2.5 rounded font-medium hover:opacity-90 transition">{cta}</a>;
      return wrap(
        <div className={containerCls}>
          <div className={layoutCls}>
            <div className="space-y-1">
              {canEdit
                ? <Editable as="h3" value={title} onCommit={(v) => commit(tKey, v)} className="font-display text-2xl" placeholder="Nagłówek CTA…" />
                : <h3 className="font-display text-2xl">{title}</h3>}
              {subtitle && <p className="text-sm opacity-80">{subtitle}</p>}
            </div>
            {ctaBtn}
          </div>
        </div>,
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
      return wrap(
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
        </div>,
      );
    }
    case "tabs": {
      const tabs = Array.isArray(c.tabs) ? c.tabs as Array<Record<string, string>> : [];
      return wrap(<TabsBlock tabs={tabs} lang={lang} nodeId={node.id} />);
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
      return wrap(
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
        </figure>,
      );
    }
    case "pricing": {
      const plans = Array.isArray(c.plans) ? c.plans as Array<Record<string, unknown>> : [];
      return wrap(
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
      return wrap(
        <SectionLabelRender
          label={label}
          action={action || undefined}
          href={href || undefined}
          accent={accent}
          variant={variant}
        />,
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
      return wrap(
        <div className="border-y border-border bg-muted/40 py-3 px-4">
          {href ? <a href={href} className="block hover:opacity-90 transition">{inner}</a> : inner}
        </div>,
      );
    }
    case "rated-list":
      return wrap(<RatedListView c={c} lang={lang} />);


    case "dark-featured-card": {
      const badgeKey = `badge_${lang}`;
      const badge = getStr(c, badgeKey) || getStr(c, "badge_pl");
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl");
      const excerpt = getStr(c, `excerpt_${lang}`) || getStr(c, "excerpt_pl");
      const img = safeImageUrl(getStr(c, "image"));
      const href = safeUrl(getStr(c, "href"));
      const badgeVariant = getStr(c, "badgeVariant") || "solid-red";
      const badgeRadius = getStr(c, "badgeRadius") || "none";
      const badgeSize = getStr(c, "badgeSize") || "xs";
      const radiusCls =
        badgeRadius === "sm" ? "rounded-sm"
        : badgeRadius === "md" ? "rounded-md"
        : badgeRadius === "lg" ? "rounded-lg"
        : badgeRadius === "full" ? "rounded-full"
        : "rounded-none";
      const sizeCls =
        badgeSize === "sm" ? "text-sm px-3.5 py-1.5"
        : badgeSize === "md" ? "text-base px-4 py-2"
        : "text-xs px-3 py-1";
      const variantCls =
        badgeVariant === "solid-brand" ? "bg-brand text-brand-foreground"
        : badgeVariant === "solid-dark" ? "bg-foreground text-background"
        : badgeVariant === "outline" ? "border border-white/60 text-white bg-transparent"
        : badgeVariant === "ghost" ? "bg-white/10 text-white backdrop-blur"
        : badgeVariant === "gradient" ? "bg-gradient-to-r from-destructive to-brand text-white"
        : "bg-destructive text-white";
      const badgeCls = `inline-block font-bold uppercase tracking-wider mb-3 ${sizeCls} ${variantCls} ${radiusCls}`;
      const card = (
        <div className="relative bg-[oklch(0.18_0.02_260)] text-white p-6 rounded">
          {(badge || canEdit) && (
            canEdit
              ? <Editable as="div" value={badge} onCommit={(v) => commit(badgeKey, v)} className={badgeCls} placeholder="Etykieta…" />
              : <div className={badgeCls}>{badge}</div>
          )}
          {img && <img src={img} alt="" className="w-full h-72 object-cover rounded" loading="lazy" />}
          <h3 className="mt-4 font-display text-2xl font-bold">{title}</h3>
          {excerpt && <p className="text-sm text-white/70 mt-2">{excerpt}</p>}
        </div>
      );
      return wrap(href ? <a href={href} className="block hover:opacity-95 transition">{card}</a> : card);
    }
    default:
      return null;
  }
}

