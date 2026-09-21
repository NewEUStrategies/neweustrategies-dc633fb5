// DYSPOZYTOR CHROME: nagłówek i stopka renderują z niego KAŻDĄ stronę.
//
// DLACZEGO ISTNIEJE (audyt CWV, F17)
// `Header`/`Footer` -> `BuilderRenderer` -> `BuilderWidgetNode` -> `WidgetView`
// ciągnęły do chunku wejściowego komplet gałęzi buildera, w tym widgety, które
// w chrome nie wystąpią nigdy (newsletter treściowy, listy wpisów, karty
// wydarzeń, wykresy...). Ten moduł zawiera wyłącznie to, czego chrome naprawdę
// używa; wszystko inne dojeżdża leniwym `WidgetView`.
//
// KIERUNEK ZALEŻNOŚCI JEST CELOWY
// To jest JĄDRO renderu widgetu (ramka + typy chrome), a `WidgetView` jest jego
// ROZSZERZENIEM o widgety treściowe - dlatego `WidgetView` importuje stąd
// `useWidgetFrame` i `renderChromeWidget`, a nie odwrotnie. Gdyby ramka została
// w `WidgetView`, każdy import chrome wciągałby z powrotem cały dyspozytor i
// cała zmiana nie miałaby sensu. W drugą stronę biegnie WYŁĄCZNIE `import()`
// dynamiczny (fallback dla nieznanego typu), który bundler tnie na chunk.
//
// PARYTET HTML
// Ramka i gałęzie typów są tu FIZYCZNIE tym samym kodem, którego używa
// `WidgetView` - nie kopią. Dzięki temu SSR chrome jest bajt w bajt taki sam
// niezależnie od wybranego dyspozytora (zero CLS), co przypina test
// `__tests__/chromeWidgetViewParity.test.tsx`.
import { lazy, memo, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { WidgetNode, Device, WidgetTypography } from "@/lib/builder/types";
import * as LucideIcons from "@/lib/lucide-shim";
import { DynamicIcon } from "@/lib/icons/DynamicIcon";
import {
  sanitizeHtmlId,
  sanitizeCssClass,
  scopeCustomCss,
  safeUrl,
  hardenStyleCss,
} from "@/lib/sanitizePure";
import { useInView } from "@/hooks/use-in-view";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { hoverCss } from "@/lib/builder/hoverCss";
import { subscribeWidgetTypography } from "@/lib/builder/liveTypography";
import {
  buildWidgetTypographyCss,
  normalizeTypographyGapPx,
  resolveWidgetTypography,
} from "@/lib/builder/typographyCss";
import { resolveColorForMode } from "@/lib/builder/autoInvertColor";
import { useAboveFold } from "@/lib/builder/aboveFold";
import { resolveGlobalWidgetInstance, useGlobalWidgetNode } from "@/lib/builder/globalWidgets";
import { processWidgetFootnotes } from "@/lib/footnotes";
import { useTheme } from "@/components/ThemeProvider";
import { useBuilderMode } from "@/lib/content-model/editorCanvas";
import { AppLink } from "@/components/atoms/AppLink";
import { asOneOf, asStr, pickI18n } from "@/lib/content-model/contentValue";
import {
  styleToCSS,
  getWidgetFrameStyle,
  hiddenOnDevice,
  COMPACT_WIDGET_TYPES,
  getStr,
  getNum,
  normalizeNewsletterVariant,
} from "./widget-view/frame";
import { MOTION_INITIAL, MOTION_FINAL } from "./widget-view/motion";
import {
  Editable,
  NewsletterForm as NewsletterFormLive,
  RichHtmlView,
} from "./widget-view/lazyWidgets";
import { MegaMenu, type MegaMenuConfig } from "@/components/megaMenu/MegaMenu";
import { SiteMenu } from "@/components/menu/SiteMenu";
import { renderSimpleWidget, ResizableBox } from "./widget-view/SimpleWidgets";
import {
  SocialMailIcon,
  socialGlyphBoxStyle,
  SOCIAL_GLYPH_TILE_CLASS,
} from "./widget-view/socialGlyphs";

export { getWidgetFrameStyle, hiddenOnDevice };

type Lang = "pl" | "en";

export interface WidgetViewProps {
  node: WidgetNode;
  lang: Lang;
  device: Device;
  /** When true, click-to-edit text fields are enabled in canvas. */
  editable?: boolean;
  /** Commit a single content field. Called on blur / Enter / resize end. */
  onContentChange?: (key: string, value: string | number) => void;
}

/**
 * Props formularza newslettera rozszerzone o `previewMode`.
 *
 * HANDOFF (src/components/NewsletterForm.tsx): `previewMode?: boolean` ma
 * zablokować wysyłkę (`onSubmit` kończy się na `preventDefault()`), zostawiając
 * pełny render pól. Do czasu scalenia tamtej zmiany kanwa blokuje wysyłkę
 * lokalnie - przechwyceniem zdarzenia `submit` w fazie capture na hoście
 * `[data-newsletter-preview]`. Prop przekazujemy już teraz, bo jest opcjonalny,
 * więc typuje się i przed, i po scaleniu.
 */
type NewsletterLiveProps = React.ComponentProps<typeof NewsletterFormLive> & {
  previewMode?: boolean;
};
const NewsletterFormPreviewable: React.ComponentType<NewsletterLiveProps> = NewsletterFormLive;

/**
 * Konfiguracja przekazywana do `NewsletterForm`.
 *
 * Panel newslettera ma DWA pola opisujące tę samą rzecz: `placeholder`
 * ("Placeholder pola email", stare) oraz `emailPlaceholder` ("Placeholder:
 * E-mail", z bloku pól). Formularz czyta wyłącznie to drugie, więc pierwsze
 * działało tylko w atrapie buildera. Mapujemy je jako fallback, dzięki czemu
 * ustawienie działa po obu stronach bez migracji dokumentów.
 */
function newsletterFormConfig(content: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...content };
  for (const lg of ["pl", "en"] as const) {
    const explicit = asStr(cfg[`emailPlaceholder_${lg}`]).trim();
    const legacy = asStr(cfg[`placeholder_${lg}`]).trim();
    if (!explicit && legacy) cfg[`emailPlaceholder_${lg}`] = legacy;
  }
  return cfg;
}

