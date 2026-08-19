// Reguły panelu konfiguracji silnika rekomendacji.
//
// ZASADA JAK W POZOSTAŁYCH PANELACH MODUŁU: deskryptor zwraca WARTOŚĆ i KLUCZ
// i18n. Ten panel miał już pełny słownik, ale listy opcji i wagi sygnałów były
// rozpisane wprost w JSX - sześć wariantów układu, cztery źródła doboru i
// siedem suwaków jako siedem osobnych wywołań z ręcznie sklejonymi kluczami.
// Rozjazd nazwy pola z kluczem podpowiedzi nie miał jak być zauważony.
import { RELATED_POSTS_LIMITS, type RelatedPostsSaveFailure } from "@/lib/relatedPosts/settings";
import type { RelatedPostsConfig } from "@/lib/relatedPosts";
import type { NumberBounds } from "@/lib/admin/panelDraft";

/** Granice pól liczbowych panelu - te same, których pilnuje warstwa zapisu. */
export const RELATED_POSTS_BOUNDS: Readonly<Record<string, NumberBounds>> = RELATED_POSTS_LIMITS;

/** Krok pola interwału autoplaya - pół sekundy. */
export const SLIDER_INTERVAL_STEP = 500;

export interface OptionDescriptor<T extends string> {
  readonly value: T;
  readonly labelKey: string;
}

/** Gdzie sekcja rekomendacji ma stanąć na wpisie. */
export function positionOptions(): OptionDescriptor<RelatedPostsConfig["position"]>[] {
  return [
    { value: "end", labelKey: "adminRelatedPosts.position.end" },
    { value: "sidebar", labelKey: "adminRelatedPosts.position.sidebar" },
    { value: "after_paragraph", labelKey: "adminRelatedPosts.position.afterParagraph" },
  ];
}

/** Sześć układów listy rekomendacji. */
export function layoutOptions(): OptionDescriptor<RelatedPostsConfig["layout"]>[] {
  return (["grid", "list", "slider", "cards", "magazine", "timeline"] as const).map((value) => ({
    value,
    labelKey: `adminRelatedPosts.layout.${value}`,
  }));
}

/** Dozwolone liczby kolumn siatki. */
export const RELATED_POSTS_COLUMN_CHOICES = [2, 3, 4] as const;

/** Skąd dobierać kandydatów do rekomendacji. */
export function sourceStrategyOptions(): OptionDescriptor<RelatedPostsConfig["source_strategy"]>[] {
  return (["both", "categories", "tags", "author"] as const).map((value) => ({
    value,
    labelKey: `adminRelatedPosts.source.${value}`,
  }));
}

export interface WeightSignalDescriptor {
  /** Pole konfiguracji z wagą sygnału. */
  readonly field: keyof RelatedPostsConfig;
  readonly labelKey: string;
  readonly hintKey: string;
}

/**
 * Siedem sygnałów silnika doboru, w kolejności wyświetlania.
 *
 * Nazwa pola, klucz etykiety i klucz podpowiedzi pochodzą z JEDNEGO wpisu -
 * poprzednia wersja panelu sklejała je osobno w siedmiu wywołaniach, więc
 * podpowiedź mogła opisywać inny sygnał niż suwak, który zmieniała.
 */
export function weightSignals(): WeightSignalDescriptor[] {
  return (
    [
      ["weight_categories", "categories"],
      ["weight_tags", "tags"],
      ["weight_author", "author"],
      ["weight_recency", "recency"],
      ["weight_popularity", "popularity"],
      ["weight_dwell", "dwell"],
      ["weight_personalization", "personalization"],
    ] as const
  ).map(([field, slug]) => ({
    field,
    labelKey: `adminRelatedPosts.engine.${slug}`,
    hintKey: `adminRelatedPosts.engine.${slug}Hint`,
  }));
}

/**
 * Czy pole „po którym akapicie" ma sens.
 *
 * Wartość jest zapisywana zawsze, ale poza pozycją `after_paragraph` nic z niej
 * nie wynika - pole zostaje więc wyłączone, żeby nie sugerowało działania.
 */
export function afterParagraphEnabled(position: RelatedPostsConfig["position"]): boolean {
  return position === "after_paragraph";
}

/** Czy interwał przewijania ma sens (tylko przy włączonym autoplayu). */
export function sliderIntervalEnabled(autoplay: boolean): boolean {
  return autoplay === true;
}

/**
 * Klucz komunikatu nieudanego zapisu.
 *
 * Reguła zwraca KLUCZ, nie gotowe zdanie - inaczej test przyczyny („nie ma
 * obszaru roboczego" kontra „zapis nie utrwalił wiersza") pękałby przy każdej
 * korekcie brzmienia, a EN zostawałby z tyłu.
 */
export function saveFailureKey(reason: RelatedPostsSaveFailure): string {
  return SAVE_FAILURE_KEYS[reason];
}

const SAVE_FAILURE_KEYS: Readonly<Record<RelatedPostsSaveFailure, string>> = {
  no_tenant: "adminRelatedPosts.toast.noTenant",
  tenant_lookup_failed: "adminRelatedPosts.toast.tenantLookupFailed",
  write_failed: "adminRelatedPosts.toast.writeFailed",
  not_persisted: "adminRelatedPosts.toast.notPersisted",
};

/** Wszystkie rozpoznawane przyczyny - do testu kompletności mapy. */
export const SAVE_FAILURE_REASONS = Object.keys(SAVE_FAILURE_KEYS) as RelatedPostsSaveFailure[];
