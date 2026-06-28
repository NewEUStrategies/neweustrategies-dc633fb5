// Widget view helpers: style/frame computation + content getters.
import type { CSSProperties } from "react";
import type {
  WidgetNode, WidgetContent, CommonStyle, AdvancedSettings, Device, Mode,
  WidgetTypography, HoverStyle,
} from "@/lib/builder/types";
import { pickMode } from "@/lib/builder/themed";
import { resolveColorForMode } from "@/lib/builder/autoInvertColor";

// Default width: widgets fill the full column width unless an explicit width
// is set or the widget type is intrinsic (image/icon/button/spacer/divider).
export const DEFAULT_WIDGET_WIDTH_BY_DEVICE: Record<Device, string> = {
  desktop: "100%",
  tablet: "100%",
  mobile: "100%",
};
export const DEFAULT_WIDGET_MIN_HEIGHT = 0;
export const AUTO_SIZE_WIDGETS = new Set(["image", "icon", "button", "spacer", "divider"]);
export const COMPACT_WIDGET_MIN_HEIGHT = 0;
export const COMPACT_ICON_BOX_SIZE = 40;
export const COMPACT_WIDGET_TYPES = new Set([
  "social-icons",
  "lang-switcher",
  "theme-toggle",
  "account-link",
  "nav-link",
  "mega-menu",
  "newsletter",
]);

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
  mode: Mode = "light",
): CSSProperties => {
  if (!s) return {};
  // Layout properties (padding, margin, sizes, typography metrics, radii,
  // border widths, opacity) must NOT change when toggling light/dark - only
  // colors do. We collapse themed values to a single shared value by
  // preferring light and falling back to dark.
  const css: CSSProperties = {};
  const bgColor = resolveColorForMode(s.bgColor, mode);
  if (bgColor) css.background = bgColor;
  const textColor = resolveColorForMode(s.textColor, mode);
  if (textColor) css.color = textColor;
  const padding = pick(pickMode(s.padding, "light") ?? pickMode(s.padding, "dark"), device);
  if (padding) css.padding = padding;
  const margin = pick(pickMode(s.margin, "light") ?? pickMode(s.margin, "dark"), device);
  if (margin) css.margin = margin;
  const align = pick(s.align, device);
  if (align) css.textAlign = align;
  const borderRadius = pickMode(s.borderRadius, "light") ?? pickMode(s.borderRadius, "dark");
  if (borderRadius) css.borderRadius = borderRadius;
  if (s.maxWidth) css.maxWidth = s.maxWidth;
  if (s.minHeight) css.minHeight = s.minHeight;
  const borderStyle = pickMode(s.borderStyle, "light") ?? pickMode(s.borderStyle, "dark");
  if (borderStyle && borderStyle !== "none") {
    css.borderStyle = borderStyle;
    css.borderWidth = (pickMode(s.borderWidth, "light") ?? pickMode(s.borderWidth, "dark")) || "1px";
    const borderColor = resolveColorForMode(s.borderColor, mode);
    if (borderColor) css.borderColor = borderColor;
  }
  const boxShadow = pickMode(s.boxShadow, "light") ?? pickMode(s.boxShadow, "dark");
  if (boxShadow) css.boxShadow = boxShadow;
  if (typeof s.opacity === "number") css.opacity = s.opacity;
  const t = pickMode<WidgetTypography>(s.typography, "light") ?? pickMode<WidgetTypography>(s.typography, "dark");
  if (t) {
    if (t.fontFamily) css.fontFamily = t.fontFamily;
    // Do not set the title font-size on the widget wrapper. Post widgets map
    // title/description sizes to `.cms-post-title` / `.cms-post-excerpt` via
    // scoped CSS in WidgetView, while non-post text also gets descendant rules.
    // A wrapper-level fontSize made the cascade ambiguous and duplicated the
    // source of truth.
    if (t.fontWeight) css.fontWeight = t.fontWeight;
    if (t.fontStyle) css.fontStyle = t.fontStyle;
    if (t.lineHeight) css.lineHeight = t.lineHeight;
    if (t.letterSpacing) css.letterSpacing = t.letterSpacing;
    if (t.textTransform) css.textTransform = t.textTransform;
    if (t.textDecoration) css.textDecoration = t.textDecoration;
  }
  return css;
};

// Re-export so consumers don't need a separate import.
export type { HoverStyle };


type ResponsiveSize = number | "auto" | { desktop?: number | "auto"; tablet?: number | "auto"; mobile?: number | "auto" } | undefined;