const EASING_MAP: Record<string, string> = {
  ease: "ease",
  "ease-in": "ease-in",
  "ease-out": "ease-out",
  "ease-in-out": "ease-in-out",
  linear: "linear",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  bounce: "cubic-bezier(0.68, -0.55, 0.27, 1.55)",
};

/**
 * Wspólna RAMKA widgetu: identyfikatory, style, animacje wejścia, arkusz
 * instancji i funkcja `wrap()`, która opakowuje treść widgetu. Jeden hook,
 * wołany jako PIERWSZY w obu dyspozytorach - dzięki temu kolejność hooków jest
 * identyczna niezależnie od tego, który z nich renderuje dany widget.
 */
export function useWidgetFrame({
  node: instanceNode,
  lang,
  device,
  editable = false,
  onContentChange,
}: WidgetViewProps) {
  // Global-widget instances render the LIVE record (synchronized across pages);
  // the embedded snapshot is only the SSR / first-paint fallback. The hook is a
  // no-op (disabled query) for regular widgets, so hook order stays stable.
  const globalData = useGlobalWidgetNode(instanceNode.globalId);
  // Inside the builder the document snapshot contains the optimistic edit and
  // must win immediately. Otherwise a still-stale global query overwrites the
  // new value for one render (or indefinitely if sync is delayed), making the
  // property control change while the canvas appears frozen. Read-only/public
  // rendering still prefers the live global record.
  const overlaid = resolveGlobalWidgetInstance(instanceNode, globalData, editable);
  // Overlay stomps the pre-processed snapshot with the raw live record, więc
  // [fn]…[/fn] w globalnym widgecie znika po hydratacji jeśli tu nie
  // przepuścimy tego przez ten sam silnik przypisów, którego używa
  // prepareContentForRender. Numeracja jest per-widget (globalne widgety są
  // reużywalne między stronami, więc nie mogą uczestniczyć w licznikach
  // dokumentowych) - marker + tooltip w atrybucie title wystarczy do UX.
  const node = useMemo(
    () =>
      instanceNode.globalId && globalData && !editable
        ? processWidgetFootnotes(overlaid, lang).widget
        : overlaid,
    [overlaid, instanceNode.globalId, globalData, editable, lang],
  );
  const { theme } = useTheme();
  const builderMode = useBuilderMode();
  const effectiveMode = builderMode ?? theme;
  // Sekcja nad zgięciem: pierwszy obraz widgetu jest kandydatem LCP
  // (eager + fetchpriority=high) - czytane w gałęziach z obrazami niżej.
  const aboveFold = useAboveFold();
  const [liveTypography, setLiveTypography] = useState<WidgetTypography | undefined>(undefined);
  const baseStyle = styleToCSS(node.style, device, effectiveMode);
  const cls = sanitizeCssClass(node.advanced?.cssClass) ?? "";
  const htmlId = sanitizeHtmlId(node.advanced?.htmlId);
  // prefers-reduced-motion disables enter animations entirely (final state
  // renders immediately). The hook returns false during SSR + first client
  // render, so hydration stays byte-identical and the flip happens one commit
  // after mount - before the IntersectionObserver would have fired anyway.
  const reducedMotion = usePrefersReducedMotion();
  const motion =
    !reducedMotion && node.advanced?.animation && node.advanced.animation !== "none"
      ? node.advanced.animation
      : undefined;

  const { ref: motionRef, inView } = useInView<HTMLDivElement>({
    enabled: !!motion,
    once: node.advanced?.animationOnce !== false,
  });

  const dur = node.advanced?.animationDuration ?? 600;
  const delay = node.advanced?.animationDelay ?? 0;
  const dist = node.advanced?.animationDistance ?? 24;
  const ease = EASING_MAP[node.advanced?.animationEasing ?? "ease-out"] ?? "ease-out";
  const motionStyle: CSSProperties = motion
    ? (() => {
        // Narrow transition/will-change to the properties this preset actually
        // animates - a plain fade must not force filter/clip-path compositing
        // layers on every widget, and will-change is released once revealed.
        const initial = MOTION_INITIAL[motion]?.(dist) ?? {};
        const props = ["opacity"];
        if ("transform" in initial) props.push("transform");
        if ("filter" in initial) props.push("filter");
        if ("clipPath" in initial) props.push("clip-path");
        return {
          ...(inView ? MOTION_FINAL : initial),
          transition: props.map((p) => `${p} ${dur}ms ${ease} ${delay}ms`).join(", "),
          willChange: inView ? undefined : props.join(", "),
        };
      })()
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
      rules.push(
        `${sel}, ${sel} *:not(svg):not(path):not([data-keep-color]) { color: ${widgetTextColor} !important; }`,
      );
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
      rules.push(
        `${sel} :is(a,button,[role="button"]):hover :is(svg,.cms-icon):not([data-keep-color]){color:${iconHover} !important;}`,
      );
      rules.push(
        `${sel} :is(svg,.cms-icon):not([data-keep-color]):hover{color:${iconHover} !important;}`,
      );
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
  const isMedia =
    isImage ||
    node.type === "slider" ||
    node.type === "video" ||
    node.type === "gallery" ||
    node.type === "map";
  const resolvedFrameHeight = getWidgetFrameStyle(node, device).height;
  const fillsExplicitFrameHeight =
    resolvedFrameHeight !== undefined && resolvedFrameHeight !== "auto";
  const isCompactWidget = COMPACT_WIDGET_TYPES.has(node.type);
  // Coalesce every per-widget CSS source (hover, typography, color override,
  // user custom CSS) into a SINGLE <style> node instead of up to four. All four
  // are already scoped to `[data-w-id="<id>"]`, so concatenation is order-safe
  // and shrinks the per-widget DOM/style-node count on widget-heavy pages.
  const widgetCss = [hover, typographyCss, overrideCss, scopedCss].filter(Boolean).join("\n");
  // Inner content shell - pozwala wycentrować treść i zmniejszyć jej szerokość
  // wewnątrz widgetu (bez zmieniania szerokości samego widgetu), oraz sterować
  // odstępem między dziećmi. Brak wartości = zachowanie legacy (pełna szerokość).
  const advContentMaxWidth = node.advanced?.contentMaxWidth;
  const advContentAlign = node.advanced?.contentAlign;
  const advContentGap = node.advanced?.contentGap;
  const toCssLen = (v: number | string | undefined): string | undefined =>
    v === undefined ? undefined : typeof v === "number" ? `${v}px` : v;
  const innerMaxWidth = toCssLen(advContentMaxWidth);
  const innerGap = toCssLen(advContentGap);
  const innerAlignItems =
    advContentAlign === "center"
      ? "center"
      : advContentAlign === "end"
        ? "flex-end"
        : advContentAlign === "start"
          ? "flex-start"
          : undefined;
  const hasInnerShell = Boolean(innerMaxWidth || innerGap || innerAlignItems);
  const innerShellStyle: CSSProperties | undefined = hasInnerShell
    ? {
        display: "flex",
        flexDirection: "column",
        width: "100%",
        maxWidth: innerMaxWidth ?? "100%",
        marginInline: advContentAlign === "center" ? "auto" : undefined,
        marginLeft: advContentAlign === "end" ? "auto" : undefined,
        marginRight: advContentAlign === "start" ? "auto" : undefined,
        alignItems: innerAlignItems,
        gap: innerGap,
        minWidth: 0,
        boxSizing: "border-box",
      }
    : undefined;

  // "Wyrównanie" dropdown (style.align → baseStyle.textAlign) drives block-level
  // alignment of widget children inside forms/newsletters. When the user picks
  // Lewo/Środek/Prawo, the whole inner column shifts accordingly (align-items
  // on the flex-col wrapper, and same on the inner shell when present).
  const styleAlignItems: CSSProperties["alignItems"] | undefined = (() => {
    const ta = baseStyle.textAlign;
    if (ta === "left" || ta === "justify" || ta === "start") return "flex-start";
    if (ta === "right" || ta === "end") return "flex-end";
    if (ta === "center") return "center";
    return undefined;
  })();
  // When user picks alignment (Lewo/Środek/Prawo) but hasn't defined a
  // contentMaxWidth, the direct child (e.g. join-us card / contact-form) is
  // still `width: 100%` and align-items on the flex-col parent has no visible
  // effect. Wrap children in a shrink-to-content div with align-self so the
  // block actually shifts inside its column.
  // Structural widgets describe horizontal space in the column. Wrapping a
  // divider/spacer in the generic `width:auto` alignment shell makes their
  // own `width:100%` resolve against a shrink-to-content box (often 0 px).
  // Keep their renderer attached directly to the full-width widget shell.
  const isStructuralWidthWidget = node.type === "divider" || node.type === "spacer";
  const allowsFloatingChrome = node.type === "account-link";
  const isSearchButton = node.type === "search-button";
  const needsAlignShrinkWrap =
    Boolean(styleAlignItems) && !innerShellStyle && !isStructuralWidthWidget;
  const alignShrinkWrapStyle: CSSProperties | undefined = needsAlignShrinkWrap
    ? {
        alignSelf: styleAlignItems,
        // Search bar must fill its column so the input area is long enough;
        // shrinking it to the content width produces a 166 px unusable field.
        width: isSearchButton ? "100%" : "auto",
        maxWidth: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
      }
    : undefined;

  // Styl PRZED treścią: przy strumieniowanym HTML parser maluje widget od razu
  // po wczytaniu, a <style> na końcu ramki docierał dopiero po nim - pierwsza
  // klatka szła bez typografii widgetu i przeskakiwała. Blok stoi OBOK ramki,
  // a nie w środku, bo `[data-w-id] > :first-child` w styles.css zeruje
  // margines pierwszego dziecka - <style> w środku przejąłby tę regułę.
  const wrap = (children: React.ReactNode) => (
    <>
      {widgetCss && <style dangerouslySetInnerHTML={{ __html: hardenStyleCss(widgetCss) }} />}
      <div
        id={htmlId}
        data-w-id={node.id}
        data-typography-gap-active={typeof activeGapPx === "number" ? "1" : undefined}
        ref={motion ? motionRef : undefined}
        className={`text-foreground ${cls}`.trim()}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: styleAlignItems ?? "center",
          justifyContent: isCompactWidget ? "center" : "flex-start",
          width: "100%",
          minWidth: 0,
          // Media normally keeps its intrinsic height, but a fixed widget height
          // must propagate through this shell so the canvas changes immediately.
          height: isMedia && !fillsExplicitFrameHeight ? "auto" : "100%",
          maxWidth: isImage ? "none" : "100%",
          boxSizing: "border-box",
          overflow: isImage || isMedia || allowsFloatingChrome ? "visible" : "hidden",
          position: allowsFloatingChrome ? "relative" : undefined,
          zIndex: allowsFloatingChrome ? 30 : undefined,
          ...(typeof activeGapPx === "number"
            ? ({ "--cms-title-description-gap": `${activeGapPx}px` } as CSSProperties)
            : {}),
          ...baseStyle,
          marginTop: 0,
          marginBottom: 0,
          ...motionStyle,
        }}
      >
        {innerShellStyle ? (
          <div
            style={
              // When "Wyrównanie treści" (contentAlign) isn't set, let the top-level
              // "Wyrównanie" dropdown drive the inner shell alignment too.
              innerAlignItems || !styleAlignItems
                ? innerShellStyle
                : { ...innerShellStyle, alignItems: styleAlignItems }
            }
          >
            {children}
          </div>
        ) : alignShrinkWrapStyle ? (
          <div style={alignShrinkWrapStyle}>{children}</div>
        ) : (
          children
        )}
      </div>
    </>
  );

  const c = node.content;
  const canEdit = editable && !!onContentChange;
  const commit = (k: string, v: string) => onContentChange?.(k, v);
  const compactRowStyle: CSSProperties = {
    boxSizing: "border-box",
  };
  return {
    node,
    lang,
    device,
    editable,
    onContentChange,
    effectiveMode,
    activeTypography,
    aboveFold,
    c,
    canEdit,
    commit,
    compactRowStyle,
    wrap,
  };
}

