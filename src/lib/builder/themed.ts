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
//
// Dwie rodziny zapisu, bo renderery czytają wartość płaską na dwa sposoby:
//  * `setMode`/`resetMode`/`isModeOverridden` - płaska = TA SAMA w obu
//    trybach (`pickMode`). Tak rysują kolor kolumny (`columnColor` w
//    `BuilderRenderer`) i kolory hoveru (`hoverCss`), więc zapis jednego trybu
//    stempluje drugi jego dotychczasową wartością.
//  * `setInvertibleMode`/`resetInvertibleMode`/`isInvertibleModeOverridden`/
//    `pickInvertibleOverride` - płaska = jasny + AUTOMATYCZNE odwrócenie w
//    ciemnym (`resolveColorForMode`, ramka widgetu). Ciemny bez własnej
//    wartości nie jest nadpisany, więc edycja jasnego go nie stempluje.

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

export function resetMode<T>(prev: Themed<T> | undefined, mode: Mode): Themed<T> | undefined {
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

// ---------------------------------------------------------------------------
// Kolory ramki widgetu: wartość płaska = jasny + automatyczne odwrócenie.
//
// DECYZJA PRODUKTOWA (2026-10-19): kolor płaski (tło, tekst, obramowanie,
// ikony widgetu) to zapis trybu JASNEGO; tryb ciemny bez własnej wartości
// rysuje go odwróconego (`resolveColorForMode` w ramce widgetu). Ogólne
// `setMode` stemplowało przy edycji jasnego ciemny starą wartością płaską -
// ramka widziała wtedy jawne `dark` i przestawała odwracać (ciemny tekst na
// ciemnym tle, choć nikt trybu ciemnego nie edytował).
//
// Ta rodzina jest osobna, bo kolumna (`columnColor`) i hover (`hoverCss`)
// czytają wartość płaską przez `pickMode` BEZ odwracania - dla nich nowa
// semantyka zmieniłaby wygląd ciemnego trybu po edycji jasnego. Wynik ma
// zawsze jedną z postaci: brak, płaska (tylko jasny), `{ dark }` albo
// `{ light, dark }` - `{ light }` bez `dark` zwijamy do płaskiej, bo resolver
// rysuje obie identycznie.
// ---------------------------------------------------------------------------

/** Jawne wartości obu trybów; płaska liczy się jako zapis trybu jasnego. */
function invertibleSlices<T>(v: Themed<T> | undefined): { light?: T; dark?: T } {
  if (v == null) return {};
  if (isThemedValue<T>(v)) return { light: v.light ?? undefined, dark: v.dark ?? undefined };
  return { light: v as T };
}

/**
 * Wartość zapisana JAWNIE dla trybu (bez wartości wyliczonej przez
 * odwrócenie). Panel pokazuje ją w polu; gdy jej brak, efektywny kolor trybu
 * daje `resolveColorForMode` i panel pokazuje go jako dziedziczony.
 */
export function pickInvertibleOverride<T>(v: Themed<T> | undefined, mode: Mode): T | undefined {
  return invertibleSlices(v)[mode];
}

export function isInvertibleModeOverridden<T>(v: Themed<T> | undefined, mode: Mode): boolean {
  return pickInvertibleOverride(v, mode) != null;
}

/**
 * Zapis koloru jednego trybu: edycja jasnego na wartości płaskiej zostaje
 * płaska (ciemny dalej się odwraca), edycja ciemnego daje `{ light, dark }`,
 * a wyczyszczenie ciemnego wraca do płaskiej. Ta sama wartość co dotąd zwraca
 * TEN SAM obiekt (brak zbędnego wpisu w historii cofania).
 */
export function setInvertibleMode<T>(
  prev: Themed<T> | undefined,
  mode: Mode,
  value: T | undefined,
): Themed<T> | undefined {
  const slices = invertibleSlices(prev);
  const next = value ?? undefined;
  if (slices[mode] === next) return prev;
  const merged = { ...slices };
  merged[mode] = next;
  const { light, dark } = merged;
  if (dark == null) return light;
  return light == null ? ({ dark } as ThemedValue<T>) : ({ light, dark } as ThemedValue<T>);
}

/** Reset trybu = wyczyszczenie jego jawnej wartości (ciemny wraca do odwracania). */
export function resetInvertibleMode<T>(
  prev: Themed<T> | undefined,
  mode: Mode,
): Themed<T> | undefined {
  return setInvertibleMode(prev, mode, undefined);
}
