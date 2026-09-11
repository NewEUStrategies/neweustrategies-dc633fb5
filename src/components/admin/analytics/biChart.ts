// KONFIGURACJA WYKRESU BI - jedno wejście do silnika dla całego /admin/analytics.
//
// PO CO. Każdy panel składał wcześniej obiekt `option` dla ECharts: osie, siatkę,
// dymek, kolory, zaokrąglenia. To jest kilkadziesiąt linii na wykres i za każdym
// razem okazja, żeby ustawić coś inaczej niż sąsiad - stąd na jednym pulpicie
// legenda wchodząca na pierścień, a obok wykres bez niej.
//
// Silnik nie przyjmuje `option`, tylko `ChartConfig`: rodzaj, kategorie, serie
// i garść przełączników uczciwości. Reszta - paleta, geometria, dymek, tabela
// danych, podpis, obsługa klawiatury - jest JEGO decyzją i panel nie ma jej
// prawa nadpisywać. Ten plik jest po to, żeby wypełnienie tych kilku pól
// wyglądało w każdym panelu tak samo.
//
// BUDUJEMY NA `defaultChartConfig()`, a nie na literale: konfiguracja ma
// kilkanaście pól, a nowe dochodzą. Literał przestałby się kompilować przy
// każdym dopisaniu pola - albo, gorzej, ktoś rozluźniłby typ i panel
// renderowałby wykres z niezdefiniowanymi ustawieniami uczciwości.
import { defaultChartConfig } from "@/lib/charts/parse";
import { type ChartConfig, type ChartKind, type ChartSeries } from "@/lib/charts/types";
import type { BarStyle } from "@/lib/charts/palette";
import { slotForSeries } from "@/lib/charts/palette";

export interface BiChartInput {
  kind: ChartKind;
  categories: readonly string[];
  series: readonly { name: string; values: readonly (number | null)[]; colorSlot?: number }[];
  /** Jednostka WRAZ Z SEPARATOREM: "%" skleja się z liczbą, " ms" rozdziela. */
  unit?: string;
  /** Liczba obserwacji do podpisu (sekcja 8: „podaj n"). */
  sampleSize?: number | null;
  showLegend?: boolean;
  showValues?: boolean;
  showGrid?: boolean;
  stacked?: boolean;
  /** 0 = łamana. Domyślnie silnik wygładza; szereg dzienny bywa czytelniejszy łamaną. */
  smoothing?: number;
  barStyle?: BarStyle;
  /** Indeks pierwszej kategorii prognozowanej; `null` = cały szereg to pomiar. */
  forecastFrom?: number | null;
  /** Źródło danych do podpisu - panel zna je lepiej niż silnik. */
  source?: string;
  height?: number;
}

/**
 * Numery slotów palety przydzielane po kolei, gdy panel ich nie poda.
 *
 * "Po kolei" znaczy w KOLEJNOŚCI SEKWENCJI, a nie 1, 2, 3: `slotForSeries`
 * idzie po `SLOT_SEQUENCE`, czyli po numerach ułożonych pod rozdzielność barw,
 * a nie pod numerację tokenów. Numer spoza palety nie ma w arkuszu żadnego
 * tokena - seria dostałaby `var(--chart-N)`, czyli nic - i dlatego numer nigdy
 * nie jest tu liczony z literału.
 *
 * Przydział jest tu, a nie w silniku, bo silnik dostaje serie już z numerami -
 * i to jest właściwy podział: KTÓRA wielkość dostaje który kolor, jest decyzją
 * panelu (ta sama metryka ma mieć ten sam kolor na wszystkich jego wykresach),
 * a JAK ten kolor wygląda - decyzją palety.
 */
function zeSlotami(series: BiChartInput["series"]): ChartSeries[] {
  return series.map((s, i) => ({
    name: s.name,
    values: [...s.values],
    colorSlot: s.colorSlot ?? slotForSeries(i),
  }));
}

/** Konfiguracja dla `<Chart>` / `<ChartCard>`. */
export function biChart(input: BiChartInput): ChartConfig {
  const base = defaultChartConfig();
  return {
    ...base,
    kind: input.kind,
    // Tytuł i opis zostają PUSTE: nagłówek rysuje karta panelu, a rama silnika
    // pomija swój własny dokładnie wtedy, gdy oba są puste.
    title: "",
    description: "",
    categories: [...input.categories],
    series: zeSlotami(input.series),
    unit: input.unit ?? "",
    sampleSize: input.sampleSize ?? null,
    showLegend: input.showLegend ?? input.series.length > 1,
    showValues: input.showValues ?? false,
    showGrid: input.showGrid ?? true,
    stacked: input.stacked ?? false,
    smoothing: input.smoothing ?? base.smoothing,
    barStyle: input.barStyle ?? base.barStyle,
    forecastFrom: input.forecastFrom ?? null,
    forecastFromDeclared: input.forecastFrom ?? null,
    source: input.source ?? "",
    height: input.height ?? base.height,
    // PANEL NIE ANIMUJE. Pulpit analityczny odświeża się zapytaniem co kilka
    // sekund, a wykres wjeżdżający przy każdym odświeżeniu czyta się jako
    // zmiana danych - czyli animacja kłamałaby o tym, co się stało.
    animate: false,
  };
}
