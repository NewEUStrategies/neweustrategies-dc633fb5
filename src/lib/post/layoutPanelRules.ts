// Reguły panelu układów wpisu (/admin/post-layouts).
//
// Panel liczył je wprost w JSX, w komponencie zadeklarowanym WEWNĄTRZ funkcji
// trasy (`LayoutGrid` w ciele `Page`): taki komponent powstaje od nowa przy
// każdym renderze, nie da się go zaimportować ani przetestować, a React traci
// jego stan przy każdej zmianie nadrzędnej. Reguły siedzą teraz tutaj, wygląd
// w molekułach.
import {
  AUDIO_LAYOUTS,
  GALLERY_LAYOUTS,
  STANDARD_LAYOUTS,
  VIDEO_LAYOUTS,
  effectiveHasSidebar,
  type LayoutPreset,
  type PostLayoutSettings,
} from "@/lib/postLayouts";
import type { NumberBounds } from "@/lib/admin/panelDraft";

/** Cztery grupy układów panelu: po jednej na format wpisu. */
export interface LayoutGroupDescriptor {
  /** Pole ustawień z wybranym układem grupy. */
  readonly field: "standard_layout" | "video_layout" | "audio_layout" | "gallery_layout";
  readonly titleKey: string;
  readonly presets: readonly LayoutPreset[];
}

export function layoutGroups(): LayoutGroupDescriptor[] {
  return [
    {
      field: "standard_layout",
      titleKey: "adminLayouts.postLayouts.group.standard",
      presets: STANDARD_LAYOUTS,
    },
    {
      field: "video_layout",
      titleKey: "adminLayouts.postLayouts.group.video",
      presets: VIDEO_LAYOUTS,
    },
    {
      field: "audio_layout",
      titleKey: "adminLayouts.postLayouts.group.audio",
      presets: AUDIO_LAYOUTS,
    },
    {
      field: "gallery_layout",
      titleKey: "adminLayouts.postLayouts.group.gallery",
      presets: GALLERY_LAYOUTS,
    },
  ];
}

/**
 * Wybrany preset grupy, z jawnym zejściem na pierwszy z listy.
 *
 * Wartość z bazy może wskazywać układ, którego już nie ma (zmiana katalogu
 * presetów, migracja) - bez tego zejścia panel przewracałby się na `undefined`
 * przy czytaniu `selected.label`.
 */
export function selectedPreset(
  presets: readonly LayoutPreset[],
  value: string,
): LayoutPreset | undefined {
  return presets.find((p) => p.id === value) ?? presets[0];
}

/**
 * Czy dany preset stoi w tej chwili z sidebarem.
 *
 * WYBRANY preset czyta się przez `effectiveHasSidebar` (nadpisanie globalne albo
 * domyślna wartość presetu), a NIEWYBRANY - wprost z mapy nadpisań. Dwie
 * ścieżki, bo tylko wybrany bierze udział w rozstrzygnięciu na wpisie.
 */
export function presetHasSidebar(
  preset: LayoutPreset,
  settings: PostLayoutSettings,
  isSelected: boolean,
): boolean {
  if (isSelected) return effectiveHasSidebar(preset, settings);
  const override = settings.layout_sidebar_overrides?.[preset.id];
  return typeof override === "boolean" ? override : preset.hasSidebar;
}

/**
 * Łata stanu po wyborze wariantu karty: układ ORAZ nadpisanie sidebara
 * w JEDNYM obiekcie.
 *
 * Dwa osobne wywołania `setLocal` czytałyby ten sam, nieodświeżony stan
 * z domknięcia, więc drugie kasowałoby pierwsze - stąd jedna łata zamiast dwóch.
 */
