// Shared variants for the "section-label" widget.
// Used by both the live renderer (WidgetView) and the visual picker (WidgetProperties).
import * as React from "react";
import { AppLink } from "@/components/atoms/AppLink";
import { autoInvertColor } from "@/lib/builder/autoInvertColor";
import type { WidgetNode } from "@/lib/builder/types";

export type SectionLabelVariant =
  | "left-bar"
  | "left-border"
  | "small-corners"
  | "only-text"
  | "badge-filled"
  | "centered-rule"
  | "centered-short-rule"
  | "filled-bar"
  | "centered-underline"
  | "slanted-ribbon-rule"
  | "double-rule-centered"
  | "editorial-index"
  | "double-deck-masthead"
  | "bracket-label"
  | "kicker-tag-rule"
  | "stacked-serif-lede"
  | "dotted-leader"
  | "numbered-rail"
  | "split-rule-duo"
  | "ticker-strip"
  | "underline-sweep";

export const SECTION_LABEL_VARIANTS: { value: SectionLabelVariant; label: string }[] = [
  { value: "left-bar", label: "01 - Pionowy pasek" },
  { value: "left-border", label: "02 - Lewa krawędź" },
  { value: "small-corners", label: "04 - Narożniki" },
  { value: "only-text", label: "05 - Tylko tekst" },
  { value: "badge-filled", label: "06 - Etykieta pełna" },
  { value: "centered-rule", label: "07 - Wycentrowany z linią (np. Poznaj nasze raporty)" },
  {
    value: "centered-short-rule",
    label: "08 - Wycentrowany z krótkimi liniami (np. Materiały partnerów)",
  },
  { value: "filled-bar", label: "09 - Pełny pasek (np. Najnowszy raport)" },
  {
    value: "centered-underline",
    label: "10 - Wycentrowany z podkreśleniem (np. Poznaj nasze raporty)",
  },
  { value: "slanted-ribbon-rule", label: "11 - Wstęga ze spadem i linią (np. Najnowszy raport)" },
  { value: "double-rule-centered", label: "12 - Subtelne linie (np. Wywiady | Podcasty)" },
  { value: "editorial-index", label: "13 - Editorial Index (numer + tytuł, styl FT Lex)" },
  { value: "double-deck-masthead", label: "14 - Double-Deck Masthead (kategoria nad tytułem)" },
  { value: "bracket-label", label: "15 - Bracket Label (tytuł w nawiasach + linia)" },
  { value: "kicker-tag-rule", label: "16 - Kicker Tag (tag kategorii + linia do akcji)" },
  { value: "stacked-serif-lede", label: "17 - Stacked Serif Lede (tytuł + podtytuł)" },
  { value: "dotted-leader", label: "18 - Dotted Leader (kropkowana linia do akcji)" },
  { value: "numbered-rail", label: "19 - Numbered Rail (duża cyfra w tle)" },
  { value: "split-rule-duo", label: "20 - Split Rule Duo (dwie etykiety z kreską)" },
  { value: "ticker-strip", label: "21 - Ticker Strip (pasek z pulsującą kropką)" },
  { value: "underline-sweep", label: "22 - Underline Sweep (animowane podkreślenie 2px)" },
];

// ---- Typografia konfigurowalna (numer / kategoria / tytuł) ----
export type SectionLabelFont = "inherit" | "display" | "serif" | "sans" | "mono";

export const SECTION_LABEL_FONTS: { value: SectionLabelFont; label: string }[] = [
  { value: "inherit", label: "Domyślna" },
  { value: "display", label: "Display (Red Hat Display)" },
  { value: "serif", label: "Serif (redakcyjna)" },
  { value: "sans", label: "Sans" },
  { value: "mono", label: "Mono" },
];

export function resolveFontFamily(font?: string): string | undefined {
  switch (font) {
    case "display":
      return 'var(--font-display, "Red Hat Display", system-ui, sans-serif)';
    case "serif":
      return '"Iowan Old Style", "Palatino Linotype", Georgia, "Times New Roman", serif';
    case "sans":
      return "var(--font-sans, system-ui, -apple-system, sans-serif)";
    case "mono":
      return 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';
    default:
      return undefined;
  }
}

export type SectionLabelArrow = "arrow" | "chevron" | "long" | "none";

export const SECTION_LABEL_ARROWS: { value: SectionLabelArrow; label: string }[] = [
  { value: "arrow", label: "Strzałka →" },
  { value: "chevron", label: "Chevron ›" },
  { value: "long", label: "Długa strzałka ⟶" },
  { value: "none", label: "Bez strzałki" },
];

export function arrowGlyph(kind?: string): string {
  switch (kind) {
    case "chevron":
      return "›";
    case "long":
      return "⟶";
    case "none":
      return "";
    default:
      return "→";
  }
}

