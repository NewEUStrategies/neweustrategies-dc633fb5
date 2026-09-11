// PORADY FORMY DLA AUTORA - jedno miejsce, w którym rodzaj wykresu mówi
// "jestem tu złym wyborem".
//
// DLACZEGO TEN PLIK ISTNIEJE. Porada formy rozpada się na dwie wypowiedzi
// o różnych ODBIORCACH: OBSERWACJĘ o tym rysunku ("obserwacji jest tyle, że
// plamki nachodzą na siebie"), którą czytelnik ma prawo przeczytać pod
// wykresem, i ZALECENIE zmiany formy albo danych ("weź histogram albo
// boxplot"), które jest instrukcją dla autora bloku i pod opublikowanym
// wpisem nie ma czego robić - czytelnik nie zmieni cudzego wykresu, a zdanie
// każące mu to zrobić podważa rysunek, którego nie da się poprawić.
// Rendery w `src/components/charts` wołają więc wyłącznie klucze
// `<rodzaj>.reading.*` (obserwacje), a zalecenia `<rodzaj>.advice.*` mieszkają
// w nakładce `src/lib/i18n-charts-editor.ts` i pokazuje je TEN moduł, wołany
// z edytora bloku.
//
// DLACZEGO TABELA, A NIE `switch` W EDYTORZE. `Record<ChartKind, ...>` jest
// wyczerpujący, więc nowy rodzaj nie skompiluje się bez wpisu - a wpis pusty
// trzeba UZASADNIĆ komentarzem, nie przemilczeć gałęzią `default`. Poprzedni
// stan (porady wołane z wnętrza pięciu komponentów) nie dawał żadnego takiego
// miejsca: rodzaj siódmy po prostu nie miał porad i nikt tego nie widział.
//
// DLACZEGO WORKI LICZB SĄ PER PORADA, a nie jeden na rodzaj. Ta sama nazwa
// wstawki znaczy w dwóch poradach jednego rodzaju dwie różne rzeczy:
// w `scatter.advice.tooFewPoints` `{{min}}` to MINIMALNA LICZBA OBSERWACJI,
// a w `scatter.advice.trendShowsNothing` ten sam `{{min}}` to PRÓG R².
// Wspólny worek na rodzaj musiałby jedną z tych liczb nadpisać, czyli
// wypisać w zdaniu liczbę z innego zdania.
//
// BRAMKA. `__tests__/chartAdviceAudience.test.ts` sprawdza trzy rzeczy naraz:
// że żaden render publiczny nie woła klucza `advice.`, że lista `all` każdego
// rodzaju zgadza się ze słownikiem w OBU językach, i że dla każdej porady
// worek liczb pokrywa wszystkie wstawki `{{...}}` jej treści. Trzecie
// sprawdzenie ma powód z tego PR-a: `beeswarm.reading.truncated` mówi
// "pokazuje {{shown}} z {{total}} obserwacji", a render podawał `drawn`
// i `count`, więc czytelnik dostawał pod rysunkiem surowe klamry.
import type { ChartConfig, ChartKind } from "@/lib/charts/types";
import { CATEGORICAL_SAFE_SERIES } from "@/lib/charts/types";
import { formatChartValue, formatPercent, type ChartLang } from "@/lib/charts/format";
import {
  histogramFormAdvice,
  histogramModelFromConfig,
  type HistogramFormAdvice,
} from "@/lib/charts/kinds/histogram";
import {
  boxplotFormAdvice,
  boxplotModelFromConfig,
  type BoxplotFormAdvice,
} from "@/lib/charts/kinds/boxplot";
import {
  BEESWARM_MAX_COMFORT,
  beeswarmFormAdvice,
  beeswarmModelFromConfig,
  type BeeswarmFormAdvice,
} from "@/lib/charts/kinds/beeswarm";
import {
  SCATTER_OVERPLOT_SHARE,
  SCATTER_R2_MEANINGLESS,
  SCATTER_TREND_MIN_N,
  scatterFormAdvice,
  scatterModelFromConfig,
  type ScatterFormAdvice,
} from "@/lib/charts/kinds/scatter";
import {
  HEATMAP_MAX_CELLS,
  HEATMAP_MIN_COLUMNS,
  HEATMAP_MIN_ROWS,
  HEATMAP_SPARSE_SHARE,
  heatmapFormAdvice,
  heatmapModelFromConfig,
  type HeatmapFormAdvice,
} from "@/lib/charts/kinds/heatmap";
import {
  TORNADO_ROWS_ADVICE_MAX,
  tornadoFormAdvice,
  tornadoModelFromConfig,
  type TornadoFormAdvice,
} from "@/lib/charts/kinds/tornado";
import {
  FAN_LEVELS_ADVICE_MAX,
  FAN_MIN_FORECAST_STEPS,
  fanFormAdvice,
  fanModelFromConfig,
  type FanFormAdvice,
} from "@/lib/charts/kinds/fanChart";
import {
  INDEX_BASE_COMPARABLE_RATIO,
  INDEX_BASE_FENCE_IQR_FACTOR,
  INDEX_BASE_MIN_PERIODS,
  indexBaseFormAdvice,
  indexBaseModelFromConfig,
  type IndexBaseFormAdvice,
} from "@/lib/charts/kinds/indexBase";
import {
  percentStackedFormAdvice,
  percentStackedModelFromConfig,
  type PercentStackedFormAdvice,
} from "@/lib/charts/kinds/percentStacked";
import {
  SMALL_MULTIPLES_MAX_COMFORT,
  SMALL_MULTIPLES_MIN_PANELS,
  smallMultiplesFormAdvice,
  smallMultiplesModelFromConfig,
  type SmallMultiplesFormAdvice,
} from "@/lib/charts/kinds/smallMultiples";

