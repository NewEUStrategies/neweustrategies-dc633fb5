// Konfiguracja rekomendacji: typy, wartości domyślne i scalanie nadpisań.
//
// DLACZEGO TO JEST OSOBNY MODUŁ OD SCORINGU. Publiczna trasa wpisu
// (`routes/$.tsx`) potrzebuje z tej dziedziny DOKŁADNIE JEDNEJ RZECZY:
// scalonej konfiguracji, żeby wiedzieć, CZY i GDZIE renderować sekcję
// (`enabled`, `position`, `after_paragraph`). Nie liczy tam ani jednego
// wyniku. Dopóki `mergeRelatedConfig` mieszkało obok algorytmu, statyczny
// import z trasy wciągał do CHUNKU WEJŚCIOWEGO cały silnik: `scoreRelatedDetailed`,
// `buildIdf`, `normalizeMap`, `rankRelated` i `documentFrequency` - kod, który
// wykonuje się wyłącznie w leniwie ładowanym widgecie.
//
// Bramka `check:bundle` mierzy największy POJEDYNCZY plik, a `index-*.js` stoi
// tuż pod progiem 280 KB (na `main` zapas wynosi 0,8 KB i skrypt drukuje
// ostrzeżenie „zapas poniżej 2%"). Rozdział sprawia, że trasa płaci za samą
// konfigurację, a algorytm jedzie tam, gdzie jest używany.
//
// `lib/relatedPosts.ts` re-eksportuje wszystko z tego pliku, więc pozostałe
// dwadzieścia kilka konsumentów nie zmienia ani jednego importu.

export type RelatedPosition = "end" | "sidebar" | "after_paragraph";
export type RelatedLayout = "grid" | "list" | "slider" | "cards" | "magazine" | "timeline";
export type RelatedSource = "categories" | "tags" | "both" | "author";

export interface RelatedPostsConfig {
  enabled: boolean;
  position: RelatedPosition;
  after_paragraph: number;
  layout: RelatedLayout;
  columns: 2 | 3 | 4;
  items_limit: number;
  source_strategy: RelatedSource;
  show_excerpt: boolean;
  show_meta: boolean;
  show_cover: boolean;
  recency_boost_days: number;
  slider_autoplay: boolean;
  slider_interval_ms: number;
  title_pl: string;
  title_en: string;
  // v2 - wagi silnika 0..10, IDF, próg minimalnego score
  weight_categories: number;
  weight_tags: number;
  weight_author: number;
  weight_recency: number;
  weight_popularity: number;
  weight_dwell: number;
  weight_personalization: number;
  use_idf: boolean;
  min_score: number;
}

export type RelatedPostsOverride = Partial<RelatedPostsConfig>;

export const RELATED_POSTS_DEFAULTS: RelatedPostsConfig = {
  enabled: true,
  position: "end",
  after_paragraph: 3,
  layout: "grid",
  columns: 3,
  items_limit: 6,
  source_strategy: "both",
  show_excerpt: true,
  show_meta: true,
  show_cover: true,
  recency_boost_days: 30,
  slider_autoplay: false,
  slider_interval_ms: 5000,
  title_pl: "Powiązane wpisy",
  title_en: "Related posts",
  weight_categories: 3,
  weight_tags: 2,
  weight_author: 1,
  weight_recency: 1,
  weight_popularity: 2,
  weight_dwell: 2,
  weight_personalization: 3,
  use_idf: true,
  min_score: 0,
};

/**
 * Pola liczbowe, które trafiają WPROST do silnika, wraz z ich zakresami.
 *
 * Nadpisanie per wpis (`posts.related_override`) to surowy `jsonb`: nic w bazie
 * nie pilnuje ani typu, ani zakresu - odpowiednik CHECK-ów stoi wyłącznie na
 * ścieżce zapisu panelu globalnego (`buildRelatedPostsConfigRow`). Dopóki wagi
 * nie docierały do renderu, nie miało to znaczenia. Teraz ma: `min_score`
 * przyszły jako NAPIS przeszedłby do porównania `score >= minScore`, które dla
 * napisu jest zawsze fałszem - i sekcja powiązanych wpisów zniknęłaby z wpisu
 * bez śladu. Ujemna albo absurdalna waga wywróciłaby ranking równie cicho.
 */
type EngineNumericField =
  | "items_limit"
  | "recency_boost_days"
  | "weight_categories"
  | "weight_tags"
  | "weight_author"
  | "weight_recency"
  | "weight_popularity"
  | "weight_dwell"
  | "weight_personalization"
  | "min_score";

const ENGINE_BOUNDS: Readonly<Record<EngineNumericField, { min: number; max: number }>> = {
  items_limit: { min: 1, max: 24 },
  recency_boost_days: { min: 0, max: 3650 },
  weight_categories: { min: 0, max: 10 },
  weight_tags: { min: 0, max: 10 },
  weight_author: { min: 0, max: 10 },
  weight_recency: { min: 0, max: 10 },
  weight_popularity: { min: 0, max: 10 },
  weight_dwell: { min: 0, max: 10 },
  weight_personalization: { min: 0, max: 10 },
  min_score: { min: 0, max: 1000 },
};

const ENGINE_NUMERIC_FIELDS = Object.keys(ENGINE_BOUNDS) as EngineNumericField[];

/**
 * Wartość liczbowa w zakresie albo `fallback`.
 *
 * Parametr jest typowany jako `number`, ale w RUNTIME przychodzi z `jsonb`, więc
 * bywa napisem, `null`-em albo obiektem - stąd jawna konwersja zamiast zaufania
 * do typu. Sensowny napis liczbowy przechodzi po konwersji; wszystko inne wraca
 * na wartość globalną.
 */
function clampEngineValue(value: number, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export function mergeRelatedConfig(
  global: Partial<RelatedPostsConfig> | null | undefined,
  override: RelatedPostsOverride | null | undefined,
): RelatedPostsConfig {
  const base: RelatedPostsConfig = { ...RELATED_POSTS_DEFAULTS, ...(global ?? {}) };
  // Only spread defined override keys so `null`/missing values don't clobber the global.
  const cleaned = override
    ? (Object.fromEntries(
        Object.entries(override).filter(([, v]) => v !== undefined && v !== null),
      ) as RelatedPostsOverride)
    : null;
  const merged: RelatedPostsConfig = cleaned ? { ...base, ...cleaned } : { ...base };

  // Domknięcie zakresów obejmuje TAKŻE konfigurację globalną, nie tylko
  // nadpisanie: uszkodzony wiersz `related_posts_config` wywraca silnik dokładnie
  // tak samo jak uszkodzony `related_override`, a dwie ścieżki o różnej
  // odporności to dwie różne klasy defektu do wyśledzenia.
  //
  // Wartość spoza zakresu wraca do tej z konfiguracji globalnej (a dla samej
  // globalnej - do domyślnej), nigdy do zera: uszkodzone ustawienie nie ma
  // prawa wyjść na wartość skrajną i po cichu wygasić sygnału.
  for (const pole of ENGINE_NUMERIC_FIELDS) {
    const { min, max } = ENGINE_BOUNDS[pole];
    const fallback = clampEngineValue(base[pole], RELATED_POSTS_DEFAULTS[pole], min, max);
    merged[pole] = clampEngineValue(merged[pole], fallback, min, max);
  }
  // `use_idf` steruje CAŁĄ skalą wyniku, więc musi być boolem, nie czymkolwiek
  // prawdziwym w sensie JS (napis "false" jest prawdziwy).
  merged.use_idf = merged.use_idf === true;

  return merged;
}
