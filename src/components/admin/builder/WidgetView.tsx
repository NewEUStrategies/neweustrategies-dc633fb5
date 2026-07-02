// Renders a widget (read-only by default; opt-in inline editing in the builder
// canvas via `editable` + `onContentChange`). Used in the live preview inside
// the builder canvas and on public pages. All user-authored strings (custom
// CSS, ids, classes, html, urls) go through src/lib/sanitize.ts.
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { WidgetNode, WidgetContent, CommonStyle, AdvancedSettings, Device, WidgetTypography } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import {
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  safeImageUrl,
} from "@/lib/sanitize";
import { useInView } from "@/hooks/use-in-view";
import { hoverCss } from "@/lib/builder/hoverCss";
import { subscribeWidgetTypography } from "@/lib/builder/liveTypography";
import { buildWidgetTypographyCss, normalizeTypographyGapPx, resolveWidgetTypography } from "@/lib/builder/typographyCss";
import { resolveColorForMode } from "@/lib/builder/autoInvertColor";
import { mergeGlobalIntoInstance, useGlobalWidgetNode } from "@/lib/builder/globalWidgets";
import { useTheme } from "@/components/ThemeProvider";
import { useBuilderMode } from "@/lib/builder/modeContext";
// Heavy, non-critical widgets are code-split via lazyWidgets so they never
// weigh down the shared Header/Footer bundle on pages that don't render them.
// SSR streaming still renders them server-side, so the HTML is unchanged.
import {
  NewsletterForm as NewsletterFormLive,
  JoinUsForm,
  InterestsCustomizer,
  TtsPlayerHost,
  PodcastLatestView,
  WebStoriesCarouselView,
  NewsTickerView,
  RatedListView,
  TabsBlock,
  AdSlotById,
  RichTextView,
} from "./ui/organisms/widget-view/lazyWidgets";
import {
  SectionLabelRender,
  resolveAccentColor,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";
import { SliderRender, type SliderVariant } from "@/lib/builder/sliderVariants";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { AppLink } from "@/components/atoms/AppLink";
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
  COMPACT_WIDGET_MIN_HEIGHT, COMPACT_WIDGET_TYPES,
  getStr, getNum, getStrArr, normalizeNewsletterVariant,
} from "./ui/organisms/widget-view/frame";
import { MOTION_INITIAL, MOTION_FINAL } from "./ui/organisms/widget-view/motion";
import { Editable } from "./ui/molecules/Editable";
// Eager: layout-critical / above-the-fold / navigation widgets.
import { PostListView } from "./ui/organisms/widget-view/PostListView";
import { MegaMenu, type MegaMenuConfig } from "@/components/megaMenu/MegaMenu";
import { CategoriesView } from "./ui/organisms/widget-view/CategoriesView";
import { TagsView } from "./ui/organisms/widget-view/TagsView";
import { renderSimpleWidget, ResizableBox } from "./ui/organisms/widget-view/SimpleWidgets";
import { RichHtmlView } from "./ui/organisms/widget-view/RichHtmlView";
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

