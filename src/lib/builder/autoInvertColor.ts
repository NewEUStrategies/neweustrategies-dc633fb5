// Auto-invert helpers - when a widget color was set for one mode but the page
// renders in the OTHER mode (no explicit override), heuristically flip the
// color so dark text on light background becomes light text on dark, etc.
//
// Strategy: parse to RGB, compute perceived luminance. If the color clearly
// belongs to the "wrong" side (dark color in dark mode, or light color in
// light mode), invert RGB. Mid-tone colors (brand accents, mid greys) pass
// through unchanged - they read fine on both backgrounds.

import { parseColorChannels, type RgbaChannels } from "./cssColor";
import { isThemedValue } from "./themed";
import type { Mode, Themed } from "./types";

// Słowa kluczowe, które da się policzyć bez layoutu. `transparent`,
// `currentcolor` i `inherit` celowo NIE są tu wpisane: ich wartość zna
// dopiero przeglądarka, więc wracają bez zmian.
const NAMED: Readonly<Record<string, readonly [number, number, number]>> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
};

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

/**
 * Kanały koloru albo `null`, gdy zapisu nie da się policzyć lokalnie. Parser
 * jest wspólny z luminancją podświetlenia ikon social (`parseColorChannels`),
 * więc odwracanie rozumie te same zapisy, które `safeWidgetColor` przepuszcza
 * do `style`: procenty kanałów i alfy oraz `hsl()`. Słowa kluczowe szukamy
 * WYŁĄCZNIE po kluczach własnych - „constructor" z prototypu `Object` nie może
 * udawać koloru.
 */
function parseColor(input: string): RgbaChannels | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  if (Object.hasOwn(NAMED, s)) {
    const [r, g, b] = NAMED[s];
    return { r, g, b, a: 1 };
  }
  const rgba = parseColorChannels(s);
  if (!rgba) return null;
  // CSS przycina kanały i alfę spoza zakresu - liczymy na wartościach, które
  // przeglądarka faktycznie narysuje.
  return {
    r: clamp(rgba.r, 255),
    g: clamp(rgba.g, 255),
    b: clamp(rgba.b, 255),
    a: clamp(rgba.a, 1),
  };
}

function relLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** Kolor odwrócony; kanały z `hsl()` i procentów są ułamkowe, więc zaokrąglamy. */
function invert({ r, g, b, a }: RgbaChannels): string {
  const flip = (channel: number) => Math.round(255 - channel);
  const rgb = `${flip(r)}, ${flip(g)}, ${flip(b)}`;
  return a < 1 ? `rgba(${rgb}, ${a})` : `rgb(${rgb})`;
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
  if (targetMode === "dark" && lum < 0.45) return invert(rgb);
  // Light mode: light colors (lum > 0.6) need to flip dark
  if (targetMode === "light" && lum > 0.55) return invert(rgb);
  return color;
}

/**
 * Resolve a Themed<string> color value for the given mode.
 * If the user did NOT set an explicit override for `mode`, the fallback
 * value is run through `autoInvertColor` so widgets adapt automatically.
 */
export function resolveColorForMode(v: Themed<string> | undefined, mode: Mode): string | undefined {
  if (v == null) return undefined;
  if (!isThemedValue<string>(v)) {
    // Flat value applies to both modes - auto-invert for the non-authored side.
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
