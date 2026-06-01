// Renders a widget (read-only by default; opt-in inline editing in the builder
// canvas via `editable` + `onContentChange`). Used in the live preview inside
// the builder canvas and on public pages. All user-authored strings (custom
// CSS, ids, classes, html, urls) go through src/lib/sanitize.ts.
import { useEffect, useRef, useState, type CSSProperties, type ElementType, type KeyboardEvent } from "react";
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
import { TtsPlayer } from "@/components/TtsPlayer";
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

const DEFAULT_WIDGET_BOX_WIDTH = 192;
const DEFAULT_WIDGET_BOX_HEIGHT = 192;

const pick = <T,>(
  rv: { desktop?: T; tablet?: T; mobile?: T } | undefined,
  device: Device,
): T | undefined => {
  if (!rv) return undefined;
  return rv[device] ?? rv.desktop ?? rv.tablet ?? rv.mobile;
};

export const styleToCSS = (
  s: CommonStyle | undefined,
  device: Device,
): CSSProperties => {
  if (!s) return {};
  const css: CSSProperties = {};
  if (s.bgColor) css.background = s.bgColor;
  if (s.textColor) css.color = s.textColor;
  const padding = pick(s.padding, device);
  if (padding) css.padding = padding;
  const margin = pick(s.margin, device);
  if (margin) css.margin = margin;
  const align = pick(s.align, device);
  if (align) css.textAlign = align;
  if (s.borderRadius) css.borderRadius = s.borderRadius;
  if (s.maxWidth) css.maxWidth = s.maxWidth;
  if (s.minHeight) css.minHeight = s.minHeight;
  if (s.borderStyle && s.borderStyle !== "none") {
    css.borderStyle = s.borderStyle;
    css.borderWidth = s.borderWidth || "1px";
    if (s.borderColor) css.borderColor = s.borderColor;
  }
  if (s.boxShadow) css.boxShadow = s.boxShadow;
  if (typeof s.opacity === "number") css.opacity = s.opacity;
  const t = s.typography;
  if (t) {
    if (t.fontFamily) css.fontFamily = t.fontFamily;
    const size = pick(t.fontSize, device);
    if (size) css.fontSize = size;
    if (t.fontWeight) css.fontWeight = t.fontWeight;
    if (t.fontStyle) css.fontStyle = t.fontStyle;
    if (t.lineHeight) css.lineHeight = t.lineHeight;
    if (t.letterSpacing) css.letterSpacing = t.letterSpacing;
    if (t.textTransform) css.textTransform = t.textTransform;
    if (t.textDecoration) css.textDecoration = t.textDecoration;
  }
  return css;
};

export const getWidgetFrameStyle = (node: WidgetNode): CSSProperties => ({
  width: (node.advanced as { width?: number | string } | undefined)?.width ?? node.style?.maxWidth ?? DEFAULT_WIDGET_BOX_WIDTH,
  minHeight: (node.advanced as { height?: number | string } | undefined)?.height ?? node.style?.minHeight ?? DEFAULT_WIDGET_BOX_HEIGHT,
  maxWidth: "100%",
});

export const hiddenOnDevice = (a: AdvancedSettings | undefined, device: Device): boolean =>
  Boolean(a?.hideOn?.[device]);

interface ViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
  /** When true, click-to-edit text fields are enabled in canvas. */
  editable?: boolean;
  /** Commit a single content field. Called on blur / Enter. */
  onContentChange?: (key: string, value: string) => void;
}

/** Inline-editable text node. Plain text by default; pass `html` to allow rich content. */
function Editable({
  as: As = "span",
  value,
  onCommit,
  className,
  style,
  html = false,
  multiline = false,
  placeholder,
}: {
  as?: ElementType;
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  style?: CSSProperties;
  html?: boolean;
  multiline?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  // Sync DOM with prop only when not focused, so caret position is preserved.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (html) {
      if (el.innerHTML !== value) el.innerHTML = value;
    } else if (el.textContent !== value) {
      el.textContent = value;
    }
  }, [value, html]);
  const commit = () => {
    const el = ref.current;
    if (!el) return;
    const next = html ? sanitizeHtml(el.innerHTML) : (el.textContent ?? "");
    if (next !== value) onCommit(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && !multiline && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      const el = ref.current;
      if (el) {
        if (html) el.innerHTML = value;
        else el.textContent = value;
      }
      (e.target as HTMLElement).blur();
    }
  };
  return (
    <As
      ref={ref as never}
      contentEditable
      suppressContentEditableWarning
      data-placeholder={placeholder}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e: React.MouseEvent) => e.stopPropagation()}
      onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
      className={`${className ?? ""} outline-none focus:ring-2 focus:ring-brand/40 focus:rounded empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50`}
      style={style}
    />
  );
}