/** Liczby do wstawek `{{...}}` jednego komunikatu. */
export type AdviceValues = Record<string, string | number>;

export interface KindFormAdvice {
  /** Prefiks słownika: klucz to `${ns}.advice.${porada}`. */
  readonly ns: string;
  /**
   * WSZYSTKIE porady rodzaju, także te, których edytor nie pokazuje. Bramka
   * porównuje tę listę ze słownikiem, więc porada dopisana do treści bez
   * wpisu tutaj (albo odwrotnie) przewraca test, a nie leży martwa.
   */
  readonly all: readonly string[];
  /**
   * Porady, które ZOSTAJĄ PRZY PODGLĄDZIE, bo ich treść zależy od geometrii
   * pola rysunku, a edytor tej geometrii nie zna. Wypisane, nie pominięte -
   * inaczej bramka uznałaby je za lukę w tabeli.
   */
  readonly onlyInPreview: readonly string[];
  /** Które porady zachodzą dla tego arkusza. */
  readonly of: (config: ChartConfig) => readonly string[];
  /** Worek liczb JEDNEJ porady. */
  readonly values: (advice: string, lang: ChartLang) => AdviceValues;
}

/** Jeden komunikat do pokazania autorowi. */
export interface FormAdviceMessage {
  readonly advice: string;
  readonly key: string;
  readonly values: AdviceValues;
}

/**
 * Odczyt worka po nazwie porady. Tabele niżej są `Record<string, ...>`
 * ŚWIADOMIE: gdyby były zawężone do unii porad rodzaju, odczyt kluczem typu
 * `string` wymagałby rzutowania, a kompletność i tak sprawdza bramka - i to
 * mocniej niż typ, bo od strony TREŚCI (czy zdanie ma niepokrytą wstawkę),
 * a nie od strony obecności klucza.
 */
const worek = (
  table: Record<string, (lang: ChartLang) => AdviceValues>,
  advice: string,
  lang: ChartLang,
): AdviceValues => table[advice]?.(lang) ?? {};

/** Rodzaj bez porad formy dla autora. Powód stoi w komentarzu wpisu. */
const BEZ_PORAD: KindFormAdvice = {
  ns: "",
  all: [],
  onlyInPreview: [],
  of: () => [],
  values: () => ({}),
};