export function pickVariantPatch(
  field: LayoutGroupDescriptor["field"],
  presetId: string,
  withSidebar: boolean,
  // Typ w schemacie jest nieopcjonalny, ale wiersze zapisane przed dodaniem
  // kolumny mapy nie mają - stąd jawne dopuszczenie braku.
  overrides: PostLayoutSettings["layout_sidebar_overrides"] | null | undefined,
): Partial<PostLayoutSettings> {
  return {
    [field]: presetId,
    layout_sidebar_overrides: { ...(overrides ?? {}), [presetId]: withSidebar },
  } as Partial<PostLayoutSettings>;
}

/** Pola proporcji obrazu wyróżniającego edytowane w panelu. */
export const FEATURED_RATIO_FIELDS = [
  "featured_ratio_l6",
  "featured_ratio_l10",
  "featured_ratio_l11",
] as const;

export type FeaturedRatioField = (typeof FEATURED_RATIO_FIELDS)[number];

/** Granice proporcji w procentach - kadr nie może zniknąć ani przerosnąć strony. */
export const FEATURED_RATIO_BOUNDS: NumberBounds = { min: 10, max: 200 };

/** Numer układu wyciągnięty z nazwy pola proporcji (`featured_ratio_l6` -> `6`). */
export function featuredRatioLayoutNumber(field: FeaturedRatioField): string {
  return field.replace("featured_ratio_l", "");
}

export interface SettingToggleDescriptor {
  readonly field: keyof PostLayoutSettings;
  readonly labelKey: string;
}

/** Przełączniki centrowania nagłówka. */
export function headerToggles(): SettingToggleDescriptor[] {
  return [
    { field: "center_header", labelKey: "adminLayouts.postLayouts.centerTitle" },
    { field: "center_entry_meta", labelKey: "adminLayouts.postLayouts.centerMeta" },
  ];
}

/** Przełączniki stopki wpisu - dziewięć elementów pod treścią. */
export function footerToggles(): SettingToggleDescriptor[] {
  return [
    { field: "show_post_tags_bar", labelKey: "adminLayouts.postLayouts.tagsBar" },
    { field: "show_author_card", labelKey: "adminLayouts.postLayouts.authorCard" },
    { field: "show_prev_next", labelKey: "adminLayouts.postLayouts.prevNext" },
    { field: "prev_next_mobile_hide", labelKey: "adminLayouts.postLayouts.hidePaginationMobile" },
    { field: "show_bottom_newsletter", labelKey: "adminLayouts.postLayouts.bottomNewsletter" },
    { field: "show_floating_share_bar", labelKey: "adminLayouts.postLayouts.floatingShare" },
    { field: "show_citation", labelKey: "adminLayouts.postLayouts.citationBox" },
    { field: "show_quote_share", labelKey: "adminLayouts.postLayouts.quoteShare" },
    { field: "auto_load_next_post", labelKey: "adminLayouts.postLayouts.autoLoadNext" },
  ];
}

export interface TypographyRow {
  readonly field: keyof PostLayoutSettings;
  readonly labelKey: string;
  readonly bounds: NumberBounds;
}

export interface TypographyGroup {
  readonly headingKey: string;
  readonly hintKey: string;
  readonly rows: readonly TypographyRow[];
}

const BREAKPOINTS = [
  ["base", "adminLayouts.postLayouts.breakpoint.mobile"],
  ["md", "adminLayouts.postLayouts.breakpoint.tablet"],
  ["lg", "adminLayouts.postLayouts.breakpoint.desktop"],
] as const;

function typographyRows(prefix: string, bounds: NumberBounds): TypographyRow[] {
  return BREAKPOINTS.map(([suffix, labelKey]) => ({
    field: `${prefix}_${suffix}` as keyof PostLayoutSettings,
    labelKey,
    bounds,
  }));
}

/**
 * Cztery grupy typografii, po trzy punkty przełamania każda.
 *
 * Nazwa pola powstaje z prefiksu i punktu przełamania, więc dwanaście wierszy
 * nie ma jak się rozjechać z nazwami kolumn - poprzednia wersja panelu
 * wypisywała je z ręki, po jednym.
 */
