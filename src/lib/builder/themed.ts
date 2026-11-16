// Light/Dark mode value helpers - analogous to ResponsiveValue<T>.
//
// A field on a widget/section/column may be:
//   - undefined         → inherit (use Global Colors token / default)
//   - a flat value      → applies to both modes (legacy / shared)
//   - ThemedValue<T>    → { light?: T; dark?: T } per-mode override
//
// `pickMode` resolves the effective value for a given mode.
//
// Zapis wartości jednego trybu (`setMode`, `resetMode`, rodzina
// `*Invertible*`) mieszka w `themedWrites.ts`: woła go wyłącznie panel
// właściwości, a ten moduł czyta renderer, więc jest w chunku startowym każdej
// strony. Nie importuj tu `themedWrites.ts` (roadmapa ładowania §9.1 J3).

import type { Mode, Themed, ThemedValue } from "./types";

export function isThemedValue<T>(v: unknown): v is ThemedValue<T> {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  // Disambiguate from ResponsiveValue (desktop/tablet/mobile) and from
  // structural objects like WidgetTypography / HoverStyle that never carry
  // top-level `light` or `dark` keys.
  return "light" in o || "dark" in o;
}

export function pickMode<T>(v: Themed<T> | undefined, mode: Mode): T | undefined {
  if (v == null) return undefined;
  if (isThemedValue<T>(v)) {
    const other: Mode = mode === "light" ? "dark" : "light";
    return v[mode] ?? v[other];
  }
  return v as T;
}

/**
 * Geometry and typography are shared by light and dark modes. Legacy documents
 * may still contain themed values, so collapse them deterministically: light
 * wins, with dark retained as a fallback when light was never authored.
 */
export function pickShared<T>(v: Themed<T> | undefined): T | undefined {
  return pickMode(v, "light") ?? pickMode(v, "dark");
}
