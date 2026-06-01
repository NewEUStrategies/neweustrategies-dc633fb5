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
import { useBuilderMode } from "@/lib/builder/modeContext";
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
  COMPACT_WIDGET_MIN_HEIGHT,
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
import { renderSimpleWidget, ResizableBox } from "./ui/organisms/widget-view/SimpleWidgets";
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
  /** Commit a single content field. Called on blur / Enter / resize end. */
  onContentChange?: (key: string, value: string | number) => void;
}

export function WidgetView({ node, lang, device, editable = false, onContentChange }: ViewProps) {
  const { theme } = useTheme();
  const builderMode = useBuilderMode();
  const effectiveMode = builderMode ?? theme;
  const baseStyle = styleToCSS(node.style, device, effectiveMode);
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

  const isImage = node.type === "image";
  const wrap = (children: React.ReactNode) => (
    <div
      id={htmlId}
      data-w-id={node.id}
      ref={motion ? motionRef : undefined}
      className={`text-foreground ${cls}`.trim()}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", width: "100%", minWidth: 0, height: "100%", maxWidth: isImage ? "none" : "100%", boxSizing: "border-box", overflow: isImage ? "visible" : "hidden", ...baseStyle, ...motionStyle }}
    >
      {children}
      {hover && <style dangerouslySetInnerHTML={{ __html: hover }} />}
      {scopedCss && <style dangerouslySetInnerHTML={{ __html: scopedCss }} />}
    </div>
  );

  const c = node.content;
  const canEdit = editable && !!onContentChange;
  const commit = (k: string, v: string) => onContentChange?.(k, v);
  const compactRowStyle: CSSProperties = {
    boxSizing: "border-box",
  };

  // Read-only widgets without inline editing — short-circuit via dispatcher.
  const simple = renderSimpleWidget(node, lang, effectiveMode, editable, onContentChange);
  if (simple !== undefined) return wrap(simple);

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
      const singleColumnCompactStyle = cols <= 1
        ? { ...compactRowStyle, display: "flex", alignItems: "center", width: "100%" } satisfies CSSProperties
        : undefined;
      if (canEdit) {
        return wrap(<Editable as="div" html multiline value={html} onCommit={(v) => commit(key, v)} className={proseCls} style={singleColumnCompactStyle} placeholder="Wpisz tekst…" />);
      }
      return wrap(<div className={proseCls} style={{ ...colStyle, ...singleColumnCompactStyle }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />);
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
      const widthPx = getNum(c, "widthPx", 0);
      const heightPx = getNum(c, "heightPx", 0);
      const variantCls =
        variant === "outline" ? "border border-border hover:bg-muted"
        : variant === "ghost" ? "hover:bg-muted"
        : variant === "gradient" ? "bg-gradient-to-r from-brand to-foreground text-brand-foreground hover:opacity-90"
        : variant === "soft" ? "bg-brand/10 text-brand hover:bg-brand/20"
        : variant === "link" ? "underline-offset-4 hover:underline text-brand px-0"
        : "bg-brand text-brand-foreground hover:opacity-90";
      // Default ("md") matches the search-widget closed pill height.
      const sizeCls = size === "sm" ? "px-3 py-1.5 text-xs" : size === "lg" ? "px-7 py-3 text-base" : "px-3.5 py-2 text-xs";
      const cls = `inline-flex items-center justify-center gap-2 rounded-md font-medium leading-none transition w-full h-full ${sizeCls} ${variantCls} ${fullWidth ? "justify-center" : ""} ${iconPos === "right" ? "flex-row-reverse" : ""}`;
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Icon = iconName ? (reg[iconName] ?? null) : null;
      const inner = canEdit
        ? <span className={cls}>{Icon && <Icon size={14} />}<Editable as="span" value={label} onCommit={(v) => commit(key, v)} placeholder="Etykieta…" /></span>
        : <a href={href} target={target} rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined} className={cls}>{Icon && <Icon size={14} />}{label}</a>;
      return wrap(
        <ResizableBox
          enabled={canEdit}
          widthPx={widthPx > 0 ? widthPx : undefined}
          heightPx={heightPx > 0 ? heightPx : undefined}
          onCommit={(w, h) => { onContentChange?.("widthPx", w); onContentChange?.("heightPx", h); }}
        >
          {inner}
        </ResizableBox>,
      );
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
        : "inline-flex items-center gap-1.5 text-foreground hover:opacity-80";
      const cls = `h-10 text-xs font-bold tracking-wider leading-none transition ${variantCls}`;
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
          return wrap(<span style={compactRowStyle} className="inline-flex items-center text-sm font-medium leading-none border-b border-dashed border-foreground/30 hover:border-brand transition cursor-pointer">{title}</span>);
        }
        if (variant === "icon-only") {
          return wrap(
            <a href="#newsletter" className="inline-flex items-center justify-center rounded-full text-foreground hover:opacity-80 transition-colors" style={compactRowStyle} title={title} aria-label={title}>
              {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
            </a>,
          );
        }
        if (variant === "icon") {
          return wrap(
            <a href="#newsletter" style={compactRowStyle} className="inline-flex items-center gap-2 text-foreground hover:opacity-80 transition-colors" title={title}>
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
        return wrap(<span style={compactRowStyle} className="inline-flex items-center text-sm font-medium leading-none border-b border-dashed border-foreground/30 hover:border-brand transition cursor-pointer">{title}</span>);
      }
      if (variant === "icon-only") {
        return wrap(
          <div className="inline-flex items-center justify-center rounded-full text-foreground/80 hover:text-brand hover:bg-foreground/5 transition-colors cursor-pointer" style={compactRowStyle} title={title} aria-label={title}>
            {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          </div>,
        );
      }
      return wrap(
        <div style={compactRowStyle} className="inline-flex items-center gap-2 text-foreground/80 hover:text-brand transition-colors cursor-pointer" title={title}>
          {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          <span className="text-sm font-medium">{title}</span>
        </div>,
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
      const ctaWidthPx = getNum(c, "ctaWidthPx", 0);
      const ctaHeightPx = getNum(c, "ctaHeightPx", 0);
      const ctaBtnCls = "inline-flex items-center justify-center w-full h-full bg-brand-foreground text-brand px-3.5 py-2 rounded font-medium text-xs leading-none";
      const ctaInner = canEdit
        ? <Editable as="span" value={cta} onCommit={(v) => commit(cKey, v)} className={ctaBtnCls} placeholder="Etykieta…" />
        : <a href={href} className={`${ctaBtnCls} hover:opacity-90 transition`}>{cta}</a>;
      const ctaBtn = (
        <ResizableBox
          enabled={canEdit}
          widthPx={ctaWidthPx > 0 ? ctaWidthPx : undefined}
          heightPx={ctaHeightPx > 0 ? ctaHeightPx : undefined}
          onCommit={(w, h) => { onContentChange?.("ctaWidthPx", w); onContentChange?.("ctaHeightPx", h); }}
        >
          {ctaInner}
        </ResizableBox>
      );
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
    case "tabs": {
      const tabs = Array.isArray(c.tabs) ? c.tabs as Array<Record<string, string>> : [];
      return wrap(<TabsBlock tabs={tabs} lang={lang} nodeId={node.id} />);
    }
    case "rated-list":
      return wrap(<RatedListView c={c} lang={lang} mode={effectiveMode} />);


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

