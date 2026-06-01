// Widget view helpers: style/frame computation + content getters.
import type { CSSProperties } from "react";
import type { WidgetNode, WidgetContent, CommonStyle, AdvancedSettings, Device } from "@/lib/builder/types";

// Default width: widgets hug their content so they sit side-by-side in a row (left-aligned).
// Max-width still capped at 100% so nothing overflows. Override per-device via advanced.width.
export const DEFAULT_WIDGET_WIDTH_BY_DEVICE: Record<Device, string> = {
  desktop: "auto",
  tablet: "auto",
  mobile: "auto",
};
export const DEFAULT_WIDGET_MIN_HEIGHT = 32;
export const AUTO_SIZE_WIDGETS = new Set(["image", "icon", "button", "spacer", "divider"]);
export const COMPACT_WIDGET_MIN_HEIGHT = 40;
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
  const autoFit = AUTO_SIZE_WIDGETS.has(node.type);

  const style: CSSProperties = {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
  };

  const w = toCssSize(wRaw) ?? node.style?.maxWidth ?? (autoFit ? "auto" : DEFAULT_WIDGET_WIDTH_BY_DEVICE[device]);
  style.width = w;

  if (hRaw !== undefined) {
    style.height = toCssSize(hRaw);
  } else if (node.style?.minHeight) {
    style.minHeight = node.style.minHeight;
  } else if (COMPACT_WIDGET_TYPES.has(node.type)) {
    style.minHeight = COMPACT_WIDGET_MIN_HEIGHT;
  } else if (!autoFit) {
    style.minHeight = DEFAULT_WIDGET_MIN_HEIGHT;
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