// Resolve preset color names to CSS color values (also supports raw hex/oklch).
export function resolveAccentColor(color?: string): string {
  if (!color) return "#FA9346";
  if (
    color.startsWith("#") ||
    color.startsWith("oklch") ||
    color.startsWith("hsl") ||
    color.startsWith("rgb") ||
    color.startsWith("var(")
  ) {
    return color;
  }
  switch (color) {
    case "amber":
      return "#F8B632";
    case "gold":
      return "#FECA62";
    case "sky":
      return "#63B2F2";
    case "green":
      return "#81D365";
    case "red":
      return "#F24343";
    case "ivory":
      return "#F8F6F4";
    case "crimson":
      return "#CD393B";
    case "navy":
      return "#01112F";
    case "ink":
      return "#141313";
    // Legacy aliases (kept for existing content)
    case "military":
      return "#CD393B";
    case "finance":
      return "#81D365";
    case "diplomacy":
      return "#01112F";
    case "transport":
      return "#F8B632";
    case "cyber":
      return "#63B2F2";
    case "neutral":
      return "#141313";
    case "brand":
    default:
      return "#FA9346";
  }
}
// Content -> render props. Jedno źródło prawdy dla runtime (SimpleWidgets)
// i preview (SectionLabelEditor / tile w wariancie picker). Runtime podaje
// `theme` żeby akcent auto-inwertował się w dark; preview zostawia jasny.
// `overrides` pozwala nadpisać etykietę i akcję (preview używa "Sekcja" /
// tłumaczenia "więcej" gdy content jest pusty).
export interface SectionLabelContentProps {
  label: string;
  action?: string;
  href?: string;
  accent: string;
  variant: SectionLabelVariant;
  labelColor?: string;
  labelSize?: string;
  actionColor?: string;
  actionSize?: string;
  // Warianty 13/14
  indexNumber?: string;
  category?: string;
  showRule?: boolean;
  numberFont?: string;
  numberSize?: string;
  categoryFont?: string;
  categorySize?: string;
  titleFont?: string;
  arrow?: string;
  gapX?: string;
  gapY?: string;
}

export function readSectionLabelProps(
  c: WidgetNode["content"],
  lang: "pl" | "en",
  opts: { theme?: "light" | "dark"; labelFallback?: string; actionFallback?: string } = {},
): SectionLabelContentProps {
  const str = (k: string): string => {
    const v = c[k];
    return typeof v === "string" ? v : "";
  };
  const bool = (k: string, dflt: boolean): boolean => {
    const v = c[k];
    return typeof v === "boolean" ? v : dflt;
  };
  const label = str(`label_${lang}`) || str("label_pl") || opts.labelFallback || "Sekcja";
  const actionRaw = str(`action_${lang}`) || str("action_pl") || opts.actionFallback || "";
  const href = str("href");
  const variant = (str("variant") || "left-bar") as SectionLabelVariant;
  const customAccent = str("accentColor");
  const colorBase = customAccent || str("color") || "brand";
  const accent = resolveAccentColor(
    opts.theme === "dark" ? autoInvertColor(colorBase, "dark") : colorBase,
  );
  const showAction = bool("showAction", true);
  return {
    label,
    action: showAction && actionRaw ? actionRaw : undefined,
    href: href || undefined,
    accent,
    variant,
    labelColor: str("labelColor") || undefined,
    labelSize: str("labelSize") || undefined,
    actionColor: str("actionColor") || undefined,
    actionSize: str("actionSize") || undefined,
    indexNumber: str("indexNumber") || undefined,
    category: str(`category_${lang}`) || str("category_pl") || undefined,
    showRule: bool("showRule", true),
    numberFont: str("numberFont") || undefined,
    numberSize: str("numberSize") || undefined,
    categoryFont: str("categoryFont") || undefined,
    categorySize: str("categorySize") || undefined,
    titleFont: str("titleFont") || undefined,
    arrow: str("arrow") || undefined,
    gapX: str("gapX") || undefined,
    gapY: str("gapY") || undefined,
  };
}

interface RenderProps {
  label: string;
  action?: string;
  href?: string;
  accent: string; // resolved CSS color
  variant: SectionLabelVariant;
  size?: "sm" | "md"; // sm = preview tile, md = real
  labelColor?: string; // override label text color
  labelSize?: string; // override label font-size (e.g. "14px", "1rem")
  actionColor?: string; // override action ("więcej") color
  actionSize?: string; // override action font-size
  indexNumber?: string;
  category?: string;
  showRule?: boolean;
  numberFont?: string;
  numberSize?: string;
  categoryFont?: string;
  categorySize?: string;
  titleFont?: string;
  arrow?: string;
  /** Odstęp poziomy między elementami (numer/kreska/tytuł/akcja). */
  gapX?: string;
  /** Odstęp pionowy między linią a tekstem (rytm bloku). */
  gapY?: string;
}

