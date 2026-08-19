// Reguły układu huba eksperta - czysta warstwa, wyprowadzona z komponentów.
//
// DLACZEGO. Audyt 18.08 (MODUŁ 7) pokazał huby ekspertów jako 808 linii przy
// 11 z 23 plików na zerze, a dwa największe pliki tej powierzchni -
// `ExpertLayoutRenderer.tsx` (1172 linie) i `ExpertLayoutInlineEditor.tsx`
// (577) - nie miały ani jednego wykonania. Reguły domenowe układu żyły już
// w `lib/expertLayouts.ts` (presety, kolejność sekcji, sanityzacja koloru)
// i miały testy; w komponentach zostały trzy, które testów nie miały,
// a niosą skutki widoczne dla użytkownika ORAZ dwie zapory bezpieczeństwa:
//
//   * `expertLayoutCssVars` - wartości od EKSPERTA (inline-edytor) lądują
//     w tokenach CSS wstrzykiwanych do `<style>`;
//   * `expertLayoutScopeCss` - `scopeId` wchodzi do SELEKTORA w surowym CSS;
//   * `overridesSignature` - decyduje, czy przycisk „Zapisz" jest aktywny.
//
// Wszystkie trzy są czystymi funkcjami, więc jedynym powodem, dla którego
// nie miały testów, było ich MIEJSCE. Renderer i edytor re-eksportują je
// dalej, żeby nie ruszać wywołań.
import type { CSSProperties } from "react";
import {
  DEFAULT_EXPERT_SECTION_ORDER,
  isSectionVisible,
  sanitizeCssColor,
  type ExpertLayoutOverrides,
  type ExpertLayoutSettings,
  type ExpertSectionKey,
} from "@/lib/expertLayouts";

/** Najmniejszy czytelny rozmiar nazwiska i roli w hero (px). */
const MIN_NAME_PX = 12;
const MIN_ROLE_PX = 10;

/** Rozmiary domyślne, gdy redakcja nie ustawiła własnych. */
const DEFAULT_NAME_BASE = 28;
const DEFAULT_NAME_LG = 44;
const DEFAULT_ROLE_BASE = 14;
const DEFAULT_ROLE_LG = 18;

/** Zakres okna, w którym rozmiar rośnie płynnie (px szerokości ekranu). */
const FLUID_MIN_VW = 375;
const FLUID_MAX_VW = 1200;

function fluidClamp(base: number, lg: number): string {
  return `clamp(${base}px, calc(${base}px + (${lg} - ${base}) * ((100vw - ${FLUID_MIN_VW}px) / (${FLUID_MAX_VW} - ${FLUID_MIN_VW}))), ${lg}px)`;
}

/**
 * Tokeny `--pv-*` układu eksperta.
 *
 * SANITYZACJA JEST NA WYJŚCIU, nie tylko przy zapisie, i to jest cała reguła
 * bezpieczeństwa tej funkcji: od czasu inline-edytora kolory pochodzą także
 * od EKSPERTÓW, a wartość trafia do scoped `<style>` przez
 * `dangerouslySetInnerHTML`. Zły kolor degraduje się do tokenu motywu,
 * zamiast domykać deklarację i dopisywać własne reguły.
 *
 * `theme` dobiera warianty `*_dark`.
 */
