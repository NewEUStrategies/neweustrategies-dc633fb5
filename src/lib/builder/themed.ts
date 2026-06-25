// Light/Dark mode value helpers - analogous to ResponsiveValue<T>.
//
// A field on a widget/section/column may be:
//   - undefined         → inherit (use Global Colors token / default)
//   - a flat value      → applies to both modes (legacy / shared)
//   - ThemedValue<T>    → { light?: T; dark?: T } per-mode override
//
// `pickMode` resolves the effective value for a given mode.
// `setMode`  writes only the slice for the active mode, migrating flat → themed
//            on first override so the OTHER mode keeps its previous value.
// `resetMode` clears the active mode's override (returns to global default).

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

export function setMode<T>(
  prev: Themed<T> | undefined,
  mode: Mode,
  value: T | undefined,
): Themed<T> | undefined {
  if (isThemedValue<T>(prev)) {
    const next: ThemedValue<T> = { ...prev, [mode]: value };
    if (next.light == null && next.dark == null) return undefined;
    return next;
  }
  // prev is a flat value (applies to both modes) or undefined.
  if (prev == null) {
    if (value == null) return undefined;
    // First write - store flat so light/dark stay in sync until the user
    // explicitly overrides one of them.
    if (mode === "light") return value;
    // Writing to dark with no prior value: stamp only dark, leave light at default.
    return { dark: value } satisfies ThemedValue<T>;
  }
  // prev is a flat value. Migrate to themed only if the new value differs
  // from what the flat already provided for this mode.
  if (value === prev) return prev;
  const other: Mode = mode === "light" ? "dark" : "light";
  if (value == null) {
    // Clearing this mode while keeping the other.
    return { [other]: prev as T } as ThemedValue<T>;
  }
  return { [other]: prev as T, [mode]: value } as ThemedValue<T>;
}

export function resetMode<T>(
  prev: Themed<T> | undefined,
  mode: Mode,
): Themed<T> | undefined {
  if (prev == null) return undefined;
  if (isThemedValue<T>(prev)) {
    const next: ThemedValue<T> = { ...prev };
    delete next[mode];
    if (next.light == null && next.dark == null) return undefined;
    return next;
  }
  // Flat value applies to both modes. Resetting "dark" means dark goes back
  // to the global default (= no override), so we lift the flat to the OTHER
  // mode and drop this mode.
  const other: Mode = mode === "light" ? "dark" : "light";
  return { [other]: prev as T } as ThemedValue<T>;
}

export function isModeOverridden<T>(v: Themed<T> | undefined, mode: Mode): boolean {
  if (v == null) return false;
  if (isThemedValue<T>(v)) return v[mode] != null;
  // Flat value counts as an override for both modes (it's user-set).
  return true;
}

/** Number of fields in a CommonStyle that carry a dark-mode override. */
export function countDarkOverrides(style: Record<string, unknown> | undefined): number {
  if (!style) return 0;
  let n = 0;
  for (const key of Object.keys(style)) {
    const v = style[key];
    if (isThemedValue(v) && (v as ThemedValue<unknown>).dark != null) n++;
  }
  return n;
}
