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
  "search-button",
  "nav-link",
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
  const css: CSSProperties = {};
  const bgColor = resolveColorForMode(s.bgColor, mode);
  if (bgColor) css.background = bgColor;
  const textColor = resolveColorForMode(s.textColor, mode);
  if (textColor) css.color = textColor;
  const padding = pick(pickMode(s.padding, mode), device);
  if (padding) css.padding = padding;
  const margin = pick(pickMode(s.margin, mode), device);
  if (margin) css.margin = margin;
  const align = pick(s.align, device);
  if (align) css.textAlign = align;
  const borderRadius = pickMode(s.borderRadius, mode);
  if (borderRadius) css.borderRadius = borderRadius;
  if (s.maxWidth) css.maxWidth = s.maxWidth;
  if (s.minHeight) css.minHeight = s.minHeight;
  const borderStyle = pickMode(s.borderStyle, mode);
  if (borderStyle && borderStyle !== "none") {
    css.borderStyle = borderStyle;
    css.borderWidth = pickMode(s.borderWidth, mode) || "1px";
    const borderColor = resolveColorForMode(s.borderColor, mode);
    if (borderColor) css.borderColor = borderColor;
  }
  const boxShadow = pickMode(s.boxShadow, mode);
  if (boxShadow) css.boxShadow = boxShadow;
  if (typeof s.opacity === "number") css.opacity = s.opacity;
  const t = pickMode<WidgetTypography>(s.typography, mode);
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
  const adv = node.advanced as { width?: ResponsiveSize; height?: ResponsiveSize } | undefined;
  const wRaw = pickSize(adv?.width, device);
  const hRaw = pickSize(adv?.height, device);

  const style: CSSProperties = {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const sj = node.style?.selfJustify;
  const saRaw = node.style?.selfAlign;
  // Default: no per-widget vertical anchor — column-level verticalAlign decides.
  const sa = !saRaw || saRaw === "auto" ? undefined : saRaw;
  const horizontalAnchored = sj && sj !== "auto";


  // When user anchors the widget horizontally, it must shrink to its content
  // so the alignSelf has visible effect (otherwise width:100% fills the column).
  const sliderShouldFill = node.type === "slider" && wRaw === undefined && !node.style?.maxWidth && !horizontalAnchored;
  const w = sliderShouldFill
    ? "100%"
    : toCssSize(wRaw) ?? node.style?.maxWidth ?? (horizontalAnchored ? "auto" : DEFAULT_WIDGET_WIDTH_BY_DEVICE[device]);
  style.width = w;
  if (sliderShouldFill) {
    style.flexBasis = "100%";
  }

  if (hRaw !== undefined) {
    style.height = toCssSize(hRaw);
  } else if (node.style?.minHeight) {
    style.minHeight = node.style.minHeight;
  }
  // No default min-height — widgets hug their content.

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