function getStr(c: WidgetContent, k: string): string {
  const v = c[k];
  return typeof v === "string" ? v : "";
}

function normalizeNewsletterVariant(value: string): string {
  switch (value) {
    case "sama ikona":
      return "icon-only";
    case "ikona + tekst":
      return "icon";
    case "inline (email + przycisk)":
      return "inline";
    case "karta z formularzem":
      return "card";
    default:
      return value;
  }
}

function getNum(c: WidgetContent, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}
function getStrArr(c: WidgetContent, k: string): string[] {
  const v = c[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

const MOTION_INITIAL: Record<string, (d: number) => CSSProperties> = {
  fade:          () => ({ opacity: 0 }),
  "slide-up":    (d) => ({ opacity: 0, transform: `translateY(${d}px)` }),
  "slide-down":  (d) => ({ opacity: 0, transform: `translateY(-${d}px)` }),
  "slide-left":  (d) => ({ opacity: 0, transform: `translateX(${d}px)` }),
  "slide-right": (d) => ({ opacity: 0, transform: `translateX(-${d}px)` }),
  zoom:          () => ({ opacity: 0, transform: "scale(0.92)" }),
  "zoom-out":    () => ({ opacity: 0, transform: "scale(1.08)" }),
  bounce:        (d) => ({ opacity: 0, transform: `translateY(${d}px) scale(0.96)` }),
  "flip-x":      () => ({ opacity: 0, transform: "perspective(800px) rotateX(70deg)" }),
  "flip-y":      () => ({ opacity: 0, transform: "perspective(800px) rotateY(70deg)" }),
  rotate:        () => ({ opacity: 0, transform: "rotate(-12deg) scale(0.96)" }),
  skew:          () => ({ opacity: 0, transform: "skewY(6deg) translateY(16px)" }),
  blur:          () => ({ opacity: 0, filter: "blur(12px)" }),
  "reveal-up":   (d) => ({ opacity: 0, clipPath: "inset(100% 0 0 0)", transform: `translateY(${d / 2}px)` }),
  "reveal-down": (d) => ({ opacity: 0, clipPath: "inset(0 0 100% 0)", transform: `translateY(-${d / 2}px)` }),
  tilt:          () => ({ opacity: 0, transform: "rotate(4deg) translateY(20px)" }),
  swing:         () => ({ opacity: 0, transform: "rotate(-6deg)" }),
  pulse:         () => ({ opacity: 0, transform: "scale(1.06)" }),
  rubber:        () => ({ opacity: 0, transform: "scale(1.1, 0.85)" }),
};
const MOTION_FINAL: CSSProperties = {
  opacity: 1, transform: "translate(0,0) scale(1) rotate(0) skew(0) perspective(800px) rotateX(0) rotateY(0)",
  filter: "blur(0)", clipPath: "inset(0 0 0 0)",
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

function TtsPlayerHost({
  source, customText, label, voiceId, model, nodeId,
}: {
  source: string;
  customText: string;
  label: string;
  voiceId: string;
  model: string;
  nodeId: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(source === "custom" ? customText : "");

  useEffect(() => {
    if (source === "custom") {
      setText(customText);
      return;
    }
    const grab = () => {
      const el = hostRef.current;
      if (!el) return "";
      const root =
        el.closest("article") ||
        el.closest("[data-post-body]") ||
        el.closest("main") ||
        document.querySelector("article") ||
        document.querySelector("main");
      if (!root) return "";
      const clone = root.cloneNode(true) as HTMLElement;
      const selfClone = clone.querySelector(`[data-w-id="${nodeId}"]`);
      selfClone?.remove();
      clone.querySelectorAll("script,style,nav,header,footer,button,iframe").forEach((n) => n.remove());
      return (clone.textContent || "").replace(/\s+/g, " ").trim();
    };
    setText(grab());
    const id = window.setTimeout(() => setText(grab()), 250);
    return () => window.clearTimeout(id);
  }, [source, customText, nodeId]);

  return (
    <div ref={hostRef}>
      <TtsPlayer text={text} voiceId={voiceId} model={model} label={label} />
    </div>
  );
}

export function WidgetView({ node, lang, device, editable = false, onContentChange }: ViewProps) {
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
      const imgEl = srcDark && src && srcDark !== src ? (
        <picture>
          <source srcSet={srcDark} media="(prefers-color-scheme: dark)" />
          <img src={src} alt={alt} className={`max-w-full h-auto ${variantCls}`} style={imgStyle} loading="lazy" />
        </picture>
      ) : (
        <img src={src || srcDark} alt={alt} className={`max-w-full h-auto ${variantCls}`} style={imgStyle} loading="lazy" />
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

function PostListView({ c, lang, carousel = false }: { c: WidgetContent; lang: Lang; carousel?: boolean }) {
  const limit = getNum(c, "limit", 6);
  const cols = getNum(c, "columns", 3);
  const { data } = useQuery({
    queryKey: ["builder-post-list", limit],
    queryFn: async () => {
      const { data } = await supabase
        .from("posts")
        .select("id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
  });
  const cls = carousel ? "flex gap-4 overflow-x-auto pb-2 snap-x" : "grid gap-4";
  const style = carousel ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` };
  return (
    <div className={cls} style={style}>
      {(data ?? []).map((p) => (
        <a key={p.id} href={`/post/${p.slug}`} className={`bg-card border border-border rounded-lg overflow-hidden hover:border-brand transition ${carousel ? "min-w-[260px] snap-start" : ""}`}>
          {p.cover_image_url && <img src={p.cover_image_url} alt="" className="w-full h-40 object-cover" />}
          <div className="p-4">
            <h4 className="font-display text-lg mb-1 line-clamp-2">{lang === "pl" ? p.title_pl : p.title_en}</h4>
            <p className="text-sm text-muted-foreground line-clamp-2">{lang === "pl" ? p.excerpt_pl : p.excerpt_en}</p>
          </div>
        </a>
      ))}
    </div>
  );
}

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

function RatedListView({ c, lang }: { c: WidgetContent; lang: Lang }) {
  const source = getStr(c, "source") || "manual";
  const numFont = getStr(c, "numberFont") || "display";
  const numWeight = getStr(c, "numberWeight") || "700";
  const numSize = typeof c.numberSizePx === "number" ? c.numberSizePx : 48;
  const numColor = getStr(c, "numberColor") || "#000000";
  const numColorDark = getStr(c, "numberColorDark") || "#ffffff";
  const numOpacity = typeof c.numberOpacity === "number" ? c.numberOpacity : 0.05;
  const numPos = getStr(c, "numberPosition") || "behind";
  const showRating = c.showRating !== false;

  // Sub-element style settings
  const showCategory = c.showCategory === true;
  const categoryColor = getStr(c, "categoryColor") || "#dc2626";
  const categoryColorDark = getStr(c, "categoryColorDark") || "#f87171";
  const categorySize = typeof c.categorySizePx === "number" ? c.categorySizePx : 11;
  const categoryWeight = getStr(c, "categoryWeight") || "700";
  const categoryUppercase = c.categoryUppercase !== false;

  const titleColor = getStr(c, "titleColor");
  const titleColorDark = getStr(c, "titleColorDark");
  const titleHoverColor = getStr(c, "titleHoverColor");
  const titleSize = typeof c.titleSizePx === "number" ? c.titleSizePx : 18;
  const titleWeight = getStr(c, "titleWeight") || "700";
  const titleFont = getStr(c, "titleFont") || "display";

  const showAuthor = c.showAuthor !== false;
  const showDate = c.showDate === true;
  const metaColor = getStr(c, "metaColor");
  const metaColorDark = getStr(c, "metaColorDark");
  const metaSize = typeof c.metaSizePx === "number" ? c.metaSizePx : 12;

  const showExcerpt = c.showExcerpt !== false;
  const excerptColor = getStr(c, "excerptColor");
  const excerptColorDark = getStr(c, "excerptColorDark");
  const excerptSize = typeof c.excerptSizePx === "number" ? c.excerptSizePx : 13;
  const excerptLines = typeof c.excerptLines === "number" ? c.excerptLines : 3;

  const showReadMore = c.showReadMore === true;
  const readMoreText = getStr(c, `readMoreText_${lang}`) || (lang === "pl" ? "Czytaj więcej" : "Read more");
  const readMoreColor = getStr(c, "readMoreColor");
  const readMoreColorDark = getStr(c, "readMoreColorDark");

  const showBookmark = c.showBookmark === true;
  const bookmarkColor = getStr(c, "bookmarkColor");
  const bookmarkSize = typeof c.bookmarkSizePx === "number" ? c.bookmarkSizePx : 16;

  const showPostFormat = c.showPostFormat === true;
  const postFormatColor = getStr(c, "postFormatColor");

  const colorScheme = getStr(c, "colorScheme") || "auto";

  // Layout
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
    fontSize: `${numSize}px`,
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

  const schemeCls = colorScheme === "dark" ? "dark" : colorScheme === "light" ? "" : "";

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
        ${metaColor ? `.rl-wrap .rl-meta{color:${metaColor};}` : ""}
        ${metaColorDark ? `.dark .rl-wrap .rl-meta{color:${metaColorDark};}` : ""}
        ${excerptColor ? `.rl-wrap .rl-exc{color:${excerptColor};}` : ""}
        ${excerptColorDark ? `.dark .rl-wrap .rl-exc{color:${excerptColorDark};}` : ""}
        ${readMoreColor ? `.rl-wrap .rl-more{color:${readMoreColor};}` : ""}
        ${readMoreColorDark ? `.dark .rl-wrap .rl-more{color:${readMoreColorDark};}` : ""}
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
            fontSize: `${titleSize}px`,
            fontWeight: titleWeight as CSSProperties["fontWeight"],
            lineHeight: 1.3,
          };
          const titleEl = (
            <h3 className={`rl-title ${titleFontCls} cursor-pointer ${isLeft || isTop ? "" : "pr-12"}`} style={titleStyle}>{it.title}</h3>
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
                    <BookmarkIcon style={{ width: bookmarkSize, height: bookmarkSize, color: bookmarkColor || undefined }} />
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
                  {FmtIcon && <FmtIcon className="w-3.5 h-3.5" style={{ color: postFormatColor || undefined }} />}
                  {it.href ? <a href={it.href} className="block flex-1">{titleEl}</a> : <div className="flex-1">{titleEl}</div>}
                </div>
                {showExcerpt && it.excerpt && (
                  <p className="rl-exc text-muted-foreground mt-2" style={{
                    fontSize: `${excerptSize}px`,
                    display: "-webkit-box",
                    WebkitLineClamp: excerptLines,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}>{it.excerpt}</p>
                )}
                {showRating && it.rating > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <div className="flex h-2 w-24 overflow-hidden rounded-full">
                      {[0,1,2,3,4].map((k) => (
                        <div key={k} className="flex-1" style={{ backgroundColor: ["#ef4444","#f97316","#facc15","#a3e635","#22c55e"][k] }} />
                      ))}
                    </div>
                    <span className="text-xs font-semibold">{it.rating}</span>
                  </div>
                )}
                {(showAuthor && it.author) || (showDate && it.date) ? (
                  <p className="rl-meta mt-2 text-muted-foreground" style={{ fontSize: `${metaSize}px` }}>
                    {showAuthor && it.author && <>— <span className="font-semibold text-foreground/80">{it.author}</span></>}
                    {showAuthor && it.author && showDate && it.date && " · "}
                    {showDate && it.date && <span>{new Date(it.date).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-US")}</span>}
                  </p>
                ) : null}
                {showReadMore && it.href && (
                  <a href={it.href} className="rl-more inline-block mt-2 text-xs font-semibold hover:underline">{readMoreText} →</a>
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


function CategoriesView({ lang }: { lang: Lang }) {
  const { data } = useQuery({
    queryKey: ["builder-cats"],
    queryFn: async () => (await supabase.from("categories").select("id, slug, name_pl, name_en")).data ?? [],
  });
  return <div className="flex flex-wrap gap-2">{(data ?? []).map((c) => (
    <span key={c.id} className="px-3 py-1 rounded-full border border-border text-sm">{lang === "pl" ? c.name_pl : c.name_en}</span>
  ))}</div>;
}

function TagsView() {
  const { data } = useQuery({
    queryKey: ["builder-tags"],
    queryFn: async () => (await supabase.from("tags").select("id, slug, name")).data ?? [],
  });
  return <div className="flex flex-wrap gap-1.5">{(data ?? []).map((t) => (
    <span key={t.id} className="px-2 py-0.5 rounded bg-muted text-xs">#{t.name}</span>
  ))}</div>;
}

function TabsBlock({ tabs, lang, nodeId }: { tabs: Array<Record<string, string>>; lang: Lang; nodeId: string }) {
  const [active, setActive] = useState(0);
  if (!tabs.length) return <div className="text-xs text-muted-foreground">Brak zakładek</div>;
  const safe = Math.min(active, tabs.length - 1);
  const cur = tabs[safe];
  return (
    <div role="tablist" aria-label="Tabs" className="space-y-3">
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {tabs.map((t, i) => (
          <button
            key={`${nodeId}-${i}`}
            role="tab"
            aria-selected={i === safe}
            type="button"
            onClick={() => setActive(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              i === safe ? "border-brand text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t[`label_${lang}`] || t.label_pl}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="prose prose-sm max-w-none dark:prose-invert"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(cur[`html_${lang}`] || cur.html_pl || "") }} />
    </div>
  );
}