export function SectionLabelRender({
  label,
  action,
  href,
  accent,
  variant,
  size = "md",
  labelColor,
  labelSize,
  actionColor,
  actionSize,
  indexNumber,
  category,
  showRule = true,
  numberFont,
  numberSize,
  categoryFont,
  categorySize,
  titleFont,
  arrow,
  gapX,
  gapY,
}: RenderProps) {
  const isSm = size === "sm";
  const textCls = isSm
    ? "text-[9px] font-bold uppercase tracking-wider"
    : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
  const actionCls = isSm
    ? "text-[8px] text-muted-foreground"
    : "text-xs text-muted-foreground hover:opacity-80 transition";
  // Margins between widgets are owned by the column gap (see BuilderRenderer)
  // so each section-label sits flush with its slot - no per-variant mb-* that
  // would double the spacing on top of the column gap.
  const wrapperBase = isSm ? "mb-1" : "";

  const glyph = arrowGlyph(arrow);
  // Odstępy konfigurowalne; wartości domyślne trzymają kompaktowy rytm.
  const gapXPx = gapX || (isSm ? "6px" : "16px");
  const gapYPx = gapY || (isSm ? "2px" : "6px");
  const titleFamily = resolveFontFamily(titleFont);

  const labelStyle: React.CSSProperties = {};
  if (labelColor) labelStyle.color = labelColor;
  if (labelSize && !isSm) labelStyle.fontSize = labelSize;
  if (titleFamily) labelStyle.fontFamily = titleFamily;

  const actionStyle: React.CSSProperties = {};
  if (actionColor) actionStyle.color = actionColor;
  if (actionSize && !isSm) actionStyle.fontSize = actionSize;

  const ActionEl = action ? (
    href && !isSm ? (
      <AppLink
        data-description-root
        href={href}
        className={`${actionCls} shrink-0`}
        style={{ color: actionColor || accent, ...actionStyle }}
      >
        {glyph ? `${action} ${glyph}` : action}
      </AppLink>
    ) : (
      <span data-description-root className={`${actionCls} shrink-0`} style={actionStyle}>
        {glyph ? `${action} ${glyph}` : action}
      </span>
    )
  ) : null;

  const labelEl = (
    <span data-title-root className={`${textCls} min-w-0`} style={labelStyle}>
      {label}
    </span>
  );
  const padY = isSm ? "py-1" : "py-2";

  // Common row wrapper - every variant must be width-fluid and never overflow.
  const rowBase = `flex items-center justify-between gap-2 w-full min-w-0 ${wrapperBase} ${padY}`;

  switch (variant) {
    case "left-bar":
      return (
        <div className={`${rowBase} border-b border-border`}>
          <span className="inline-flex items-center gap-2 min-w-0 flex-1">
            <span
              className={
                isSm ? "inline-block w-[3px] h-3 shrink-0" : "inline-block w-1 h-5 shrink-0"
              }
              style={{ background: accent }}
            />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "left-border":
      return (
        <div
          className={`${rowBase} pl-2`}
          style={{ borderLeft: `${isSm ? 3 : 5}px solid ${accent}` }}
        >
          {labelEl}
          {ActionEl}
        </div>
      );
    case "small-corners":
      return (
        <div className={rowBase}>
          <span
            className={`${isSm ? "relative px-1.5 py-0.5" : "relative px-2 py-1"} min-w-0 max-w-full`}
          >
            <Corners accent={accent} sm={isSm} />
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "only-text":
      return (
        <div className={rowBase}>
          <span className="min-w-0 flex-1" style={{ color: accent }}>
            {labelEl}
          </span>
          {ActionEl}
        </div>
      );
    case "badge-filled": {
      const cutW = isSm ? 10 : 22;
      const padR = isSm ? 14 : 32;
      return (
        <div className={`flex items-stretch justify-between gap-2 w-full min-w-0 ${wrapperBase}`}>
          <span
            className={`${isSm ? "inline-flex items-center pl-2 py-0.5 text-[9px]" : "inline-flex items-center pl-4 py-2 font-display text-xs sm:text-sm"} font-bold uppercase tracking-wider min-w-0 max-w-[80%]`}
            style={{
              background: accent,
              color: labelColor || contrastOn(accent),
              clipPath: `polygon(0 0, 100% 0, calc(100% - ${cutW}px) 100%, 0 100%)`,
              paddingRight: `${padR}px`,
              ...(labelSize && !isSm ? { fontSize: labelSize } : {}),
            }}
          >
            <span data-title-root className="break-words">
              {label}
            </span>
          </span>
          <span className="flex items-center min-w-0 shrink">{ActionEl}</span>
        </div>
      );
    }

    case "centered-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center w-full min-w-0`}>
          <div className="flex items-center justify-center gap-3 min-w-0">
            <span className="flex-1 h-px bg-border min-w-[12px]" />
            <span
              data-title-root
              className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight max-w-[70%]`}
              style={labelStyle}
            >
              {label}
            </span>
            <span className="flex-1 h-px bg-border min-w-[12px]" />
          </div>
          {ActionEl && (
            <div data-typography-gap-target className="mt-1">
              {ActionEl}
            </div>
          )}
        </div>
      );
    case "centered-short-rule":
      return (
        <div className={`${wrapperBase} ${padY} text-center w-full min-w-0`}>
          <div className="flex items-center justify-center gap-3 min-w-0">
            <span
              className={`${isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-6 sm:w-10"} shrink-0`}
              style={{ background: accent }}
            />
            <span
              data-title-root
              className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight max-w-[70%]`}
              style={labelStyle}
            >
              {label}
            </span>
            <span
              className={`${isSm ? "inline-block h-[2px] w-4" : "inline-block h-[2px] w-6 sm:w-10"} shrink-0`}
              style={{ background: accent }}
            />
          </div>
          {ActionEl && (
            <div
              data-description-root
              data-typography-gap-target
              className={`${isSm ? "mt-0.5 text-[8px]" : "mt-1 text-xs"} text-muted-foreground`}
              style={actionStyle}
            >
              {ActionEl}
            </div>
          )}
        </div>
      );
    case "filled-bar": {
      const fg = labelColor || contrastOn(accent);
      const padCls = isSm ? "px-2 py-1" : "px-3 sm:px-4 py-2 sm:py-3";
      const labelCls = isSm
        ? "text-[9px] font-bold uppercase tracking-wider"
        : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
      const actCls = isSm
        ? "text-[8px] font-medium shrink-0"
        : "text-xs sm:text-sm font-medium hover:opacity-80 transition shrink-0";
      return (
        <div
          className={`${wrapperBase} flex items-center justify-between gap-2 w-full min-w-0 ${padCls}`}
          style={{ background: accent, color: fg }}
        >
          <span
            data-title-root
            className={`${labelCls} min-w-0 flex-1`}
            style={labelSize && !isSm ? { fontSize: labelSize } : undefined}
          >
            {label}
          </span>
          {action &&
            (href && !isSm ? (
              <AppLink
                data-description-root
                href={href}
                className={actCls}
                style={{
                  color: actionColor || fg,
                  ...(actionSize && !isSm ? { fontSize: actionSize } : {}),
                }}
              >
                {glyph ? `${action} ${glyph}` : action}
              </AppLink>
            ) : (
              <span
                data-description-root
                className={actCls}
                style={{
                  color: actionColor || fg,
                  ...(actionSize && !isSm ? { fontSize: actionSize } : {}),
                }}
              >
                {glyph ? `${action} ${glyph}` : action}
              </span>
            ))}
        </div>
      );
    }
    case "centered-underline":
      return (
        <div className={`${wrapperBase} ${padY} text-center border-b border-border w-full min-w-0`}>
          <span
            data-title-root
            className={`${isSm ? "text-[10px]" : "font-display text-sm sm:text-lg"} font-semibold tracking-tight inline-block max-w-full`}
            style={labelStyle}
          >
            {label}
          </span>
          {ActionEl && (
            <div data-typography-gap-target className={`${isSm ? "mt-0.5" : "mt-1"}`}>
              {ActionEl}
            </div>
          )}
        </div>
      );
    case "slanted-ribbon-rule": {
      const fg = labelColor || contrastOn(accent);
      const cutW = isSm ? 10 : 28;
      const lineH = isSm ? 2 : 2;
      const ribbonPadX = isSm ? "pl-1.5" : "pl-3";
      const ribbonPadY = isSm ? "py-0.5" : "py-1";
      const labelCls = isSm
        ? "text-[9px] font-bold uppercase tracking-wider"
        : "font-display text-[11px] sm:text-xs font-bold uppercase tracking-wider";
      const actCls = isSm
        ? "text-[8px] font-medium text-foreground/80"
        : "text-[11px] sm:text-xs font-medium text-foreground/80 hover:opacity-80 transition";
      return (
        <div className={`${wrapperBase} w-full min-w-0`}>
          <div className="relative flex items-center gap-2 w-full min-w-0 overflow-visible">
            <span
              className={`relative z-10 inline-flex items-center flex-none max-w-full ${ribbonPadX} ${ribbonPadY} ${labelCls}`}
              style={{
                background: accent,
                color: fg,
                clipPath: `polygon(0 0, calc(100% - ${cutW}px) 0, 100% 100%, 0 100%)`,
                paddingRight: `${cutW + (isSm ? 4 : 14)}px`,
                ...(labelSize && !isSm ? { fontSize: labelSize } : {}),
              }}
            >
              <span data-title-root className="block break-words whitespace-normal">
                {label}
              </span>
            </span>
            {action && (
              <span
                className="relative z-10 ml-auto flex items-center min-w-0 shrink-0"
                style={{ paddingLeft: isSm ? 4 : 12, paddingRight: isSm ? 4 : 8 }}
              >
                {href && !isSm ? (
                  <AppLink
                    data-description-root
                    href={href}
                    className={actCls}
                    style={{
                      color: actionColor,
                      ...(actionSize && !isSm ? { fontSize: actionSize } : {}),
                    }}
                  >
                    {action}
                  </AppLink>
                ) : (
                  <span
                    data-description-root
                    className={actCls}
                    style={{
                      color: actionColor,
                      ...(actionSize && !isSm ? { fontSize: actionSize } : {}),
                    }}
                  >
                    {action}
                  </span>
                )}
              </span>
            )}
          </div>
          <span
            aria-hidden
            className="block w-full pointer-events-none"
            style={{ height: `${lineH}px`, background: accent, marginTop: `-${lineH}px` }}
          />
        </div>
      );
    }

    case "double-rule-centered": {
      // Wycentrowany tytuł z dwiema subtelnymi liniami: cienka akcentowa nad,
      // jeszcze cieńsza neutralna pod. Inspirowane prasowymi nagłówkami.
      const titleCls = isSm
        ? "text-[10px] font-semibold tracking-tight"
        : "font-display text-sm sm:text-lg font-semibold tracking-tight inline-block max-w-full";
      const padBlock = isSm ? "py-1.5" : "py-3 sm:py-4";
      return (
        <div className={`${wrapperBase} w-full min-w-0 text-center`}>
          <span
            aria-hidden
            className="block w-full"
            style={{ height: 1, background: accent, opacity: 0.85 }}
          />
          <div className={`${padBlock} px-2`}>
            <span data-title-root className={titleCls} style={labelStyle}>
              {label}
            </span>
            {ActionEl && (
              <div data-typography-gap-target className={`${isSm ? "mt-0.5" : "mt-1"}`}>
                {ActionEl}
              </div>
            )}
          </div>
          <span
            aria-hidden
            className="block w-full"
            style={{ height: 1, background: accent, opacity: 0.85 }}
          />
        </div>
      );
    }

    case "editorial-index": {
      // Wzorzec redakcyjny (FT Lex): duży, jasny numer w szeryfowej antykwie,
      // pionowa kreska rozdzielająca i szeryfowy tytuł. Kompaktowo - bez
      // dodatkowej linii pod spodem (opcjonalna przez `showRule`).
      const num = indexNumber || "01";
      // Domyślny krój = Red Hat Display (font widgetu). Szeryf tylko wtedy,
      // gdy użytkownik wybierze go w ustawieniach widgetu.
      const numStyle: React.CSSProperties = {
        color: accent,
        opacity: 0.35,
        lineHeight: 0.9,
      };
      const numFamily = resolveFontFamily(numberFont);
      if (numFamily) numStyle.fontFamily = numFamily;
      if (!isSm && numberSize) numStyle.fontSize = numberSize;
      const titleStyle: React.CSSProperties = { ...labelStyle };
      const titleCls = isSm
        ? "text-[11px] tracking-tight"
        : "text-xl sm:text-3xl tracking-tight leading-none";

      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-center min-w-0" style={{ gap: gapXPx }}>
            <span
              aria-hidden
              className={`${isSm ? "text-[18px]" : "text-4xl sm:text-6xl"} tabular-nums shrink-0`}
              style={numStyle}
            >
              {num}
            </span>
            <span
              aria-hidden
              className="shrink-0 self-stretch"
              style={{ width: 1, background: "currentColor", opacity: 0.18 }}
            />
            <span data-title-root className={`${titleCls} min-w-0 break-words`} style={titleStyle}>
              {label}
            </span>
            {ActionEl && <span className="ml-auto shrink-0 pl-2">{ActionEl}</span>}
          </div>
          {showRule && (
            <span
              aria-hidden
              className="block w-full"
              style={{ height: 1, background: "currentColor", opacity: 0.18, marginTop: gapYPx }}
            />
          )}
        </div>
      );
    }

    case "double-deck-masthead": {
      // Masthead: cienka linia akcentowa NAD blokiem, mała kategoria (kicker)
      // i tytuł w foncie widgetu (domyślnie Red Hat Display).
      const kicker = category || "";
      const catStyle: React.CSSProperties = { color: accent };
      const catFamily = resolveFontFamily(categoryFont);
      if (catFamily) catStyle.fontFamily = catFamily;
      if (!isSm && categorySize) catStyle.fontSize = categorySize;
      const titleStyle: React.CSSProperties = { ...labelStyle };

      const titleCls = isSm
        ? "text-[12px] tracking-tight"
        : "text-xl sm:text-3xl tracking-tight leading-none";
      return (
        <div className={`${wrapperBase} w-full min-w-0`}>
          {showRule && (
            <span
              aria-hidden
              className="block w-full"
              style={{ height: isSm ? 1 : 1.5, background: accent, marginBottom: gapYPx }}
            />
          )}
          <div className="flex items-end justify-between min-w-0" style={{ gap: gapXPx }}>
            <div className="min-w-0">
              {kicker && (
                <div
                  className={`${isSm ? "text-[7px]" : "text-[10px] sm:text-[11px]"} font-bold uppercase tracking-[0.18em]`}
                  style={catStyle}
                >
                  {kicker}
                </div>
              )}
              <div
                data-title-root
                className={`${titleCls} break-words`}
                style={{ marginTop: gapYPx, ...titleStyle }}
              >
                {label}
              </div>
            </div>
            {ActionEl && <span className="shrink-0">{ActionEl}</span>}
          </div>
        </div>
      );
    }

    case "bracket-label": {
      // Redakcyjny "bracket": cienkie nawiasy w akcencie, optycznie
      // wyrównane do linii bazowej tytułu, i dwutonowa hairline - krótki
      // segment akcentowy prowadzi w neutralną kreskę na pełną szerokość.
      const bracketCls = isSm ? "text-[13px]" : "text-xl sm:text-[28px]";
      const titleCls = isSm
        ? "text-[11px] tracking-[-0.01em]"
        : "font-display text-base sm:text-xl tracking-[-0.015em]";
      const bracketStyle: React.CSSProperties = {
        color: accent,
        fontWeight: 300,
        lineHeight: 1,
        transform: `translateY(${isSm ? "0.5px" : "1px"})`,
      };
      const bracketGap = isSm ? 3 : 6;
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-baseline justify-between min-w-0" style={{ gap: gapXPx }}>
            <span className="inline-flex items-baseline min-w-0" style={{ gap: bracketGap }}>
              <span aria-hidden className={bracketCls} style={bracketStyle}>
                [
              </span>
              <span
                data-title-root
                className={`${titleCls} font-semibold min-w-0 break-words`}
                style={labelStyle}
              >
                {label}
              </span>
              <span aria-hidden className={bracketCls} style={bracketStyle}>
                ]
              </span>
            </span>
            {ActionEl}
          </div>
          {showRule && (
            <span
              aria-hidden
              className="flex w-full items-stretch overflow-hidden"
              style={{ height: 1, marginTop: gapYPx }}
            >
              <span style={{ width: isSm ? 18 : 44, background: accent, flex: "0 0 auto" }} />
              <span className="flex-1" style={{ background: "currentColor", opacity: 0.16 }} />
            </span>
          )}
        </div>
      );
    }

    case "kicker-tag-rule": {
      // Politico-style kicker: pełny tag w akcencie z ostrymi rogami, tytuł
      // w kolorze tekstu i hairline, ktora wygasza sie w kierunku akcji.
      const tag = category || "";
      const tagStyle: React.CSSProperties = {
        background: accent,
        color: contrastOn(accent),
        lineHeight: 1,
      };
      const tagFamily = resolveFontFamily(categoryFont);
      if (tagFamily) tagStyle.fontFamily = tagFamily;
      if (!isSm && categorySize) tagStyle.fontSize = categorySize;
      const titleCls = isSm
        ? "text-[10px] font-bold uppercase tracking-[0.1em]"
        : "font-display text-[12px] sm:text-[13px] font-bold uppercase tracking-[0.13em]";
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-center min-w-0" style={{ gap: gapXPx }}>
            {tag && (
              <span
                className={`${isSm ? "px-1 py-[2px] text-[7px]" : "px-2 py-[5px] text-[10px]"} font-bold uppercase tracking-[0.16em] shrink-0`}
                style={tagStyle}
              >
                {tag}
              </span>
            )}
            <span
              data-title-root
              className={`${titleCls} min-w-0 shrink truncate`}
              style={labelStyle}
            >
              {label}
            </span>
            {showRule && (
              <span
                aria-hidden
                className="flex-1 min-w-[16px]"
                style={{
                  height: 1,
                  background: `linear-gradient(to right, color-mix(in oklab, ${accent} 55%, transparent), transparent)`,
                }}
              />
            )}
            {ActionEl}
          </div>
        </div>
      );
    }

    case "stacked-serif-lede": {
      // Dwupoziomowy blok redakcyjny: krótki znacznik akcentowy, tytuł
      // i jednolinijkowy dek o kontrolowanej mierze (max ~64 znaki).
      const dek = category || "";
      const dekStyle: React.CSSProperties = { maxWidth: "64ch" };
      const dekFamily = resolveFontFamily(categoryFont);
      if (dekFamily) dekStyle.fontFamily = dekFamily;
      if (!isSm && categorySize) dekStyle.fontSize = categorySize;
      const titleCls = isSm
        ? "text-[12px] tracking-[-0.015em] leading-tight"
        : "text-xl sm:text-[32px] tracking-[-0.02em] leading-[1.08]";
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <span
            aria-hidden
            className="block"
            style={{
              width: isSm ? 16 : 32,
              height: isSm ? 2 : 3,
              background: accent,
              marginBottom: gapYPx,
            }}
          />
          <div className="flex items-end justify-between min-w-0" style={{ gap: gapXPx }}>
            <div className="min-w-0">
              <div
                data-title-root
                className={`${titleCls} font-semibold break-words text-balance`}
                style={labelStyle}
              >
                {label}
              </div>
              {dek && (
                <div
                  className={`${isSm ? "text-[8px]" : "text-xs sm:text-sm"} text-muted-foreground leading-snug`}
                  style={{ marginTop: gapYPx, ...dekStyle }}
                >
                  {dek}
                </div>
              )}
            </div>
            {ActionEl}
          </div>
          {showRule && (
            <span
              aria-hidden
              className="block w-full"
              style={{
                height: 1,
                background: "currentColor",
                opacity: 0.16,
                marginTop: gapYPx,
              }}
            />
          )}
        </div>
      );
    }

    case "dotted-leader": {
      // Indeks spisu treści: tytuł, precyzyjne kropki (radial-gradient, nie
      // border-dotted - równy raster) i akcja jak numer strony.
      const dotSize = isSm ? 1.5 : 2;
      const dotGap = isSm ? 4 : 6;
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-baseline min-w-0" style={{ gap: gapXPx }}>
            {indexNumber && (
              <span
                aria-hidden
                className={`${isSm ? "text-[8px]" : "text-[11px]"} tabular-nums font-bold shrink-0`}
                style={{ color: accent, ...(numberSize && !isSm ? { fontSize: numberSize } : {}) }}
              >
                {indexNumber}
              </span>
            )}
            <span
              data-title-root
              className={`${textCls} min-w-0 shrink truncate`}
              style={labelStyle}
            >
              {label}
            </span>
            <span
              aria-hidden
              className="flex-1 min-w-[16px] self-center"
              style={{
                height: dotSize,
                backgroundImage: `radial-gradient(circle, color-mix(in oklab, ${accent} 70%, transparent) ${dotSize / 2}px, transparent ${dotSize / 2}px)`,
                backgroundSize: `${dotGap}px ${dotSize}px`,
                backgroundRepeat: "repeat-x",
                backgroundPosition: "left center",
              }}
            />
            {ActionEl}
          </div>
        </div>
      );
    }

    case "numbered-rail": {
      // Rail: pionowa kreska akcentowa, nad nią numer w wersalikach i tytuł.
      // Zamiast wyblakłej cyfry w tle - czytelna, precyzyjna hierarchia.
      const num = indexNumber || "01";
      const numStyle: React.CSSProperties = { color: accent, lineHeight: 1 };
      const numFamily = resolveFontFamily(numberFont);
      if (numFamily) numStyle.fontFamily = numFamily;
      if (!isSm && numberSize) numStyle.fontSize = numberSize;
      const titleCls = isSm
        ? "text-[11px] tracking-[-0.01em]"
        : "font-display text-lg sm:text-2xl tracking-[-0.015em] leading-tight";
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-stretch min-w-0" style={{ gap: gapXPx }}>
            <span
              aria-hidden
              className="shrink-0 self-stretch"
              style={{ width: isSm ? 2 : 3, background: accent }}
            />
            <div className="flex min-w-0 flex-1 items-center" style={{ gap: gapXPx }}>
              <div className="min-w-0 flex-1">
                <div
                  aria-hidden
                  className={`${isSm ? "text-[7px]" : "text-[10px]"} font-bold uppercase tracking-[0.22em] tabular-nums`}
                  style={numStyle}
                >
                  {num}
                </div>
                <div
                  data-title-root
                  className={`${titleCls} font-semibold break-words`}
                  style={{ marginTop: gapYPx, ...labelStyle }}
                >
                  {label}
                </div>
              </div>
              {ActionEl}
            </div>
          </div>
          {showRule && (
            <span
              aria-hidden
              className="block w-full"
              style={{
                height: 1,
                background: "currentColor",
                opacity: 0.16,
                marginTop: gapYPx,
              }}
            />
          )}
        </div>
      );
    }

    case "split-rule-duo": {
      // Dwie etykiety w jednym rzędzie: tytuł w pełnym kontraście, druga
      // etykieta stonowana, rozdzielone pionową kreską w akcencie.
      const second = category || "";
      const secondStyle: React.CSSProperties = { opacity: 0.85 };
      const secondFamily = resolveFontFamily(categoryFont);
      if (secondFamily) secondStyle.fontFamily = secondFamily;
      if (!isSm && categorySize) secondStyle.fontSize = categorySize;
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-center min-w-0" style={{ gap: gapXPx }}>
            <span className="inline-flex items-center min-w-0" style={{ gap: gapXPx }}>
              <span data-title-root className={`${textCls} min-w-0 truncate`} style={labelStyle}>
                {label}
              </span>
              {second && (
                <>
                  <span
                    aria-hidden
                    className={`${isSm ? "h-2.5" : "h-3.5"} shrink-0`}
                    style={{ width: 2, background: accent }}
                  />
                  <span
                    className={`${textCls} min-w-0 truncate text-muted-foreground`}
                    style={secondStyle}
                  >
                    {second}
                  </span>
                </>
              )}
            </span>
            {showRule && (
              <span
                aria-hidden
                className="flex-1 min-w-[16px]"
                style={{ height: 1, background: "currentColor", opacity: 0.16 }}
              />
            )}
            {ActionEl}
          </div>
        </div>
      );
    }

    case "ticker-strip": {
      // Pasek "na żywo": lewa krawędź w akcencie, tło wygasające w prawo,
      // pulsująca kropka z halo. Tekst monospace-owo rozstrzelony.
      const stripCls = isSm ? "px-2 py-1 gap-1.5" : "px-3 py-2 gap-2";
      const dot = isSm ? 5 : 7;
      return (
        <div
          className={`${wrapperBase} flex items-center justify-between w-full min-w-0 ${stripCls}`}
          style={{
            background: `linear-gradient(to right, color-mix(in oklab, ${accent} 16%, transparent), transparent)`,
            borderLeft: `${isSm ? 2 : 3}px solid ${accent}`,
          }}
        >
          <span className="inline-flex items-center min-w-0" style={{ gap: gapXPx }}>
            <span
              aria-hidden
              className="relative shrink-0 inline-flex items-center justify-center"
              style={{ width: dot * 2, height: dot * 2 }}
            >
              <span
                className="absolute inset-0 rounded-full nes-ticker-halo"
                style={{ background: `color-mix(in oklab, ${accent} 35%, transparent)` }}
              />
              <span
                className="relative rounded-full nes-ticker-dot"
                style={{ width: dot, height: dot, background: accent }}
              />
            </span>
            <span
              data-title-root
              className={`${isSm ? "text-[9px]" : "text-[11px] sm:text-xs"} font-bold uppercase tracking-[0.2em] min-w-0 truncate`}
              style={{ color: accent, ...labelStyle }}
            >
              {label}
            </span>
          </span>
          {ActionEl}
        </div>
      );
    }

    case "underline-sweep": {
      // Podkreślenie 2px z gradientem, animowane od lewej; szerokość
      // dopasowana do tekstu, nie do kolumny.
      const titleCls = isSm
        ? "text-[11px] tracking-[-0.01em]"
        : "font-display text-base sm:text-xl tracking-[-0.015em]";
      return (
        <div className={`${wrapperBase} w-full min-w-0 ${padY}`}>
          <div className="flex items-end justify-between min-w-0" style={{ gap: gapXPx }}>
            <span className="inline-block min-w-0">
              <span
                data-title-root
                className={`${titleCls} font-semibold break-words`}
                style={labelStyle}
              >
                {label}
              </span>
              <span
                aria-hidden
                className="block nes-underline-sweep"
                style={{
                  height: 2,
                  background: `linear-gradient(to right, ${accent}, color-mix(in oklab, ${accent} 20%, transparent))`,
                  marginTop: gapYPx,
                }}
              />
            </span>
            {ActionEl}
          </div>
        </div>
      );
    }
  }
}

function Corners({ accent, sm }: { accent: string; sm: boolean }) {
  const s = sm ? 4 : 8;
  const w = sm ? 1.5 : 2;
  const base: React.CSSProperties = {
    position: "absolute",
    width: s,
    height: s,
    borderColor: accent,
    borderStyle: "solid",
  };
  return (
    <>
      <span style={{ ...base, top: 0, left: 0, borderWidth: `${w}px 0 0 ${w}px` }} />
      <span style={{ ...base, top: 0, right: 0, borderWidth: `${w}px ${w}px 0 0` }} />
      <span style={{ ...base, bottom: 0, left: 0, borderWidth: `0 0 ${w}px ${w}px` }} />
      <span style={{ ...base, bottom: 0, right: 0, borderWidth: `0 ${w}px ${w}px 0` }} />
    </>
  );
}

function contrastOn(color: string): string {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split("")
            .map((ch) => ch + ch)
            .join("")
        : hex;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? "#0a0a0a" : "#ffffff";
  }
  return "#ffffff";
}

/**
 * Kompletny widok widgetu "section-label" (odczyt propsów + render) za jedną
 * granicą modułu - konsumowany przez lazyWidgets. SimpleWidgets renderował
 * dotąd ten moduł statycznie (readSectionLabelProps + SectionLabelRender),
 * przez co 21 wariantów etykiety (~39 kB źródeł) jechało w chunku wejściowym
 * KAŻDEJ strony. Etykieta sekcji nie jest widgetem chrome - SSR wypełnia
 * granicę Suspense, a chunk dogrzewa warmWidgetChunks (główna ścieżka
 * czytelnicza: etykiety sekcji na stronie głównej).
 */
export function SectionLabelWidgetView({
  content,
  lang,
  theme,
}: {
  content: WidgetNode["content"];
  lang: "pl" | "en";
  theme: "light" | "dark";
}) {
  const props = readSectionLabelProps(content, lang, { theme });
  return <SectionLabelRender {...props} />;
}
