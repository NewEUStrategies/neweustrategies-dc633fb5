// Czysty moduł domeny stanowisk państw członkowskich UE (explorer trackera).
// Zero zależności od React/Supabase - kody ISO2 muszą pokrywać się z CHECK-iem
// kolumny eu_policy_positions.country_code ORAZ z identyfikatorami krajów w
// zasobie geometrii public/geo/europe-50m.v1.json (oba używają ISO 3166-1
// alpha-2), czego pilnuje test jednostkowy.

export interface EuCountry {
  code: string;
  pl: string;
  en: string;
}

/** 27 państw członkowskich UE - kolejność alfabetyczna po kodzie. */
export const EU_COUNTRIES: readonly EuCountry[] = [
  { code: "AT", pl: "Austria", en: "Austria" },
  { code: "BE", pl: "Belgia", en: "Belgium" },
  { code: "BG", pl: "Bułgaria", en: "Bulgaria" },
  { code: "CY", pl: "Cypr", en: "Cyprus" },
  { code: "CZ", pl: "Czechy", en: "Czechia" },
  { code: "DE", pl: "Niemcy", en: "Germany" },
  { code: "DK", pl: "Dania", en: "Denmark" },
  { code: "EE", pl: "Estonia", en: "Estonia" },
  { code: "ES", pl: "Hiszpania", en: "Spain" },
  { code: "FI", pl: "Finlandia", en: "Finland" },
  { code: "FR", pl: "Francja", en: "France" },
  { code: "GR", pl: "Grecja", en: "Greece" },
  { code: "HR", pl: "Chorwacja", en: "Croatia" },
  { code: "HU", pl: "Węgry", en: "Hungary" },
  { code: "IE", pl: "Irlandia", en: "Ireland" },
  { code: "IT", pl: "Włochy", en: "Italy" },
  { code: "LT", pl: "Litwa", en: "Lithuania" },
  { code: "LU", pl: "Luksemburg", en: "Luxembourg" },
  { code: "LV", pl: "Łotwa", en: "Latvia" },
  { code: "MT", pl: "Malta", en: "Malta" },
  { code: "NL", pl: "Niderlandy", en: "Netherlands" },
  { code: "PL", pl: "Polska", en: "Poland" },
  { code: "PT", pl: "Portugalia", en: "Portugal" },
  { code: "RO", pl: "Rumunia", en: "Romania" },
  { code: "SE", pl: "Szwecja", en: "Sweden" },
  { code: "SI", pl: "Słowenia", en: "Slovenia" },
  { code: "SK", pl: "Słowacja", en: "Slovakia" },
] as const;

export function euCountryName(code: string, lang: "pl" | "en"): string {
  const country = EU_COUNTRIES.find((c) => c.code === code);
  if (!country) return code;
  return lang === "en" ? country.en : country.pl;
}

/** Stanowiska - wartości zgodne z CHECK-iem kolumny stance. */
export const POSITION_STANCES = ["support", "oppose", "mixed", "undecided"] as const;
export type PositionStance = (typeof POSITION_STANCES)[number];

export interface StanceMeta {
  key: PositionStance;
  pl: string;
  en: string;
  /** Token koloru wykresów (theme-aware); hex to fallback bez color-mix/var. */
  cssVar: string;
  hex: string;
}

/**
 * Kolory ze skali kategorycznej wykresów (--chart-*): zielony "za",
 * czerwony "przeciw", bursztyn "podzielone". "Brak stanowiska" dostaje
 * neutralny szary WYRAŹNIE ciemniejszy niż kraje spoza UE (--secondary),
 * żeby mapa odróżniała "śledzimy, brak deklaracji" od "poza zakresem".
 */
export const STANCE_META: readonly StanceMeta[] = [
  { key: "support", pl: "Za", en: "In favour", cssVar: "var(--chart-2)", hex: "#1baf7a" },
  { key: "oppose", pl: "Przeciw", en: "Against", cssVar: "var(--chart-6)", hex: "#e34948" },
  { key: "mixed", pl: "Podzielone", en: "Split", cssVar: "var(--chart-3)", hex: "#eda100" },
  {
    key: "undecided",
    pl: "Brak stanowiska",
    en: "Undecided",
    cssVar: "var(--chart-axis)",
    hex: "#a8b0ba",
  },
] as const;

export function stanceMeta(stance: string): StanceMeta {
  return STANCE_META.find((s) => s.key === stance) ?? STANCE_META[3];
}

export function stanceLabel(stance: string, lang: "pl" | "en"): string {
  const meta = stanceMeta(stance);
  return lang === "en" ? meta.en : meta.pl;
}