const HISTOGRAM_ALL: readonly HistogramFormAdvice[] = [
  "tooFew",
  "noSpread",
  "tooCoarse",
  "clamped",
];
const BOXPLOT_ALL: readonly BoxplotFormAdvice[] = ["dotsBetter", "tiesDominant", "singleGroup"];
const BEESWARM_ALL: readonly BeeswarmFormAdvice[] = [
  "tooFew",
  "tooMany",
  "noSpread",
  "doesNotFit",
  "truncated",
];
const SCATTER_ALL: readonly ScatterFormAdvice[] = [
  "tooFewPoints",
  "noXVariance",
  "syntheticX",
  "trendShowsNothing",
  "overplotted",
  "lineBetter",
];
const HEATMAP_ALL: readonly HeatmapFormAdvice[] = [
  "notMatrix",
  "tooManyCells",
  "sparse",
  "noSpread",
  "divergingDowngraded",
  "unorderedAxis",
];
const TORNADO_ALL: readonly TornadoFormAdvice[] = [
  "noBase",
  "singleParameter",
  "flatRanking",
  "tooManyRows",
];

const BEESWARM_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  // UWAGA O ZASIĘGU: `tooMany` zachodzi, gdy JEDEN rój przekroczy
  // `BEESWARM_MAX_COMFORT` (150 obserwacji), a arkusz bloku CMS ma sufit
  // `MAX_CATEGORIES` = 60 wierszy, więc rój z bloku nie ma jak tego progu
  // dotknąć - komunikat jest dziś osiągalny wyłącznie dla wywołujących model
  // z własnymi danymi. Zostaje, bo próg jest twierdzeniem PERCEPCYJNYM
  // (powyżej tyle punktów plamki zlewają się niezależnie od rozsunięcia),
  // a nie pochodną sufitu arkusza: obniżenie go do 60 zamieniłoby zdanie
  // o percepcji na zdanie o limicie formularza.
  tooMany: () => ({ max: BEESWARM_MAX_COMFORT }),
};

const SCATTER_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  tooFewPoints: () => ({ min: SCATTER_TREND_MIN_N }),
  // Próg R² jest liczbą z przedziału (0,1) i ma się wyświetlić przecinkiem
  // dziesiętnym języka autora, nie kropką - stąd formater wykresów, ten sam,
  // którym render pisze ten komunikat pod rysunkiem.
  trendShowsNothing: (lang) => ({ min: formatChartValue(SCATTER_R2_MEANINGLESS, lang, "") }),
  overplotted: (lang) => ({ share: formatPercent(SCATTER_OVERPLOT_SHARE, lang) }),
};

const HEATMAP_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  notMatrix: () => ({ rows: HEATMAP_MIN_ROWS, columns: HEATMAP_MIN_COLUMNS }),
  tooManyCells: () => ({ max: HEATMAP_MAX_CELLS }),
  // Próg jest udziałem WYPEŁNIONYCH komórek, a zdanie mówi o PUSTYCH, więc do
  // słownika jedzie dopełnienie - tak samo jak w renderze mapy ciepła.
  sparse: (lang) => ({ share: formatPercent(1 - HEATMAP_SPARSE_SHARE, lang) }),
};

const TORNADO_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  tooManyRows: () => ({ max: TORNADO_ROWS_ADVICE_MAX }),
};

const FAN_ALL: readonly FanFormAdvice[] = [
  "noForecast",
  "noBand",
  "noCentral",
  "singleForecastStep",
  "singleLevel",
  "tooManyLevels",
  "constantBand",
];
const FAN_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  singleForecastStep: () => ({ min: FAN_MIN_FORECAST_STEPS }),
  tooManyLevels: () => ({ max: FAN_LEVELS_ADVICE_MAX }),
};