export function expertLayoutCssVars(
  settings: ExpertLayoutSettings,
  theme: "light" | "dark" = "light",
): CSSProperties {
  const dark = theme === "dark";
  const accent = sanitizeCssColor(dark ? settings.accent_color_dark : settings.accent_color);
  const bioBullet = sanitizeCssColor(
    dark ? settings.bio_bullet_color_dark : settings.bio_bullet_color,
  );
  const heroBg = sanitizeCssColor(dark ? settings.hero_bg_color_dark : settings.hero_bg_color);
  const heroText = sanitizeCssColor(
    dark ? settings.hero_text_color_dark : settings.hero_text_color,
  );

  // Rozmiar „lg" nie może zejść poniżej „base" - odwrócona para dałaby
  // `clamp()` z minimum większym od maksimum, co przeglądarki rozstrzygają
  // różnie (nagłówek raz rośnie, raz się zapada).
  const nameBase = Math.max(MIN_NAME_PX, settings.name_size_base || DEFAULT_NAME_BASE);
  const nameLg = Math.max(nameBase, settings.name_size_lg || DEFAULT_NAME_LG);
  const roleBase = Math.max(MIN_ROLE_PX, settings.role_size_base || DEFAULT_ROLE_BASE);
  const roleLg = Math.max(roleBase, settings.role_size_lg || DEFAULT_ROLE_LG);

  return {
    "--pv-accent": accent ?? "hsl(var(--brand))",
    "--pv-bio-bullet": bioBullet ?? accent ?? "hsl(var(--brand))",
    "--pv-hero-bg": heroBg ?? "transparent",
    "--pv-hero-text": heroText ?? "inherit",
    "--pv-name-size-base": `${nameBase}px`,
    "--pv-name-size-lg": `${nameLg}px`,
    "--pv-name-size": fluidClamp(nameBase, nameLg),
    "--pv-role-size": fluidClamp(roleBase, roleLg),
    "--pv-max-width": `${settings.max_width}px`,
  } as CSSProperties;
}

/**
 * Reguła CSS z nadpisaniem tokenów dla trybu ciemnego, ograniczona do jednego
 * wrappera.
 *
 * `scopeId` wchodzi do SELEKTORA w surowym CSS, więc jest przycinany do
 * bezpiecznego alfabetu. Dziś to uuid tenanta, ale funkcja nie ma prawa
 * zakładać, kto ją zawoła jutro: bez przycięcia wartość z cudzysłowem
 * domknęłaby atrybut i blok reguły, dopisując dowolne CSS do strony.
 */
export function expertLayoutScopeCss(scopeId: string, settings: ExpertLayoutSettings): string {
  const safeScopeId = scopeId.replace(/[^a-zA-Z0-9_-]/g, "");
  const dark = expertLayoutCssVars(settings, "dark") as Record<string, string>;
  const decls = Object.entries(dark)
    .map(([key, value]) => `${key}: ${value};`)
    .join(" ");
  return `.dark [data-pv-scope="${safeScopeId}"]{${decls}}`;
}

/**
 * Sekcje huba w kolejności renderowania, z pominięciem wyłączonych.
 *
 * Zwraca KLUCZE, nie gotowe nagłówki - dzięki temu test kolejności nie zmienia
 * się, gdy redakcja przepisze etykiety, a wywołujący sam decyduje, skąd bierze
 * napisy.
 */
export function visibleExpertSections(settings: ExpertLayoutSettings): ExpertSectionKey[] {
  const order =
    settings.section_order.length > 0 ? settings.section_order : DEFAULT_EXPERT_SECTION_ORDER;
  return order.filter((key) => isSectionVisible(settings, key));
}

/**
 * Kanoniczna sygnatura nadpisań - stabilny dirty-check niezależny od kolejności
 * wstawiania kluczy (settery robią delete/add, więc `JSON.stringify` samego
 * obiektu dawałby różne napisy dla tego samego stanu i przycisk „Zapisz"
 * świeciłby się bez żadnej zmiany).
 */
export function overridesSignature(overrides: ExpertLayoutOverrides | null): string {
  if (!overrides) return "null";
  return JSON.stringify({
    preset: overrides.preset ?? null,
    section_order: overrides.section_order ?? null,
    center_hero: overrides.center_hero ?? null,
    center_details: overrides.center_details ?? null,
    accent_color: overrides.accent_color ?? null,
    accent_color_dark: overrides.accent_color_dark ?? null,
    visibility: Object.entries(overrides.visibility ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  });
}
