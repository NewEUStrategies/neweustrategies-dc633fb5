// Auto-invert helpers — when a widget color was set for one mode but the page
// renders in the OTHER mode (no explicit override), heuristically flip the
// color so dark text on light background becomes light text on dark, etc.
//
// Strategy: parse to RGB, compute perceived luminance. If the color clearly
// belongs to the "wrong" side (dark color in dark mode, or light color in
// light mode), invert RGB. Mid-tone colors (brand accents, mid greys) pass
// through unchanged — they read fine on both backgrounds.

import { isThemedValue } from "./themed";
import type { Mode, Themed } from "./types";

const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  transparent: [0, 0, 0],
};

function parseColor(input: string): { r: number; g: number; b: number; a: number } | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (s === "transparent" || s === "currentcolor" || s === "inherit") return null;
  if (NAMED[s]) {
    const [r, g, b] = NAMED[s];
    return { r, g, b, a: 1 };
  }
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b, a } : null;
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b, a } : null;
    }
    return null;
  }
  // rgb(r g b) / rgb(r,g,b) / rgba(...)
  const rgbMatch = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length >= 3) {
      const r = Math.round(parseFloat(parts[0]));
      const g = Math.round(parseFloat(parts[1]));
      const b = Math.round(parseFloat(parts[2]));
      const a = parts[3] != null ? parseFloat(parts[3]) : 1;
      if ([r, g, b].every(Number.isFinite)) return { r, g, b, a };
    }
  }
  return null;
}

function relLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function format({ r, g, b, a }: { r: number; g: number; b: number; a: number }): string {
  if (a < 1) return `rgba(${r}, ${g}, ${b}, ${a})`;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Heuristically flip a color so it reads on the opposite background.
 * Returns the original string if parsing fails or color is mid-tone.
 */
export function autoInvertColor(color: string, targetMode: Mode): string {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const lum = relLuminance(rgb.r, rgb.g, rgb.b);
  // Dark mode: dark colors (lum < 0.4) need to flip light
  if (targetMode === "dark" && lum < 0.45) {
    return format({ r: 255 - rgb.r, g: 255 - rgb.g, b: 255 - rgb.b, a: rgb.a });
  }
  // Light mode: light colors (lum > 0.6) need to flip dark
  if (targetMode === "light" && lum > 0.55) {
    return format({ r: 255 - rgb.r, g: 255 - rgb.g, b: 255 - rgb.b, a: rgb.a });
  }
  return color;
}

/**
 * Resolve a Themed<string> color value for the given mode.
 * If the user did NOT set an explicit override for `mode`, the fallback
 * value is run through `autoInvertColor` so widgets adapt automatically.
 */
export function resolveColorForMode(
  v: Themed<string> | undefined,
  mode: Mode,
): string | undefined {
  if (v == null) return undefined;
  if (!isThemedValue<string>(v)) {
    // Flat value applies to both modes — auto-invert for the non-authored side.
    // We treat "light" as the authoring side by convention.
    return mode === "light" ? (v as string) : autoInvertColor(v as string, "dark");
  }
  const explicit = v[mode];
  if (explicit != null) return explicit;
  const other: Mode = mode === "light" ? "dark" : "light";
  const fallback = v[other];
  if (fallback == null) return undefined;
  return autoInvertColor(fallback, mode);
}