const INDEX_BASE_ALL: readonly IndexBaseFormAdvice[] = [
  "baseUnusable",
  "seriesDropped",
  "singleSeries",
  "shortSeries",
  "extremeBase",
  "mixedSign",
  "noSpread",
  "scaleComparable",
  "tooManySeries",
];
const INDEX_BASE_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  shortSeries: () => ({ min: INDEX_BASE_MIN_PERIODS }),
  // Mnożnik ogrodzenia jedzie przez formatowanie liczby, bo „1,5" po polsku
  // i „1.5" po angielsku to dwa różne napisy, a zdanie o nietypowym okresie
  // bazowym czyta autor w swoim języku.
  extremeBase: (lang) => ({ factor: formatChartValue(INDEX_BASE_FENCE_IQR_FACTOR, lang, "") }),
  scaleComparable: () => ({ ratio: INDEX_BASE_COMPARABLE_RATIO }),
  // Próg palety, nie próg indeksu: powyżej tylu kolorów kategorialnych barwa
  // przestaje nieść kategorię dla każdego rodzaju widzenia barw.
  tooManySeries: () => ({ max: CATEGORICAL_SAFE_SERIES }),
};

const PERCENT_STACKED_ALL: readonly PercentStackedFormAdvice[] = [
  "negativeValues",
  "tooManySegments",
  "singleSegment",
  "singleBar",
  "noStructure",
];
const PERCENT_STACKED_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  // Ta sama stała co przy indeksie i ta sama przyczyna - a w stosie waży
  // więcej, bo tożsamości segmentu nie niesie tam nic poza kolorem.
  tooManySegments: () => ({ max: CATEGORICAL_SAFE_SERIES }),
};

const SMALL_MULTIPLES_ALL: readonly SmallMultiplesFormAdvice[] = [
  "singlePanel",
  "tooManyPanels",
  "indexBaseBetter",
  "undeclaredFreeScale",
  "mixedUnits",
  "noSpread",
  "sheetOrder",
  "oneCategory",
];
const SMALL_MULTIPLES_VALUES: Record<string, (lang: ChartLang) => AdviceValues> = {
  singlePanel: () => ({ min: SMALL_MULTIPLES_MIN_PANELS }),
  tooManyPanels: () => ({ max: SMALL_MULTIPLES_MAX_COMFORT }),
};

/**
 * Tabela porad po rodzaju. Rodzaje bez wpisu własnego dostają `BEZ_PORAD`
 * z powodem - i powód jest za każdym razem inny, dlatego nie ma tu gałęzi
 * zbiorczej.
 */
