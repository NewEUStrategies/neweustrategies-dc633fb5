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
 * Kolory stanowisk. Idą z tokenów SEMANTYCZNYCH, nie z numerów slotów palety.
 *
 * Wcześniej stało tu `--chart-2` dla "za" i `--chart-6` dla "przeciw", czyli
 * mapa czytała pozycję w palecie kategorialnej tak, jakby to była nazwa
 * znaczenia - a slot 2 był wtedy zielony wyłącznie przez zbieg okoliczności.
 * Po przebudowie palety "za" zrobiłoby się ochrą, a "przeciw" terakotą, i nic
 * w kodzie nie miałoby jak tego zauważyć: token istnieje, kolor się rysuje,
 * tylko znaczy co innego.
 *
 * "Podzielone" bierze ochrę (slot 2) jako punkt środkowy skali - ten sam,
 * którym idzie środek macierzy ryzyka i środek skali Web Vitals, więc trzy
 * miejsca w repo mówią o "pośrodku" jednym kolorem. "Brak stanowiska" dostaje
 * kolor osi: neutralny, wyraźnie ciemniejszy niż kraje spoza UE
 * (`--secondary`), żeby mapa odróżniała "śledzimy, brak deklaracji" od "poza
 * zakresem".
 *
 * `hex` jest awaryjną kopią wartości JASNEJ dla miejsc, które nie umieją
 * podać `var()` (kanwa, eksport PNG) - musi być zgodny z tokenem, więc przy
 * zmianie palety zmienia się razem z nim.
 */
export const STANCE_META: readonly StanceMeta[] = [
  {
    key: "support",
    pl: "Za",
    en: "In favour",
    cssVar: "var(--chart-positive)",
    hex: "#1b6f8c",
  },
  {
    key: "oppose",
    pl: "Przeciw",
    en: "Against",
    cssVar: "var(--chart-negative)",
    hex: "#ef5454",
  },
  { key: "mixed", pl: "Podzielone", en: "Split", cssVar: "var(--chart-2)", hex: "#c6871f" },
  {
    key: "undecided",
    pl: "Brak stanowiska",
    en: "Undecided",
    cssVar: "var(--chart-axis)",
    hex: "#d9dbd4",
  },
] as const;

export function stanceMeta(stance: string): StanceMeta {
  return STANCE_META.find((s) => s.key === stance) ?? STANCE_META[3];
}

export function stanceLabel(stance: string, lang: "pl" | "en"): string {
  const meta = stanceMeta(stance);
  return lang === "en" ? meta.en : meta.pl;
}