export function typographyGroups(): TypographyGroup[] {
  return [
    {
      headingKey: "adminLayouts.postLayouts.typoOverlayTitleHeading",
      hintKey: "adminLayouts.postLayouts.typoOverlayTitleHint",
      rows: typographyRows("overlay_title_size", { min: 12, max: 96 }),
    },
    {
      headingKey: "adminLayouts.postLayouts.typoOverlayExcerptHeading",
      hintKey: "adminLayouts.postLayouts.typoOverlayExcerptHint",
      rows: typographyRows("overlay_excerpt_size", { min: 8, max: 48 }),
    },
    {
      headingKey: "adminLayouts.postLayouts.typoHeaderTitleHeading",
      hintKey: "adminLayouts.postLayouts.typoHeaderTitleHint",
      rows: typographyRows("header_title_size", { min: 14, max: 128 }),
    },
    {
      headingKey: "adminLayouts.postLayouts.typoHeaderExcerptHeading",
      hintKey: "adminLayouts.postLayouts.typoHeaderExcerptHint",
      rows: typographyRows("header_excerpt_size", { min: 8, max: 48 }),
    },
  ];
}

/** Wartość liczbowa pola ustawień, z zerem dla pola nieustawionego. */
export function numericSetting(
  settings: PostLayoutSettings,
  field: keyof PostLayoutSettings,
): number {
  return Number(settings[field] ?? 0);
}

export interface PresetSummaryRow {
  readonly labelKey: string;
  /** Wartość techniczna do pokazania wprost (tryb nagłówka, rozmiar grafiki). */
  readonly value?: string;
  /** Klucz wartości, gdy jest ona jednym z dwóch stanów (tak/nie, widoczna/ukryta). */
  readonly valueKey?: string;
}

/**
 * Podsumowanie wybranego presetu w podglądzie.
 *
 * Zwraca WIERSZE OPISOWE, nie gotowy tekst: nazwy pól i stany są kluczami,
 * a wartości techniczne (tryb nagłówka, tryb okładki, rozmiar grafiki) idą jako
 * identyfikatory - te ostatnie nie są tekstem dla użytkownika i nie mają czego
 * wnieść do słownika.
 */
export function presetSummary(
  preset: LayoutPreset,
  settings: PostLayoutSettings,
  hasSidebar: boolean,
): PresetSummaryRow[] {
  const rows: PresetSummaryRow[] = [
    { labelKey: "adminLayouts.postLayouts.headerRow", value: preset.header },
    { labelKey: "adminLayouts.postLayouts.coverRow", value: preset.cover },
    {
      labelKey: "adminLayouts.postLayouts.sidebarRow",
      valueKey: hasSidebar
        ? "adminLayouts.postLayouts.sidebarYes"
        : "adminLayouts.postLayouts.sidebarNo",
    },
    {
      labelKey: "adminLayouts.postLayouts.excerptRow",
      valueKey:
        preset.showExcerpt === false
          ? "adminLayouts.postLayouts.excerptHidden"
          : "adminLayouts.postLayouts.excerptShown",
    },
  ];
  if (preset.contentMaxWidth) {
    rows.push({
      labelKey: "adminLayouts.postLayouts.contentWidthRow",
      value: String(preset.contentMaxWidth),
    });
  }
  if (preset.featuredRatioKey) {
    rows.push({
      labelKey: "adminLayouts.postLayouts.ratioRow",
      value: `${settings[preset.featuredRatioKey]}%`,
    });
  }
  if (preset.recommendedImage) {
    const { width, height, ratio } = preset.recommendedImage;
    rows.push({
      labelKey: "adminLayouts.postLayouts.graphic",
      value: ratio ? `${width}×${height}px · ${ratio}` : `${width}×${height}px`,
    });
  }
  return rows;
}

/** Rozmiar rekomendowanej grafiki presetu albo `null`, gdy preset go nie ma. */
export function recommendedImageBadge(preset: LayoutPreset): string | null {
  if (!preset.recommendedImage) return null;
  return `${preset.recommendedImage.width}×${preset.recommendedImage.height}`;
}