export const FORM_ADVICE: Record<ChartKind, KindFormAdvice> = {
  // FORMY PODSTAWOWE. Linia, warstwa, słupki i mostek nie mają porad
  // "jesteś złym wyborem", bo są DOMYŚLNĄ odpowiedzią na swoje pytanie
  // (przebieg w czasie, poziom w kategoriach, od czego do czego) - a
  // dyscyplinę, którą i one łamią, pilnują ostrzeżenia niezależne od rodzaju
  // (paleta ponad bezpieczną liczbę serii, prognoza bez pasma, podpis bez
  // zdania "czego nie pokazuje").
  line: BEZ_PORAD,
  area: BEZ_PORAD,
  bar: BEZ_PORAD,
  "bar-horizontal": BEZ_PORAD,
  waterfall: BEZ_PORAD,
  // TARCZA I PIERŚCIEŃ MAJĄ swoje porady, tylko starsze od tej tabeli
  // i o innym kształcie: `pieFormAdvice` liczy je z UDZIAŁÓW modelu, nie
  // z konfiguracji, a edytor pokazuje je pod kluczami `editor.*`, bo
  // powstały razem z pierwszą wersją edytora bloku. Przepisanie ich tutaj
  // znaczyłoby przeniesienie trzech kluczy słownika bez zmiany tego, co
  // widzi autor - i dlatego tego nie robimy.
  pie: BEZ_PORAD,
  donut: BEZ_PORAD,
  histogram: {
    ns: "histogram",
    all: HISTOGRAM_ALL,
    onlyInPreview: [],
    of: (config) => histogramFormAdvice(histogramModelFromConfig(config)),
    values: () => ({}),
  },
  boxplot: {
    ns: "boxplot",
    all: BOXPLOT_ALL,
    onlyInPreview: [],
    of: (config) => boxplotFormAdvice(boxplotModelFromConfig(config)),
    values: () => ({}),
  },
  beeswarm: {
    ns: "beeswarm",
    all: BEESWARM_ALL,
    // DWIE PORADY O GEOMETRII, nie o danych: `doesNotFit` i `truncated` mówią,
    // ile punktów zmieściło się w PASMIE ROJU, a pasmo zależy od wysokości
    // pola rysunku i od skali osi, których edytor nie zna - model policzony
    // tu, z ustawień domyślnych, podałby liczby z innego rysunku niż ten
    // obok. Autor widzi je i tak: podgląd nad formą jest tym samym renderem,
    // który liczy je z prawdziwej geometrii.
    onlyInPreview: ["doesNotFit", "truncated"],
    of: (config) => beeswarmFormAdvice(beeswarmModelFromConfig(config)),
    values: (advice, lang) => worek(BEESWARM_VALUES, advice, lang),
  },
  scatter: {
    ns: "scatter",
    all: SCATTER_ALL,
    onlyInPreview: [],
    of: (config) => scatterFormAdvice(scatterModelFromConfig(config)),
    values: (advice, lang) => worek(SCATTER_VALUES, advice, lang),
  },
  heatmap: {
    ns: "heatmap",
    all: HEATMAP_ALL,
    onlyInPreview: [],
    of: (config) => heatmapFormAdvice(heatmapModelFromConfig(config)),
    values: (advice, lang) => worek(HEATMAP_VALUES, advice, lang),
  },
  tornado: {
    ns: "tornado",
    all: TORNADO_ALL,
    onlyInPreview: [],
    of: (config) => tornadoFormAdvice(tornadoModelFromConfig(config)),
    values: (advice, lang) => worek(TORNADO_VALUES, advice, lang),
  },
  fan: {
    ns: "fan",
    all: FAN_ALL,
    onlyInPreview: [],
    of: (config) => fanFormAdvice(fanModelFromConfig(config)),
    values: (advice, lang) => worek(FAN_VALUES, advice, lang),
  },
  "index-base": {
    ns: "indexBase",
    all: INDEX_BASE_ALL,
    onlyInPreview: [],
    of: (config) => indexBaseFormAdvice(indexBaseModelFromConfig(config)),
    values: (advice, lang) => worek(INDEX_BASE_VALUES, advice, lang),
  },
  "percent-stacked": {
    ns: "percentStacked",
    all: PERCENT_STACKED_ALL,
    onlyInPreview: [],
    of: (config) => percentStackedFormAdvice(percentStackedModelFromConfig(config)),
    values: (advice, lang) => worek(PERCENT_STACKED_VALUES, advice, lang),
  },
  "small-multiples": {
    ns: "smallMultiples",
    all: SMALL_MULTIPLES_ALL,
    onlyInPreview: [],
    of: (config) => smallMultiplesFormAdvice(smallMultiplesModelFromConfig(config)),
    values: (advice, lang) => worek(SMALL_MULTIPLES_VALUES, advice, lang),
  },
};

/**
 * Zalecenia formy dla arkusza autora, w kolejności słownika (`all`), a nie
 * w kolejności zwrotu z modelu: lista ostrzeżeń nad formą ma być STABILNA,
 * bo autor czyta ją wielokrotnie w trakcie edycji.
 */
export function chartFormAdvice(config: ChartConfig, lang: ChartLang): FormAdviceMessage[] {
  const wpis = FORM_ADVICE[config.kind];
  if (wpis.all.length === 0) return [];
  const zachodzi = new Set(wpis.of(config));
  return wpis.all
    .filter((a) => zachodzi.has(a) && !wpis.onlyInPreview.includes(a))
    .map((a) => ({
      advice: a,
      key: `${wpis.ns}.advice.${a}`,
      values: wpis.values(a, lang),
    }));
}