export const WidgetView = memo(function WidgetView({ node: instanceNode, lang, device, editable = false, onContentChange }: ViewProps) {
  // Global-widget instances render the LIVE record (synchronized across pages);
  // the embedded snapshot is only the SSR / first-paint fallback. The hook is a
  // no-op (disabled query) for regular widgets, so hook order stays stable.
  const globalData = useGlobalWidgetNode(instanceNode.globalId);
  const node = instanceNode.globalId && globalData
    ? mergeGlobalIntoInstance(instanceNode, globalData)
    : instanceNode;
  const { theme } = useTheme();
  const builderMode = useBuilderMode();
  const effectiveMode = builderMode ?? theme;
  const [liveTypography, setLiveTypography] = useState<WidgetTypography | undefined>(undefined);
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

  useEffect(() => subscribeWidgetTypography(node.id, setLiveTypography), [node.id]);

  // Widget-level color overrides win over any global/utility class colors
  // (text-foreground, text-muted-foreground, prose, etc.). When the user sets
  // a color on a widget, force descendants to inherit it.
  const widgetTextColor = resolveColorForMode(node.style?.textColor, effectiveMode);
  const widgetBgColor = resolveColorForMode(node.style?.bgColor, effectiveMode);
  const iconDefault = resolveColorForMode(node.style?.iconColor, effectiveMode);
  const iconHover = resolveColorForMode(node.style?.iconHoverColor, effectiveMode);
  const iconActive = resolveColorForMode(node.style?.iconActiveColor, effectiveMode);
  const overrideCss = (() => {
    const sel = `[data-w-id="${node.id}"]`;
    const rules: string[] = [];
    if (widgetTextColor) {
      rules.push(`${sel}, ${sel} *:not(svg):not(path):not([data-keep-color]) { color: ${widgetTextColor} !important; }`);
      rules.push(`${sel} svg:not([data-keep-color]) { color: ${widgetTextColor}; }`);
    }
    if (widgetBgColor) {
      rules.push(`${sel} { background: ${widgetBgColor} !important; }`);
    }
    // Icon states: SVG + .cms-icon nodes. Force color + fill via currentColor
    // so stroked and filled glyphs both react.
    const iconSel = `${sel} :is(svg,.cms-icon):not([data-keep-color])`;
    if (iconDefault) {
      rules.push(`${iconSel}{color:${iconDefault} !important;}`);
      rules.push(`${iconSel} *{fill:currentColor;stroke:currentColor;}`);
    }
    if (iconHover) {
      // Trigger on the closest interactive ancestor (a, button, [role=button])
      // or directly on the icon container.
      rules.push(`${sel} :is(a,button,[role="button"]):hover :is(svg,.cms-icon):not([data-keep-color]){color:${iconHover} !important;}`);
      rules.push(`${sel} :is(svg,.cms-icon):not([data-keep-color]):hover{color:${iconHover} !important;}`);
    }
    if (iconActive) {
      // Current page / active state - honour aria-current, .is-active, [data-active].
      rules.push(`${sel} :is(a,button)[aria-current="page"] :is(svg,.cms-icon):not([data-keep-color]),
${sel} :is(a,button).is-active :is(svg,.cms-icon):not([data-keep-color]),
${sel} :is(a,button)[data-active="true"] :is(svg,.cms-icon):not([data-keep-color]),
${sel} :is(a,button):active :is(svg,.cms-icon):not([data-keep-color]){color:${iconActive} !important;}`);
    }
    return rules.join("\n");
  })();
  const activeTypography = useMemo(
    () => resolveWidgetTypography(node.style?.typography, effectiveMode, liveTypography),
    [effectiveMode, liveTypography, node.style?.typography],
  );
  const activeGapPx = normalizeTypographyGapPx(activeTypography?.titleDescriptionGapPx);
  const typographyCss = useMemo(() => {
    return buildWidgetTypographyCss(node.id, activeTypography, device, { specificity: 3 });
  }, [activeTypography, device, node.id]);

  const isImage = node.type === "image";
  const isMedia = isImage || node.type === "slider" || node.type === "video" || node.type === "gallery" || node.type === "map";
  const isCompactWidget = COMPACT_WIDGET_TYPES.has(node.type);
  // Coalesce every per-widget CSS source (hover, typography, color override,
  // user custom CSS) into a SINGLE <style> node instead of up to four. All four
  // are already scoped to `[data-w-id="<id>"]`, so concatenation is order-safe
  // and shrinks the per-widget DOM/style-node count on widget-heavy pages.
  const widgetCss = [hover, typographyCss, overrideCss, scopedCss].filter(Boolean).join("\n");
  const wrap = (children: React.ReactNode) => (
    <div
      id={htmlId}
      data-w-id={node.id}
      data-typography-gap-active={typeof activeGapPx === "number" ? "1" : undefined}
      ref={motion ? motionRef : undefined}
      className={`text-foreground ${cls}`.trim()}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isCompactWidget ? "center" : "flex-start", width: "100%", minWidth: 0, height: isMedia ? "auto" : "100%", maxWidth: isImage ? "none" : "100%", boxSizing: "border-box", overflow: isImage ? "visible" : (isMedia ? "visible" : "hidden"), ...(typeof activeGapPx === "number" ? { "--cms-title-description-gap": `${activeGapPx}px` } as CSSProperties : {}), ...baseStyle, marginTop: 0, marginBottom: 0, ...motionStyle }}
    >
      {children}
      {widgetCss && <style dangerouslySetInnerHTML={{ __html: widgetCss }} />}
    </div>
  );

  const c = node.content;
  const canEdit = editable && !!onContentChange;
  const commit = (k: string, v: string) => onContentChange?.(k, v);
  const compactRowStyle: CSSProperties = {
    boxSizing: "border-box",
  };

  // Read-only widgets without inline editing - short-circuit via dispatcher.
  const simple = renderSimpleWidget(node, lang, effectiveMode, editable, onContentChange, activeTypography);
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
      const titleWeight = getStr(c, "titleWeight");
      const subtitleSizePx = getNum(c, "subtitleSizePx", 0);
      const subtitleWeight = getStr(c, "subtitleWeight");
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
      const headStyle: React.CSSProperties = {
        ...(usePx ? { fontSize: `${sizePx}px`, lineHeight: 1.1 } : {}),
        ...(titleWeight ? { fontWeight: titleWeight as React.CSSProperties["fontWeight"] } : {}),
      };
      const finalStyle = Object.keys(headStyle).length ? headStyle : undefined;
      const finalCls = headCls;
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
      const subtitleStyle: React.CSSProperties = {
        ...(subtitleSizePx > 0 ? { fontSize: `${subtitleSizePx}px`, lineHeight: 1.35 } : {}),
        ...(subtitleWeight ? { fontWeight: subtitleWeight as React.CSSProperties["fontWeight"] } : {}),
      };
      const block = (
        <div className="space-y-1">
          {href ? <AppLink href={href} target={target} rel={target === "_blank" ? "noopener noreferrer" : undefined} className="hover:opacity-80 transition">{titleRow}</AppLink> : titleRow}
          {subtitle && (
            <p
              className={`text-sm text-muted-foreground${subtitleSizePx > 0 ? "" : ""}`}
              style={Object.keys(subtitleStyle).length ? subtitleStyle : undefined}
            >
              {subtitle}
            </p>
          )}
        </div>
      );
      return wrap(block);
    }
    case "text": {
      const key = `html_${lang}`;
      const html = getStr(c, key) || getStr(c, "html_pl");
      const cols = getNum(c, "columns", 1);
      const dropCap = getStr(c, "dropCap") === "on";
      const proseCls = `prose prose-sm max-w-none [&_*]:text-inherit ${dropCap ? "first-letter:float-left first-letter:text-5xl first-letter:font-display first-letter:mr-2 first-letter:leading-none" : ""}`;
      const colStyle = cols > 1 ? { columnCount: cols, columnGap: "1.5rem" } as CSSProperties : undefined;
      const singleColumnCompactStyle = cols <= 1
        ? { ...compactRowStyle, display: "flex", alignItems: "center", width: "100%" } satisfies CSSProperties
        : undefined;
      if (canEdit) {
        return wrap(<Editable as="div" html multiline value={html} onCommit={(v) => commit(key, v)} className={proseCls} style={singleColumnCompactStyle} placeholder="Wpisz tekst…" />);
      }
      // RichHtmlView sanitizes + injects the HTML and re-mounts footnote tooltips
      // for migrated content whose footnote refs/list are baked into the markup.
      return wrap(<RichHtmlView html={html} className={proseCls} style={{ ...colStyle, ...singleColumnCompactStyle }} />);
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
        : <AppLink href={href} target={target} rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined} className={cls}>{Icon && <Icon size={14} />}{label}</AppLink>;
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
        <AppLink
          href={href}
          target={target}
          rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined}
          className={cls}
        >
          {Cmp ? <Cmp size={14} /> : null}
          {label}
        </AppLink>,
      );
    }
    case "mega-menu": {
      return wrap(
        <MegaMenu
          config={c as unknown as MegaMenuConfig}
          lang={lang}
          mobile={device === "mobile"}
        />,
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
    case "post-list": {
      return wrap(<PostListView c={c} lang={lang} typography={activeTypography ?? undefined} />);
    }
    case "carousel": {
      return wrap(<PostListView c={c} lang={lang} carousel typography={activeTypography ?? undefined} />);
    }
    case "news-ticker":
      return wrap(<NewsTickerView c={c} lang={lang} />);
    case "podcast-latest":
      return wrap(<PodcastLatestView c={c} lang={lang} />);
    case "web-stories-carousel":
      return wrap(<WebStoriesCarouselView c={c} lang={lang} />);
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
          <div className="inline-flex items-center justify-center rounded-full text-foreground hover:opacity-80 transition-colors cursor-pointer" style={compactRowStyle} title={title} aria-label={title}>
            {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          </div>,
        );
      }
      return wrap(
        <div style={compactRowStyle} className="inline-flex items-center gap-2 text-foreground hover:opacity-80 transition-colors cursor-pointer" title={title}>
          {IconCmp ? <IconCmp className="w-5 h-5" /> : <span>✉</span>}
          <span className="text-sm font-medium">{title}</span>
        </div>,
      );
    }

    case "join-us": {
      const variant = (getStr(c, "variant") || "split") as "card" | "split" | "inline";
      const showInterests = (getStr(c, "showInterests") ?? "1") !== "0";
      const title = getStr(c, `title_${lang}`) || getStr(c, "title_pl") || undefined;
      const subtitle = getStr(c, `subtitle_${lang}`) || getStr(c, "subtitle_pl") || undefined;
      return wrap(
        <JoinUsForm
          variant={variant}
          showInterests={showInterests}
          title={title || undefined}
          subtitle={subtitle || undefined}
          source={`widget:${node.id}`}
        />,
      );
    }

    case "customize-interests": {
      const variant = (getStr(c, "variant") || "full") as "full" | "compact";
      const showHeader = (getStr(c, "showHeader") ?? "1") !== "0";
      return wrap(<InterestsCustomizer variant={variant} showHeader={showHeader} />);
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
        : <AppLink href={href} className={`${ctaBtnCls} hover:opacity-90 transition`}>{cta}</AppLink>;
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
      const cardBg = resolveColorForMode(node.style?.bgColor, effectiveMode) ?? "oklch(0.18 0.02 260)";
      const cardText = resolveColorForMode(node.style?.textColor, effectiveMode) ?? "#ffffff";
      const cardBorder = resolveColorForMode(node.style?.borderColor, effectiveMode);
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
      const badgeBg = getStr(c, "badgeBg");
      const badgeText = getStr(c, "badgeText");
      const badgeStyle: CSSProperties = {};
      if (badgeBg) { badgeStyle.background = badgeBg; badgeStyle.borderColor = badgeBg; }
      if (badgeText) badgeStyle.color = badgeText;
      const imageHover = getStr(c, "imageHover") || "zoom-in";
      // Keep dynamic-feature-card imagery consistent with other widgets:
      // fixed frame, responsive source candidates, and full-image contain fit.
      const imgAnimCls =
        imageHover === "zoom-in"
          ? "inset-0 transition-transform duration-500 ease-out group-hover/dfcimg:scale-105"
        : imageHover === "zoom-out"
          ? "inset-0 scale-105 transition-transform duration-500 ease-out group-hover/dfcimg:scale-100"
        : imageHover === "fade"
          ? "inset-0 transition-[filter,opacity] duration-500 ease-out group-hover/dfcimg:brightness-75"
        : imageHover === "brighten"
          ? "inset-0 brightness-90 transition-[filter] duration-500 ease-out group-hover/dfcimg:brightness-110"
        : imageHover === "tilt"
          ? "inset-0 transition-transform duration-500 ease-out origin-center group-hover/dfcimg:rotate-1"
        : "inset-0";
      const card = (
        <div
          className="relative p-6 rounded"
          style={{
            background: cardBg,
            color: cardText,
            borderColor: cardBorder,
            borderStyle: cardBorder ? "solid" : undefined,
            borderWidth: cardBorder ? "1px" : undefined,
          }}
        >
          {(badge || canEdit) && (
            canEdit
              ? <Editable as="div" value={badge} onCommit={(v) => commit(badgeKey, v)} className={badgeCls} style={badgeStyle} placeholder="Etykieta…" />
              : <div className={badgeCls} style={badgeStyle}>{badge}</div>
          )}
          {img && (
            <div data-widget-media className="group/dfcimg relative w-full overflow-hidden rounded bg-black/20" style={{ aspectRatio: "16 / 9" }}>
              <OptimizedImage src={img} alt="" responsive sizes="(max-width: 767px) 100vw, 50vw" className={`absolute block h-full w-full object-contain ${imgAnimCls}`} />
            </div>
          )}
          <h3 className="mt-4 font-display text-2xl font-bold">{title}</h3>
          {excerpt && <p className="mt-2 text-sm opacity-70">{excerpt}</p>}
        </div>
      );
      return wrap(href ? <AppLink href={href} className="block hover:opacity-95 transition">{card}</AppLink> : card);
    }
    case "ad-slot": {
      const slotId = getStr(c, "slotId");
      return wrap(<AdSlotById slotId={slotId} />);
    }
    case "rich-text":
      // Embeds the blocks engine: the builder hosts full article-style content.
      return wrap(<RichTextView content={c} lang={lang} />);
    default:
      return null;
  }
});

WidgetView.displayName = "WidgetView";