function pickSize(value: ResponsiveSize, device: Device): number | "auto" | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" || value === "auto") return value;
  return value[device] ?? value.desktop ?? value.tablet ?? value.mobile;
}

function toCssSize(value: number | "auto" | undefined): string | number | undefined {
  if (value === undefined) return undefined;
  return value === "auto" ? "auto" : value;
}

export const getWidgetFrameStyle = (node: WidgetNode, device: Device = "desktop"): CSSProperties => {
  const adv = node.advanced as { width?: ResponsiveSize; height?: ResponsiveSize; layout?: "block" | "inline" } | undefined;
  const wRaw = pickSize(adv?.width, device);
  const hRaw = pickSize(adv?.height, device);
  const isInline = adv?.layout === "inline";
  const shouldAlwaysFillColumn = node.type === "post-list" || node.type === "carousel";

  const style: CSSProperties = {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const sj = node.style?.selfJustify;
  const saRaw = node.style?.selfAlign;
  // Default: no per-widget vertical anchor - column-level verticalAlign decides.
  const sa = !saRaw || saRaw === "auto" ? undefined : saRaw;
  const horizontalAnchored = sj && sj !== "auto";


  // When user anchors the widget horizontally OR opted into inline flow, it
  // must shrink to its content so siblings can sit next to it.
  // Exception: the search widget always fills the full column width.
  const isSearch = node.type === "search-button";
  const shrinkToContent = !isSearch && !shouldAlwaysFillColumn && (horizontalAnchored || isInline);
  const sliderShouldFill = node.type === "slider" && wRaw === undefined && !node.style?.maxWidth && !shrinkToContent;
  const searchShouldFill = isSearch && wRaw === undefined;
  const w = sliderShouldFill || searchShouldFill
    ? "100%"
    : toCssSize(wRaw) ?? node.style?.maxWidth ?? (shrinkToContent ? "auto" : DEFAULT_WIDGET_WIDTH_BY_DEVICE[device]);
  // On narrow viewports clamp pixel widths so widgets shrink with the column.
  if (device !== "desktop" && typeof w === "number") {
    style.width = `min(100%, ${w}px)`;
  } else if (device !== "desktop" && typeof w === "string" && /\d(px|rem|em)$/.test(w)) {
    style.width = `min(100%, ${w})`;
  } else {
    style.width = w;
  }
  if (isInline && wRaw === undefined && !node.style?.maxWidth && !isSearch) {
    style.flex = "0 0 auto";
  }
  if (sliderShouldFill || searchShouldFill) {
    style.flexBasis = "100%";
  }
  if (shouldAlwaysFillColumn && wRaw === undefined && !node.style?.maxWidth) {
    style.width = "100%";
    style.maxWidth = "100%";
    style.flexBasis = "100%";
  }

  if (hRaw !== undefined) {
    style.height = toCssSize(hRaw);
  } else if (node.style?.minHeight) {
    style.minHeight = node.style.minHeight;
  }
  // No default min-height - widgets hug their content.

  // Horizontal alignment (cross axis in a flex-col column).
  if (horizontalAnchored) {
    style.alignSelf =
      sj === "start" ? "flex-start" :
      sj === "end" ? "flex-end" :
      "center";
  }

  // Vertical alignment inside the column (uses auto margins so it works in
  // flex-col regardless of the column's align-items setting).
  if (sa) {
    if (sa === "stretch") {
      style.flexGrow = 1;
      style.alignSelf = horizontalAnchored ? style.alignSelf : "stretch";
      style.height = "auto";
    } else if (sa === "center") {
      style.marginTop = "auto";
      style.marginBottom = "auto";
    } else if (sa === "end") {
      style.marginTop = "auto";
      style.marginBottom = 0;
    } else if (sa === "start") {
      style.marginTop = 0;
      style.marginBottom = "auto";
    }
  }


  return style;
};

export const hiddenOnDevice = (a: AdvancedSettings | undefined, device: Device): boolean =>
  Boolean(a?.hideOn?.[device]);

// -------- content getters --------

/** Shared UI language for widget renderers. */
export type Lang = "pl" | "en";

export function getStr(c: WidgetContent, k: string): string {
  const v = c[k];
  return typeof v === "string" ? v : "";
}

export function getNum(c: WidgetContent, k: string, dflt: number): number {
  const v = c[k];
  return typeof v === "number" ? v : dflt;
}

export function getStrArr(c: WidgetContent, k: string): string[] {
  const v = c[k];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function normalizeNewsletterVariant(value: string): string {
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