export type WidgetFrame = ReturnType<typeof useWidgetFrame>;

/**
 * Gałęzie typów, które obsługuje CHROME (nagłówek, stopka, menu mobilne).
 * Zwraca `undefined`, gdy typ do nich nie należy - wtedy dzwoni pełny
 * `WidgetView` (tu: leniwie, w kanwie i na stronach treści: bezpośrednio).
 */
export function renderChromeWidget(frame: WidgetFrame): React.ReactNode | undefined {
  const {
    node,
    lang,
    device,
    editable,
    onContentChange,
    c,
    canEdit,
    commit,
    compactRowStyle,
    wrap,
  } = frame;
  switch (node.type) {
    case "newsletter": {
      // Kanwa i strona publiczna renderują TEN SAM komponent.
      //
      // Wcześniej tryb edycji rysował statyczną atrapę honorującą 5 z 21
      // ustawień widgetu - showFirstName/showLastName/showCompany, wszystkie
      // require*, komplet *Label / *Placeholder oraz customFields były widoczne
      // dopiero po publikacji. Atrapa zniknęła: kanwa dostaje realny
      // <NewsletterForm/> z tą samą konfiguracją, tylko w trybie podglądu
      // (bez wysyłki do bazy).
      const tKey = `title_${lang}`;
      const title = pickI18n(c, "title", lang) || "Newsletter";
      const variant = normalizeNewsletterVariant(getStr(c, "variant") || "icon");
      const iconName = getStr(c, "iconName") || "Mail";
      const Icons = LucideIcons as Record<string, React.ComponentType<{ className?: string }>>;
      const IconCmp = Icons[iconName] || Icons.Mail;

      // Warianty kompaktowe nie mają formularza - to sam trigger. Tu inline
      // edycja tytułu jest możliwa i zostaje. Publicznie trigger jest kotwicą,
      // w kanwie zwykłym elementem (klik nie może nawigować po edytorze).
      if (variant === "minimal") {
        const minimalCls =
          "inline-flex items-center text-sm font-medium leading-none border-b border-dashed border-foreground/30";
        return wrap(
          canEdit ? (
            <Editable
              as="span"
              value={title}
              onCommit={(v) => commit(tKey, v)}
              style={compactRowStyle}
              className={minimalCls}
              placeholder="Newsletter…"
            />
          ) : (
            <span
              style={compactRowStyle}
              className={`${minimalCls} hover:border-brand transition cursor-pointer`}
            >
              {title}
            </span>
          ),
        );
      }
      if (variant === "icon-only" || variant === "icon") {
        const withLabel = variant === "icon";
        // Kafelek jest DOKŁADNIE taki sam jak w widgecie „Ikony social":
        // wspólny rysunek koperty, ten sam kwadrat (size + 6), promień i hover.
        // Domyślna koperta idzie ze wspólnego modułu; własna ikona z panelu
        // (iconName ≠ Mail) nadal wygrywa.
        const glyphSize = getNum(c, "size", 14);
        const useHouseMail = !getStr(c, "iconName") || iconName === "Mail";
        const glyph = useHouseMail ? (
          <SocialMailIcon size={glyphSize} />
        ) : IconCmp ? (
          <IconCmp className="w-5 h-5" />
        ) : (
          <span>✉</span>
        );
        const tileCls = `${SOCIAL_GLYPH_TILE_CLASS} ${withLabel ? "" : ""}`;
        const triggerCls = withLabel
          ? "inline-flex items-center gap-2 text-foreground transition-colors"
          : tileCls;
        const tileStyle = useHouseMail ? socialGlyphBoxStyle(glyphSize) : undefined;
        const triggerInner = withLabel ? (
          <>
            <span className={tileCls} style={tileStyle}>
              {glyph}
            </span>
            {canEdit ? (
              <Editable
                as="span"
                value={title}
                onCommit={(v) => commit(tKey, v)}
                className="text-sm font-medium"
                placeholder="Newsletter…"
              />
            ) : (
              <span className="text-sm font-medium">{title}</span>
            )}
          </>
        ) : (
          glyph
        );
        if (editable) {
          return wrap(
            <div
              className={`${triggerCls} cursor-pointer`}
              style={{ ...compactRowStyle, ...(withLabel ? {} : (tileStyle ?? {})) }}
              title={title}
              aria-label={withLabel ? undefined : title}
            >
              {triggerInner}
            </div>,
          );
        }
        return wrap(
          <a
            href="#newsletter"
            className={triggerCls}
            style={{ ...compactRowStyle, ...(withLabel ? {} : (tileStyle ?? {})) }}
            title={title}
            aria-label={withLabel ? undefined : title}
          >
            {triggerInner}
          </a>,
        );
      }

      // Warianty z formularzem (inline / card): jeden komponent, jeden config.
      const liveForm = (
        <NewsletterFormPreviewable
          lang={lang}
          variant={variant === "inline" ? "inline" : "card"}
          source={`widget:${node.id}`}
          widgetConfig={newsletterFormConfig(c)}
          previewMode={editable}
        />
      );
      if (!editable) return wrap(liveForm);
      // Tryb podglądu: pola są w pełni widoczne i klikalne, ale zdarzenie
      // `submit` ginie w fazie capture, zanim dobiegnie do handlera formularza
      // (React woła natywne stopPropagation, więc listener bąbelkowy roota nie
      // wystartuje). Guard zostaje także po wdrożeniu `previewMode` - kanwa nie
      // może zapisywać do bazy nawet gdy ktoś doda tam kolejny formularz.
      return wrap(
        <div
          className="w-full"
          data-newsletter-preview="1"
          onSubmitCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {liveForm}
        </div>,
      );
    }

    case "heading": {
      const key = `text_${lang}`;
      const text = pickI18n(c, "text", lang);
      const subtitle = pickI18n(c, "subtitle", lang);
      const tag = (getStr(c, "tag") || "h2") as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      const variant = getStr(c, "variant") || "default";
      // Rozróżniamy "user nic nie ustawił" od "user wybrał md" - fallback do
      // globalnych ustawień Theme Design (superadmin) tylko gdy pole jest puste.
      const sizePresetRaw = getStr(c, "sizePreset");
      const sizePreset = sizePresetRaw || "md";
      const sizePx = getNum(c, "sizePx", 0);
      const titleWeight = getStr(c, "titleWeight");
      const subtitleSizePx = getNum(c, "subtitleSizePx", 0);
      const subtitleWeight = getStr(c, "subtitleWeight");
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const iconName = getStr(c, "iconName");
      const iconPos = getStr(c, "iconPosition") || "left";
      const usePx = sizePx > 0;
      // Jeśli widget nie ma własnego sizePx ANI preset nie jest wybrany
      // ręcznie, dziedziczymy globalny "Post title" z Theme Design.
      const useGlobalTitle = !usePx && !sizePresetRaw;
      const sizeCls =
        usePx || useGlobalTitle
          ? ""
          : sizePreset === "sm"
            ? "text-xl"
            : sizePreset === "lg"
              ? "text-4xl"
              : sizePreset === "xl"
                ? "text-5xl"
                : sizePreset === "display"
                  ? "text-6xl md:text-7xl"
                  : "text-3xl";
      const gradientFrom = getStr(c, "gradientFrom");
      const gradientTo = getStr(c, "gradientTo");
      const gradientAngle = getNum(c, "gradientAngle", 90);
      const highlightColor = getStr(c, "highlightColor");
      const outlineColor = getStr(c, "outlineColor");
      const customGradient = variant === "gradient" && !!gradientFrom && !!gradientTo;
      const variantCls =
        variant === "gradient"
          ? customGradient
            ? "bg-clip-text text-transparent"
            : "text-gradient-brand"
          : variant === "outlined"
            ? "[-webkit-text-stroke:1px_currentColor] text-transparent"
            : variant === "highlight"
              ? `${highlightColor ? "" : "decoration-brand"} decoration-4 underline-offset-4 underline`
              : variant === "uppercase"
                ? "uppercase tracking-widest"
                : variant === "serif"
                  ? "font-serif"
                  : "";
      const headCls = `font-display ${sizeCls} ${variantCls}`.trim();
      const headStyle: React.CSSProperties = {
        ...(usePx
          ? { fontSize: `${sizePx}px`, lineHeight: 1.1 }
          : useGlobalTitle
            ? { fontSize: "var(--td-pt-size, 15px)", lineHeight: "var(--td-pt-lh, 1.3)" }
            : {}),
        fontWeight: (titleWeight
          ? titleWeight
          : "var(--td-pt-weight, 600)") as React.CSSProperties["fontWeight"],
        ...(customGradient
          ? {
              backgroundImage: `linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo})`,
            }
          : {}),
        ...(variant === "highlight" && highlightColor
          ? { textDecorationColor: highlightColor }
          : {}),
        ...(variant === "outlined" && outlineColor
          ? ({ WebkitTextStrokeColor: outlineColor } as React.CSSProperties)
          : {}),
      };
      const finalStyle = Object.keys(headStyle).length ? headStyle : undefined;
      const finalCls = headCls;
      const reg: Record<
        string,
        React.ComponentType<{ size?: number; className?: string }> | undefined
      > = LucideIcons as Record<
        string,
        React.ComponentType<{ size?: number; className?: string }> | undefined
      >;
      const Icon = iconName ? (reg[iconName] ?? null) : null;
      const inner = canEdit ? (
        <Editable
          as={tag}
          value={text}
          onCommit={(v) => commit(key, v)}
          className={finalCls}
          style={finalStyle}
          placeholder={lang === "pl" ? "Nagłówek…" : "Heading…"}
        />
      ) : (
        (() => {
          const Tag = tag as React.ElementType;
          return (
            <Tag className={finalCls} style={finalStyle}>
              {text}
            </Tag>
          );
        })()
      );
      const titleRow = (
        <span
          className={`inline-flex items-center gap-2 ${iconPos === "right" ? "flex-row-reverse" : ""}`}
        >
          {Icon && <Icon size={28} className="opacity-80" />}
          <span className="contents">{inner}</span>
        </span>
      );
      // Puste subtitleSizePx -> globalny "Post excerpt" z Theme Design.
      const useGlobalSubtitle = subtitleSizePx <= 0;
      const subtitleStyle: React.CSSProperties = {
        ...(useGlobalSubtitle
          ? { fontSize: "var(--td-pe-size, 13px)", lineHeight: "var(--td-pe-lh, 1.5)" }
          : { fontSize: `${subtitleSizePx}px`, lineHeight: 1.35 }),
        fontWeight: (subtitleWeight
          ? subtitleWeight
          : "var(--td-pe-weight, 400)") as React.CSSProperties["fontWeight"],
      };
      const block = (
        <div className="space-y-1">
          {href ? (
            <AppLink
              href={href}
              target={target}
              rel={target === "_blank" ? "noopener noreferrer" : undefined}
              className="hover:opacity-80 transition"
            >
              {titleRow}
            </AppLink>
          ) : (
            titleRow
          )}
          {subtitle && (
            <p className="text-muted-foreground" style={subtitleStyle}>
              {subtitle}
            </p>
          )}
        </div>
      );
      return wrap(block);
    }
    case "text": {
      const key = `html_${lang}`;
      const html = pickI18n(c, "html", lang);
      const cols = getNum(c, "columns", 1);
      const dropCap = getStr(c, "dropCap") === "on";
      // Explicit list/blockquote/heading rules - Tailwind Preflight strips
      // ul/ol markers and the project does not ship @tailwindcss/typography,
      // so `.prose` alone would leave bullets/numbers invisible. Mirror the
      // authoring toolbar (RichHtmlField) 1:1 so canvas == public output.
      // Wcięcia list dopasowane 1:1 do neweuropeanstrategies.com:
      // - list-outside + pl-5 (marker poza kolumną tekstu, jedno spójne wcięcie)
      // - zagnieżdżone listy: bez dodatkowego pl (dziedziczą pl-5 z reguły ogólnej),
      //   zmienia się tylko kształt markera (circle/lower-alpha).
      const proseCls = `cms-rich-content cms-elementor-richtext prose prose-sm max-w-none [&_*]:text-inherit [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:my-2 [&_h2]:font-semibold [&_h3]:font-semibold [&_a]:underline ${dropCap ? "first-letter:float-left first-letter:text-5xl first-letter:font-display first-letter:mr-2 first-letter:leading-none" : ""}`;
      const colStyle =
        cols > 1 ? ({ columnCount: cols, columnGap: "1.5rem" } as CSSProperties) : undefined;
      // Multi-paragraph HTML (po Enterze pojawia się kolejny <p>) MUSI zachować
      // pionowy przepływ w bloku - poprzednie `display:flex` na kontenerze
      // rozpychało kolejne akapity poziomo, przez co treść wyglądała jak
      // pocięte kolumny mimo `columns=1`.
      if (canEdit) {
        return wrap(
          <Editable
            as="div"
            html
            multiline
            value={html}
            onCommit={(v) => commit(key, v)}
            className={proseCls}
            style={colStyle}
            placeholder={lang === "pl" ? "Wpisz tekst…" : "Type text…"}
          />,
        );
      }
      // RichHtmlView sanitizes + injects the HTML and re-mounts footnote tooltips
      // for migrated content whose footnote refs/list are baked into the markup.
      return wrap(<RichHtmlView html={html} className={proseCls} style={colStyle} />);
    }
    case "button": {
      const key = `label_${lang}`;
      const label = pickI18n(c, "label", lang);
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const variant = getStr(c, "variant") || "primary";
      const size = getStr(c, "size") || "md";
      const iconName = getStr(c, "iconName");
      const iconPos = getStr(c, "iconPosition") || "left";
      // "Szerokość": automatyczna = do treści, 100% = pełna szerokość kolumny.
      // Wcześniej klasa miała bezwarunkowe `w-full`, więc ustawienie było
      // martwe, a do tego kanwa (ResizableBox = inline-flex o szerokości auto)
      // i strona publiczna (brak wrappera, `w-full` w kolumnie flex) dawały dwa
      // różne wyniki dla tej samej konfiguracji.
      const fullWidth = asOneOf(getStr(c, "fullWidth"), ["auto", "full"], "auto") === "full";
      const widthPx = getNum(c, "widthPx", 0);
      const heightPx = getNum(c, "heightPx", 0);
      const variantCls =
        variant === "outline"
          ? "border border-border hover:bg-muted"
          : variant === "ghost"
            ? "hover:bg-muted"
            : variant === "gradient"
              ? "bg-gradient-brand text-white hover:opacity-90"
              : variant === "soft"
                ? "bg-brand/10 text-brand hover:bg-brand/20"
                : variant === "link"
                  ? "underline-offset-4 hover:underline text-brand px-0"
                  : "bg-brand text-brand-foreground hover:opacity-90";
      // Default ("md") matches the search-widget closed pill height.
      const sizeCls =
        size === "sm"
          ? "px-3 py-1.5 text-xs"
          : size === "lg"
            ? "px-7 py-3 text-base"
            : "px-3.5 py-2 text-xs";
      const cls = `inline-flex items-center justify-center gap-2 rounded-md font-medium leading-none transition ${fullWidth ? "w-full" : "w-auto"} h-full ${sizeCls} ${variantCls} ${iconPos === "right" ? "flex-row-reverse" : ""}`;
      const btnGradFrom = getStr(c, "gradientFrom");
      const btnGradTo = getStr(c, "gradientTo");
      const btnGradAngle = getNum(c, "gradientAngle", 90);
      const btnBgColor = getStr(c, "btnBgColor");
      const btnTextColor = getStr(c, "btnTextColor");
      const btnBorderColor = getStr(c, "btnBorderColor");
      const btnStyle: React.CSSProperties = {};
      if (variant === "gradient" && btnGradFrom && btnGradTo) {
        btnStyle.backgroundImage = `linear-gradient(${btnGradAngle}deg, ${btnGradFrom}, ${btnGradTo})`;
      }
      if (btnBgColor && (variant === "primary" || variant === "soft" || variant === "outline")) {
        btnStyle.backgroundColor = btnBgColor;
      }
      if (btnTextColor && variant !== "gradient") {
        btnStyle.color = btnTextColor;
      }
      if (btnBorderColor && variant === "outline") {
        btnStyle.borderColor = btnBorderColor;
      }
      const hasBtnStyle = Object.keys(btnStyle).length > 0;
      const reg: Record<string, React.ComponentType<{ size?: number }> | undefined> =
        LucideIcons as Record<string, React.ComponentType<{ size?: number }> | undefined>;
      const Icon = iconName ? (reg[iconName] ?? null) : null;
      const inner = canEdit ? (
        <span className={cls} style={hasBtnStyle ? btnStyle : undefined}>
          {Icon && <Icon size={14} />}
          <Editable
            as="span"
            value={label}
            onCommit={(v) => commit(key, v)}
            placeholder="Etykieta…"
          />
        </span>
      ) : (
        <AppLink
          href={href}
          target={target}
          rel={target === "_blank" || href.startsWith("http") ? "noopener noreferrer" : undefined}
          className={cls}
          style={hasBtnStyle ? btnStyle : undefined}
        >
          {Icon && <Icon size={14} />}
          {label}
        </AppLink>
      );
      const resizable = (
        <ResizableBox
          enabled={canEdit}
          widthPx={widthPx > 0 ? widthPx : undefined}
          heightPx={heightPx > 0 ? heightPx : undefined}
          onCommit={(w, h) => {
            onContentChange?.("widthPx", w);
            onContentChange?.("heightPx", h);
          }}
        >
          {inner}
        </ResizableBox>
      );
      // Dla "100%" opakowujemy w jednokolumnowy grid: element o `width:auto`
      // (a takim jest ResizableBox w kanwie) rozciąga się na całą ścieżkę
      // gridu, a publicznie ResizableBox znika i pełną szerokość wymusza samo
      // `w-full`. Efekt jest ten sam po obu stronach. Jawna szerokość w px
      // nadal wygrywa, bo `justify-items: stretch` nie dotyka elementów z
      // definitywną szerokością. Wariant "automatyczna" zostaje bez wrappera,
      // żeby nie zmieniać działania "Wyrównania" z panelu stylów.
      if (!fullWidth) return wrap(resizable);
      return wrap(
        <div
          data-button-full-width="1"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            justifyItems: "stretch",
            width: "100%",
            minWidth: 0,
          }}
        >
          {resizable}
        </div>,
      );
    }
    case "nav-link": {
      const key = `label_${lang}`;
      const label = pickI18n(c, "label", lang);
      const href = safeUrl(getStr(c, "href"));
      const target = getStr(c, "target") === "blank" ? "_blank" : undefined;
      const variant = getStr(c, "variant") || "text";
      const iconName = getStr(c, "iconName");
      const variantCls =
        variant === "primary"
          ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-brand text-brand-foreground hover:opacity-90"
          : variant === "outline"
            ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-md border border-border hover:bg-muted"
            : variant === "pill"
              ? "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted hover:bg-muted/70"
              : variant === "underline"
                ? "inline-flex items-center gap-1.5 underline-offset-4 hover:underline"
                : "inline-flex items-center gap-1.5 text-foreground hover:opacity-80";
      const cls = `h-10 text-xs font-bold tracking-wider leading-none transition w-fit self-start justify-start ${variantCls}`;
      const iconEl = iconName ? <DynamicIcon name={iconName} size={14} /> : null;
      if (canEdit) {
        return wrap(
          <span className={cls}>
            {iconEl}
            <Editable
              as="span"
              value={label}
              onCommit={(v) => commit(key, v)}
              placeholder="Etykieta…"
            />
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
          {iconEl}
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
    case "menu": {
      const menuKey = getStr(c, "menu_key") || "main";
      return wrap(<SiteMenu menuKey={menuKey} lang={lang} mobile={device === "mobile"} />);
    }
    case "cta": {
      const tKey = `title_${lang}`;
      const cKey = `cta_${lang}`;
      const title = pickI18n(c, "title", lang);
      const subtitle = pickI18n(c, "subtitle", lang);
      const cta = pickI18n(c, "cta", lang);
      const href = safeUrl(getStr(c, "href"));
      const variant = getStr(c, "variant") || "default";
      const align = getStr(c, "align") || "between";
      const containerCls =
        variant === "gradient"
          ? "bg-gradient-brand text-white rounded-xl p-8"
          : variant === "bar"
            ? "bg-brand text-brand-foreground rounded-md py-3 px-5"
            : variant === "card"
              ? "bg-card border border-border rounded-xl p-8 shadow-2xl"
              : "bg-brand text-brand-foreground rounded-lg p-8";
      const layoutCls =
        variant === "split"
          ? "flex flex-col items-start gap-4"
          : `flex flex-col sm:flex-row gap-4 ${align === "left" ? "items-start sm:items-center" : align === "center" ? "items-center justify-center text-center" : "items-center justify-between"}`;
      const ctaWidthPx = getNum(c, "ctaWidthPx", 0);
      const ctaHeightPx = getNum(c, "ctaHeightPx", 0);
      const ctaBgFrom = getStr(c, "ctaBgFrom");
      const ctaBgTo = getStr(c, "ctaBgTo");
      const ctaGradientAngle = getNum(c, "ctaGradientAngle", 135);
      const ctaBgColor = getStr(c, "ctaBgColor");
      const ctaTextColor = getStr(c, "ctaTextColor");
      const ctaBtnBg = getStr(c, "ctaBtnBg");
      const ctaBtnText = getStr(c, "ctaBtnText");
      const containerStyle: React.CSSProperties = {};
      if (variant === "gradient" && ctaBgFrom && ctaBgTo) {
        containerStyle.backgroundImage = `linear-gradient(${ctaGradientAngle}deg, ${ctaBgFrom}, ${ctaBgTo})`;
      }
      if (variant !== "gradient" && ctaBgColor) containerStyle.backgroundColor = ctaBgColor;
      if (ctaTextColor) containerStyle.color = ctaTextColor;
      const hasContainerStyle = Object.keys(containerStyle).length > 0;
      const ctaBtnCls =
        "inline-flex items-center justify-center w-full h-full bg-brand-foreground text-brand px-3.5 py-2 rounded font-medium text-xs leading-none";
      const ctaBtnStyle: React.CSSProperties = {};
      if (ctaBtnBg) ctaBtnStyle.backgroundColor = ctaBtnBg;
      if (ctaBtnText) ctaBtnStyle.color = ctaBtnText;
      const hasBtnStyle = Object.keys(ctaBtnStyle).length > 0;
      const ctaInner = canEdit ? (
        <Editable
          as="span"
          value={cta}
          onCommit={(v) => commit(cKey, v)}
          className={ctaBtnCls}
          style={hasBtnStyle ? ctaBtnStyle : undefined}
          placeholder="Etykieta…"
        />
      ) : (
        <AppLink
          href={href}
          className={`${ctaBtnCls} hover:opacity-90 transition`}
          style={hasBtnStyle ? ctaBtnStyle : undefined}
        >
          {cta}
        </AppLink>
      );
      const ctaBtn = (
        <ResizableBox
          enabled={canEdit}
          widthPx={ctaWidthPx > 0 ? ctaWidthPx : undefined}
          heightPx={ctaHeightPx > 0 ? ctaHeightPx : undefined}
          onCommit={(w, h) => {
            onContentChange?.("ctaWidthPx", w);
            onContentChange?.("ctaHeightPx", h);
          }}
        >
          {ctaInner}
        </ResizableBox>
      );
      return wrap(
        <div className={containerCls} style={hasContainerStyle ? containerStyle : undefined}>
          <div className={layoutCls}>
            <div className="space-y-1">
              {canEdit ? (
                <Editable
                  as="h3"
                  value={title}
                  onCommit={(v) => commit(tKey, v)}
                  className="font-display text-2xl"
                  placeholder={lang === "pl" ? "Nagłówek CTA…" : "CTA heading…"}
                />
              ) : (
                <h3 className="font-display text-2xl">{title}</h3>
              )}
              {subtitle && <p className="text-sm opacity-80">{subtitle}</p>}
            </div>
            {ctaBtn}
          </div>
        </div>,
      );
    }
    default:
      return undefined;
  }
}

/**
 * Wysokość rezerwowana na widget nieznany chrome'owi. Bez niej fallback
 * Suspense ma zero pikseli i doładowanie pełnego dyspozytora przesuwa układ
 * (CLS) dokładnie w tym miejscu, w którym chrome ma być stabilne.
 */
const UNKNOWN_WIDGET_MIN_HEIGHT = 40;

// Jedyne wejście do pełnego dyspozytora - DYNAMICZNE, żeby `WidgetView`
// i wszystko, co ciągnie, zostało poza chunkiem wejściowym.
const LazyWidgetView = lazy(() => import("./WidgetView").then((m) => ({ default: m.WidgetView })));

export const ChromeWidgetView = memo(function ChromeWidgetView(props: WidgetViewProps) {
  const frame = useWidgetFrame(props);
  const { node, lang, effectiveMode, editable, onContentChange, activeTypography, wrap } = frame;

  const simple = renderSimpleWidget(
    node,
    lang,
    effectiveMode,
    editable,
    onContentChange,
    activeTypography,
  );
  if (simple !== undefined) return wrap(simple);

  const chrome = renderChromeWidget(frame);
  if (chrome !== undefined) return chrome;

  return (
    <Suspense
      fallback={
        <div
          data-chrome-widget-pending={node.type}
          style={{ minHeight: UNKNOWN_WIDGET_MIN_HEIGHT, width: "100%" }}
        />
      }
    >
      <LazyWidgetView {...props} />
    </Suspense>
  );
});

ChromeWidgetView.displayName = "ChromeWidgetView";
