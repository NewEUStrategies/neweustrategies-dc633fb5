// Punkt wejścia silnika wykresów: ChartFrame (karta, legenda, tabela danych,
// podpis uczciwościowy) + właściwy rysunek zależnie od `kind`. Konsumowany
// przez blok CMS ("chart") i widget buildera ("chart") - jedna implementacja,
// obie platformy.
//
// TU SIĘ SKŁADA LEGENDA I TABELA, i to jest właściwe miejsce: legenda musi
// wskazywać dokładnie te znaczniki, które rysunek naprawdę narysował, a tabela
// musi liczyć udziały z tego samego mianownika, którym rysunek liczy kąty.
// Trzymanie obu w rysunku rozjeżdżało grafikę z jej alternatywą tekstową.
import { Fragment, useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig, ChartKind } from "@/lib/charts/types";
import { CATEGORICAL_SAFE_SERIES } from "@/lib/charts/types";
import {
  formatChartValue,
  formatPercent,
  formatPercentPoints,
  type ChartLang,
} from "@/lib/charts/format";
import { isZeroBaselineBroken } from "@/lib/charts/honesty";
import { waterfallModel } from "@/lib/charts/waterfall";
import { ChartFrame, CHART_TABLE_CLS, type ChartCaption, type LegendItem } from "./ChartFrame";
import { CartesianChart } from "./CartesianChart";
import { PieChart } from "./PieChart";
import { HistogramChart } from "./HistogramChart";
import { BoxplotChart } from "./BoxplotChart";
import { BeeswarmChart } from "./BeeswarmChart";
import { ScatterChart } from "./ScatterChart";
import { HeatmapChart } from "./HeatmapChart";
import { TornadoChart } from "./TornadoChart";
import { FanChart } from "./FanChart";
import { IndexBaseChart } from "./IndexBaseChart";
import { PercentStackedChart } from "./PercentStackedChart";
import { SmallMultiplesChart } from "./SmallMultiplesChart";
import { histogramModelFromConfig, histogramTable } from "@/lib/charts/kinds/histogram";
import { boxplotModelFromConfig, boxplotTable } from "@/lib/charts/kinds/boxplot";
import { beeswarmModelFromConfig, beeswarmTable } from "@/lib/charts/kinds/beeswarm";
import { scatterModelFromConfig, scatterTable } from "@/lib/charts/kinds/scatter";
import {
  HEATMAP_MARGIN_STATS,
  heatmapModelFromConfig,
  heatmapTable,
  type HeatmapMargin,
  type HeatmapMarginStat,
} from "@/lib/charts/kinds/heatmap";
import {
  tornadoModelFromConfig,
  tornadoTable,
  type TornadoRowNote,
} from "@/lib/charts/kinds/tornado";
import {
  FAN_COLUMNS,
  fanModelFromConfig,
  fanTable,
  type FanBandSource,
  type FanCentralSource,
  type FanColumnKey,
  type FanRowNote,
} from "@/lib/charts/kinds/fanChart";
import {
  INDEX_BASE_COLUMNS,
  indexBaseModelFromConfig,
  indexBaseTable,
  type IndexBaseColumnKey,
  type IndexBaseRejection,
  type IndexBaseSeriesNote,
  type IndexBaseSource,
} from "@/lib/charts/kinds/indexBase";
import {
  PERCENT_STACKED_COLUMNS,
  percentStackedModelFromConfig,
  percentStackedTable,
  type PercentStackedCellNote,
  type PercentStackedColumnKey,
  type PercentStackedRowNote,
  type PercentStackedTableCell,
  type PercentStackedTableRow,
} from "@/lib/charts/kinds/percentStacked";
import {
  SMALL_MULTIPLES_SUMMARY_COLUMNS,
  smallMultiplesModelFromConfig,
  smallMultiplesTable,
  type SmallMultiplesOrder,
  type SmallMultiplesScaleMode,
  type SmallMultiplesSummaryColumn,
  type SmallMultiplesTableRow,
} from "@/lib/charts/kinds/smallMultiples";

/**
 * Przypis wiersza tornada -> klucz słownika, JAWNIE. Wcześniej klucz powstawał
 * sklejeniem (`tornado.note.${n}`) i to nie była kosmetyka: unia ma siedem
 * wartości, słownik miał trzy, a czterech brakujących nie widziała ani bramka
 * parytetu PL/EN, ani bramka rozjazdu kod-słownik, bo obie czytają wyłącznie
 * PEŁNE ścieżki. Na stronie publicznej stał w tabeli danych napis
 * „tornado.note.oneLegged". Mapa jest wyczerpująca, więc nowa wartość unii nie
 * skompiluje się bez klucza, a bramka `chartDictionaryKeys.test.ts` sprawdza
 * drugą stronę: czy klucz ma treść w obu językach.
 */
const TORNADO_NOTE_KEYS: Record<TornadoRowNote, string> = {
  inverted: "tornado.note.inverted",
  zeroSpan: "tornado.note.zeroSpan",
  oneLegged: "tornado.note.oneLegged",
  empty: "tornado.note.empty",
  oneSided: "tornado.note.oneSided",
  tied: "tornado.note.tied",
  duplicate: "tornado.note.duplicate",
};
import { pieModel, pieShare } from "./pieModel";
import "@/lib/i18n-charts";
import type { ChartSelectHandler } from "@/lib/charts/selection";

interface ChartProps {
  config: ChartConfig;
  lang: ChartLang;
  className?: string;
  /**
   * Wskazanie oddane na zewnątrz - kliknięciem w znacznik albo klawiszem
   * Enter na wskazanym elemencie.
   *
   * Pominięcie tej właściwości znaczy „wykres tylko do czytania" i tak jest
   * we wpisie: czytelnik opublikowanej strony nie ma gdzie zejść głębiej.
   * Podaje ją panel analityczny, który po wskazaniu otwiera okno szczegółów.
   *
   * TRZY RODZAJE ROZKŁADU WSKAZANIA NIE ODDAJĄ - patrz `BEZ_WSKAZANIA` niżej.
   */
  onSelect?: ChartSelectHandler;
}

export function Chart({ config, lang, className, onSelect }: ChartProps) {
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik; klucz sklejony template literalem wypada z kontroli
  // parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  // `useCallback`, bo `t` jest ZALEŻNOŚCIĄ useMemo budującego legendę. Bez
  // stabilnej referencji legenda przeliczałaby się przy każdym renderze -
  // a wykres renderuje przy każdym ruchu wskaźnika nad znacznikiem.
  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string =>
      scoped(key, { lng: lang, ...values }),
    [scoped, lang],
  );
  const isPie = config.kind === "pie" || config.kind === "donut";
  const isWaterfall = config.kind === "waterfall";
  // JEDNA SERIA NA RYSUNKU = KLUCZ Z PRÓBKAMI NIC NIE WNOSI. Trzy rodzaje
  // rozkładu czytają jedną serię (albo grupują ją same), więc legenda
  // powtarzałaby tytuł wykresu, a przy dwóch seriach w danych sugerowałaby, że
  // obie są na rysunku - a druga jest pominięta i model zgłasza to osobno.
  const jedenRozklad =
    config.kind === "histogram" || config.kind === "boxplot" || config.kind === "beeswarm";
  // MAPA CIEPŁA MA WŁASNY KLUCZ i to nie jest ten sam klucz co legenda serii.
  // Legenda serii mówi "ta barwa to ta seria", a mapa ciepła koduje barwą
  // WARTOŚĆ, nie serię - jej klucz musi podać GRANICE kubełków, czyli te same
  // liczby, które decydowały o przydziale koloru. Rysuje go komponent, bo
  // tylko on zna skalę; legenda serii wypisałaby tu nazwy kolumn, które
  // czytelnik ma już na osi.
  // Tornado dokłada się do tej samej grupy: jego dwa kierunki to WARTOŚĆ
  // NISKA i WYSOKA parametru, nie serie, a legenda serii wypisałaby tu
  // nazwy dwóch serii wejściowych, których czytelnik na rysunku nie widzi
  // jako osobnych obiektów.
  const wlasnyKluczRysunku = jedenRozklad || config.kind === "heatmap" || config.kind === "tornado";

  const legend: LegendItem[] = useMemo(() => {
    if (isWaterfall) {
      // Mostek nie ma serii - ma ZNAK. Klucz mówi więc o kierunku, i to jest
      // jedyna legenda, jaka ma tu sens; nazwy kroków niesie oś kategorii.
      const klucze: LegendItem[] = [
        {
          key: "increase",
          name: t("waterfall.increase"),
          color: "var(--chart-positive)",
          textColor: "var(--chart-positive-text)",
          shape: "rect" as const,
        },
        {
          key: "decrease",
          name: t("waterfall.decrease"),
          color: "var(--chart-negative)",
          textColor: "var(--chart-negative-text)",
          shape: "rect" as const,
        },
      ];
      // TRZECI KLUCZ TYLKO WTEDY, GDY JEST CO NIM OZNACZYĆ. Składnik o wkładzie
      // dokładnie zerowym ma na rysunku własny kolor (trzeci tusz, bo wkład
      // zerowy nie ma znaku), więc bez wpisu w kluczu czytelnik widziałby na
      // mostku kolor, którego legenda nie zna. Wpis BEZWARUNKOWY byłby
      // odwrotnym błędem: obiecywałby kategorię, której w tych danych nie ma -
      // a większość mostków nie ma ani jednego zerowego składnika.
      const maZerowy = waterfallModel(config.categories, config.series[0]?.values ?? []).steps.some(
        (s) => s.kind === "step" && s.direction === "flat",
      );
      if (maZerowy) {
        klucze.push({
          key: "flat",
          name: t("waterfall.flat"),
          color: "var(--muted-foreground)",
          textColor: "var(--muted-foreground)",
          shape: "rect" as const,
        });
      }
      return klucze;
    }
    // TARCZA NIE MA LEGENDY Z PRÓBKAMI, i to jest zmiana wobec wcześniejszej
    // wersji. Klucz tarczy niesie teraz TABELA obok pierścienia
    // (`PieKeyTable` w `PieChart`): ta sama próbka - para blade wnętrze plus
    // mocna obwódka - ale w jednym wierszu z nazwą, udziałem i wartością
    // bezwzględną. Legenda podawała wyłącznie parę kolor-nazwa, więc czytelnik
    // wykonywał trzy skoki wzroku (łuk, próbka, nazwa) i wciąż nie dostawał
    // liczby; dwa klucze do tej samej grafiki byłyby przy tym dwoma miejscami,
    // w których ta sama kolejność wycinków może się rozjechać.
    //
    // Przełącznik „Legenda” zostaje w edytorze i nadal działa dla wykresów
    // kartezjańskich i mostka; na tarczy tabela klucza jest WYMAGANYM nośnikiem
    // tożsamości w wariancie bladym, a nie ozdobą do wyłączenia.
    if (isPie) return [];
    // HISTOGRAM NIE MA LEGENDY, i to nie jest oszczędność. Czyta JEDNĄ serię,
    // więc klucz z jedną próbką powtarzałby tytuł wykresu, a przy dwóch
    // seriach w danych sugerowałby, że obie są na rysunku - a druga jest
    // pominięta (model zgłasza to jako `ignoredSeries`).
    if (wlasnyKluczRysunku) return [];
    const shape =
      config.kind === "line" || config.kind === "area" ? ("line" as const) : ("rect" as const);
    return config.series.map((s) => ({
      key: `slot-${s.colorSlot}-${s.name}`,
      name: s.name,
      color: `var(--chart-${s.colorSlot})`,
      textColor: `var(--chart-${s.colorSlot}t)`,
      shape,
      // Kreskowanie powtórzone w legendzie: seria poza zestawem bezpiecznym
      // dla daltonizmu różni się od slotu 1-2 o ~10-12 jednostek CIELAB po
      // symulacji, więc klucz nie może twierdzić, że różni je sam odcień.
      dashed: s.colorSlot > CATEGORICAL_SAFE_SERIES,
    }));
  }, [config, wlasnyKluczRysunku, isPie, isWaterfall, t]);

  const shareSumMismatch: string | null = useMemo(() => {
    if (!isPie) return null;
    const model = pieModel(config, lang);
    // `shareSumOk === null` znaczy "nie ma czego sprawdzać" (dane nie są
    // udziałami), a nie "jest dobrze" - i tego rozróżnienia nie wolno tu
    // zgubić, bo `!ok` obejmowałoby oba przypadki i ostrzeżenie wisiałoby nad
    // każdą tarczą w milionach euro.
    if (model.shareSumOk !== false || model.shareSum === null) return null;
    return formatPercentPoints(model.shareSum, lang);
  }, [config, lang, isPie]);

  const hasData =
    config.categories.length > 0 &&
    config.series.length > 0 &&
    config.series.some((s) => s.values.some((v) => v !== null));

  const caption: ChartCaption = {
    source: config.source,
    sourceDate: config.sourceDate,
    unit: config.unit,
    sampleSize: config.sampleSize,
    zeroBaselineBroken: isZeroBaselineBroken(config),
    // SUMA KONTROLNA UDZIAŁÓW - ta sama reguła co suma kontrolna mostka,
    // tylko dla tarczy: udziały, które nie sumują się do 100%, są błędem,
    // a nie kwestią gustu. Liczona na liczbach ZAOKRĄGLONYCH, czyli na tych,
    // które czytelnik widzi - suma dokładna zawsze da 100% z definicji
    // mianownika, więc sprawdzanie jej niczego nie wykrywa. `null` znaczy
    // "nie ma czego zgłaszać": inny rodzaj wykresu albo suma w tolerancji.
    shareSumMismatch,
    notesShows: config.notesShows,
    notesSurprising: config.notesSurprising,
    notesHidden: config.notesHidden,
  };

  if (!hasData) {
    return (
      <div
        className={`not-prose my-6 rounded-[var(--chart-radius)] border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}
      >
        {t("frame.empty")}
      </div>
    );
  }

  const Drawing = DRAWING_BY_KIND[config.kind];
  const DataTable = TABLE_BY_KIND[config.kind];
  const table = <DataTable config={config} lang={lang} />;

  return (
    <ChartFrame
      title={config.title}
      description={config.description}
      metric={config.metric}
      lang={lang}
      legend={legend}
      showLegend={config.showLegend}
      caption={caption}
      table={table}
      className={className}
    >
      <Drawing config={config} lang={lang} onSelect={onSelect} />
    </ChartFrame>
  );
}

/**
 * ROZDZIELNIK RODZAJÓW - `Record<ChartKind, ...>`, nie łańcuch trójargumentowy.
 *
 * CO TO ZMIENIA I DLACZEGO NIE JEST TO KOSMETYKA. Wcześniej rysunek i tabela
 * wybierały się zagnieżdżonym `? :` z gałęzią domyślną na końcu. Gałąź
 * domyślna znaczy, że rodzaj DOPISANY do `CHART_KINDS` i nieobsłużony tutaj
 * kompiluje się bez słowa protestu i rysuje się jako wykres kartezjański -
 * czyli autor wybiera „boxplot", a dostaje słupki. To jest dokładnie ta cicha
 * degradacja, którą ten PR naprawiał w pierwszeństwie `variant` nad `kind`,
 * i nie ma powodu, żeby wracała drugimi drzwiami.
 *
 * `Record<ChartKind, ...>` jest WYCZERPUJĄCY: brak wpisu to błąd kompilacji
 * w tym pliku, a nie milcząca degradacja u czytelnika. Bramka
 * `chartKinds.test.ts` pilnuje pięciu powierzchni autorskich, których
 * TypeScript nie widzi; ten typ pilnuje szóstej, którą widzi - i lepiej,
 * żeby robił to kompilator niż test.
 *
 * Wpisy powtarzające `CartesianChart` NIE SĄ redundancją do zwinięcia
 * gałęzią domyślną: mówią wprost, że linia, pole, słupki obu orientacji
 * i mostek dzielą jeden silnik, bo wszystkie kodują wartość długością albo
 * położeniem na wspólnej skali kategorialnej. Rozkłady i tarcza nie kodują
 * jej tak i dlatego mają własne komponenty.
 */
type KindView = (props: {
  config: ChartConfig;
  lang: ChartLang;
  onSelect?: ChartSelectHandler;
}) => ReactElement | null;

const DRAWING_BY_KIND: Record<ChartKind, KindView> = {
  line: CartesianChart,
  area: CartesianChart,
  bar: CartesianChart,
  "bar-horizontal": CartesianChart,
  waterfall: CartesianChart,
  pie: PieChart,
  donut: PieChart,
  histogram: HistogramChart,
  boxplot: BoxplotChart,
  beeswarm: BeeswarmChart,
  scatter: ScatterChart,
  heatmap: HeatmapChart,
  tornado: TornadoChart,
  fan: FanChart,
  "index-base": IndexBaseChart,
  "percent-stacked": PercentStackedChart,
  "small-multiples": SmallMultiplesChart,
};

/**
 * ALTERNATYWA TEKSTOWA per rodzaj. Ta sama reguła wyczerpania co wyżej i ten
 * sam powód: tabela dobrana gałęzią domyślną pokazywałaby dla rozkładu
 * kolumny szeregu czasowego, czyli liczby, których na rysunku nie ma.
 */
const TABLE_BY_KIND: Record<ChartKind, KindView> = {
  line: SeriesDataTable,
  area: SeriesDataTable,
  bar: SeriesDataTable,
  "bar-horizontal": SeriesDataTable,
  waterfall: WaterfallDataTable,
  pie: PieDataTable,
  donut: PieDataTable,
  histogram: HistogramDataTable,
  boxplot: BoxplotDataTable,
  beeswarm: BeeswarmDataTable,
  scatter: ScatterDataTable,
  heatmap: HeatmapDataTable,
  tornado: TornadoDataTable,
  fan: FanDataTable,
  "index-base": IndexBaseDataTable,
  "percent-stacked": PercentStackedDataTable,
  "small-multiples": SmallMultiplesDataTable,
};

/**
 * ALTERNATYWA TEKSTOWA BOXPLOTA - pięć liczb pozycyjnych na grupę plus
 * obserwacje odstające wypisane WARTOŚCIAMI, nie liczbą.
 *
 * Wypisanie ich wartościami jest tu decyzją, nie szczegółem: „3 obserwacje
 * odstające" mówi czytelnikowi, że coś odstaje, a nie mówi CO - a to jest
 * zwykle jedyna informacja, po którą przychodzi się do boxplota. Rysunek
 * pokazuje je jako kropki bez etykiet, więc bez tabeli ta informacja nie ma
 * drugiej drogi.
 */
/**
 * ALTERNATYWA TEKSTOWA WYKRESU PUNKTOWEGO - dwie tabele, bo niosą dwie różne
 * rzeczy.
 *
 * PIERWSZA to pary współrzędnych, i wypisuje TAKŻE pary NIEKOMPLETNE, z jawnym
 * powodem pominięcia. Para, która ma tylko jedną współrzędną, nie da się
 * narysować - ale nadal jest w danych, więc czytelnik, który liczy punkty na
 * rysunku i porównuje z `n` w podpisie, musi mieć gdzie znaleźć różnicę.
 * Rysunek nie ma jak o niej powiedzieć; tabela ma.
 *
 * DRUGA to trend, i jest osobna dlatego, że opisuje CHMURĘ, nie punkt.
 * Nachylenie nigdy nie jedzie tu bez R2 i bez n - model gwarantuje to
 * strukturalnie (`ScatterTableTrend` ma te pola wymagane), a tabela tę
 * gwarancję odwzorowuje. Linia regresji jest TWIERDZENIEM o zależności;
 * twierdzenie bez miary dopasowania i bez liczebności jest ozdobą, a wypisane
 * w tabeli bez nich wyglądałoby na fakt.
 */
/**
 * ALTERNATYWA TEKSTOWA MAPY CIEPŁA - macierz PLUS brzegi, bo bez brzegów
 * tabela jest dokładnie tym, co kolumna „czego unikać" nazywa tabelą liczb.
 *
 * Mapa ciepła istnieje po to, żeby czytelnik zobaczył, KTÓRY z dwóch
 * parametrów rusza wynikiem mocniej. Ta odpowiedź jest na rysunku widoczna
 * jako kierunek gradientu, a w tabeli musi stać LICZBĄ - stąd kolumna brzegu
 * przy każdym wierszu i wiersz brzegu pod każdą kolumną, a pod nimi zdanie
 * `dominant.*` z modelu. Sama siatka wartości pozostawiłaby czytelnika bez
 * rysunku z zadaniem, którego rysunek go właśnie zwalniał.
 *
 * Komórka bez danych jedzie jako `legend.empty`, a nie jako zero: zero jest
 * wynikiem, brak danych nie jest.
 */
/**
 * ALTERNATYWA TEKSTOWA TORNADA - ranking, a nie zbiór wierszy.
 *
 * Kolejność wierszy jest tu TREŚCIĄ, nie porządkiem prezentacji: tornado
 * istnieje po to, żeby czytelnik odczytał hierarchię wrażliwości, a ta
 * hierarchia na rysunku jest kolejnością od najszerszego paska do
 * najwęższego. Tabela zachowuje ją bez sortowania po swojemu i dokłada
 * kolumnę udziału w największej rozpiętości, bo „rozpiętość 8" nie mówi, czy
 * to dużo - mówi to dopiero „38% największej".
 *
 * Przypisy przy wierszu niosą dokładnie te fakty, które model wykrył
 * arytmetycznie: parametr odwrotny (wysoka wartość obniża wynik), rozpiętość
 * zerowa i baza poza przedziałem. Ciche zamienienie końców paska przy
 * parametrze odwrotnym pozbawiłoby czytelnika najciekawszej zwykle
 * informacji w całej analizie wrażliwości.
 */
function TornadoDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const tabela = tornadoTable(tornadoModelFromConfig(config));
  const liczba = (v: number | null | undefined): string =>
    v === null || v === undefined ? "-" : formatChartValue(v, lang, config.unit);
  const KOLUMNY = ["low", "high", "lowDelta", "highDelta", "swing"] as const;
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("tornado.table.parameter")}
          </th>
          {KOLUMNY.map((k) => (
            <th key={k} scope="col" className={CHART_TABLE_CLS.thNum}>
              {t(`tornado.table.${k}`)}
            </th>
          ))}
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t("tornado.table.spanShare")}
          </th>
        </tr>
      </thead>
      <tbody>
        {tabela.rows.map((r, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {r.label}
              {r.notes.length > 0 && (
                <span className="block text-[10px] font-normal text-muted-foreground">
                  {r.notes.map((n) => t(TORNADO_NOTE_KEYS[n])).join("; ")}
                </span>
              )}
            </th>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.low)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.high)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.lowDelta)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.highDelta)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.swing)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{formatPercent(r.spanShare, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Statystyki brzegu wiersza i kolumny mapy ciepła, w jednej kolejności dla
 * obu. Lista jest wspólna, bo brzeg wiersza i brzeg kolumny odpowiadają na to
 * samo pytanie w dwóch kierunkach - rozjazd między nimi kazałby czytelnikowi
 * uczyć się tabeli dwa razy.
 *
 * `count` jest LICZBĄ KOMÓREK, nie wartością danych, więc nie dostaje
 * jednostki: „5 mln komórek" byłoby zdaniem o niczym.
 */
type OdczytBrzegu = (
  m: HeatmapMargin,
  liczba: (v: number | null) => string,
  lang: ChartLang,
) => string;

const MARGINESY: Record<HeatmapMarginStat, OdczytBrzegu> = {
  count: (m, _liczba, lang) => formatChartValue(m.count, lang, ""),
  min: (m, liczba) => liczba(m.min),
  max: (m, liczba) => liczba(m.max),
  mean: (m, liczba) => liczba(m.mean),
  range: (m, liczba) => liczba(m.range),
};

function HeatmapDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const model = heatmapModelFromConfig(config);
  const tabela = heatmapTable(model);
  const liczba = (v: number | null): string =>
    v === null ? t("heatmap.legend.empty") : formatChartValue(v, lang, config.unit);
  const dominant = tabela.dominantAxis;
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("heatmap.table.row")}
            </th>
            {tabela.columnLabels.map((c, i) => (
              <th key={i} scope="col" className={CHART_TABLE_CLS.thNum}>
                {c}
              </th>
            ))}
            {/* BRZEG WIERSZA W KOMPLECIE, nie w dwóch liczbach. Średnia
                i rozstęp same nie odróżniają wiersza o kilku wypełnionych
                komórkach od wiersza pełnego - a mapa ciepła z lukami wygląda
                dokładnie tak samo jak mapa bez luk. Dlatego brzeg niesie też
                LICZBĘ policzonych komórek oraz minimum i maksimum: to po nich
                poznaje się wiersz o szerokim rozrzucie przy tej samej
                średniej, czyli dokładnie to, czego z kolorów nie widać. */}
            {HEATMAP_MARGIN_STATS.map((stat) => (
              <th key={stat} scope="col" className={CHART_TABLE_CLS.thNum}>
                {t(`heatmap.table.${stat}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
              </th>
              {r.cells.map((c, ci) => (
                <td key={ci} className={CHART_TABLE_CLS.tdNum}>
                  {liczba(c.value)}
                </td>
              ))}
              {HEATMAP_MARGIN_STATS.map((stat) => (
                <td key={stat} className={CHART_TABLE_CLS.tdNum}>
                  {MARGINESY[stat](r.margin, liczba, lang)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {/* BRZEG KOLUMNY tą samą listą co brzeg wiersza - jeden wiersz stopki
            na statystykę. Sama średnia kolumnowa nie mówi nic o rozrzucie,
            a to rozrzut odróżnia kolumnę, w której parametr rusza wynikiem
            równomiernie, od takiej, w której rusza nim w jednym wierszu. */}
        <tfoot>
          {HEATMAP_MARGIN_STATS.map((stat) => (
            <tr key={stat}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {t(`heatmap.table.${stat}`)}
              </th>
              {tabela.columnMargins.map((m, i) => (
                <td key={i} className={CHART_TABLE_CLS.tdNum}>
                  {MARGINESY[stat](m, liczba, lang)}
                </td>
              ))}
              {HEATMAP_MARGIN_STATS.map((k) => (
                <td key={k} className={CHART_TABLE_CLS.tdNum} />
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
      {dominant !== null && (
        <p className="mt-2 text-xs text-muted-foreground">{t(`heatmap.dominant.${dominant}`)}</p>
      )}
    </>
  );
}

function ScatterDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const tabela = scatterTable(scatterModelFromConfig(config));
  // JEDNOSTKA IDZIE TYLKO DO Y, i to jest ta sama reguła, którą stosuje dymek
  // rysunku: konfiguracja ma JEDNO pole `unit` i opisuje nim wartości serii,
  // a X pochodzi z etykiet albo z innej kolumny. Ta tabela dokleiła ją do obu
  // kolumn, więc przy `unit: " %"` wypisywała w kolumnie X procenty przy
  // liczbach, które procentami nie są. Zła jednostka jest gorsza niż jej brak:
  // brak każe czytelnikowi sprawdzić w podpisie, zła każe mu uwierzyć.
  const liczba = (v: number | null, unit: string): string =>
    v === null ? "-" : formatChartValue(v, lang, unit);
  const przypis = (r: (typeof tabela.rows)[number]): string => {
    const noty = [
      r.dropped ? t("scatter.table.dropped") : null,
      r.overplotted ? t("scatter.table.overplotted") : null,
    ].filter((n): n is string => n !== null);
    return noty.length > 0 ? noty.join(", ") : "";
  };
  const maPrzypisy = tabela.rows.some((r) => r.dropped || r.overplotted);
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("scatter.table.label")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("scatter.table.series")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("scatter.table.x")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("scatter.table.y")}
            </th>
            {maPrzypisy && <th scope="col" className={CHART_TABLE_CLS.th} />}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((r, i) => (
            <tr key={i}>
              {/* Myślnik zamiast pustego nagłówka wiersza: arkusz bez kolumny
                  etykiet dawał czytnikowi ekranu wiersz o pustej nazwie, czyli
                  komórkę, której nie da się zapowiedzieć. */}
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label === "" ? "-" : r.label}
              </th>
              <td className={CHART_TABLE_CLS.td}>{r.series}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.x, "")}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.y, config.unit)}</td>
              {maPrzypisy && <td className={CHART_TABLE_CLS.td}>{przypis(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {tabela.trends.length > 0 && (
        <table className={CHART_TABLE_CLS.table}>
          <caption className="sr-only">{t("scatter.trend.label")}</caption>
          <thead>
            <tr>
              <th scope="col" className={CHART_TABLE_CLS.th}>
                {t("scatter.table.series")}
              </th>
              {/* NAGŁÓWKI, nie zdania: `scatter.trend.n` i `.r2` są zdaniami
                  z wstawką („n = {{count}}"), której nagłówek nie ma czym
                  wypełnić - stała w nim surowa klamra. */}
              <th scope="col" className={CHART_TABLE_CLS.thNum}>
                {t("scatter.table.n")}
              </th>
              <th scope="col" className={CHART_TABLE_CLS.thNum}>
                {t("scatter.table.r2")}
              </th>
              <th scope="col" className={CHART_TABLE_CLS.th}>
                {t("scatter.trend.method")}
              </th>
            </tr>
          </thead>
          <tbody>
            {tabela.trends.map((tr, i) => (
              <tr key={i}>
                <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                  {tr.series}
                </th>
                <td className={CHART_TABLE_CLS.tdNum}>{formatChartValue(tr.n, lang, "")}</td>
                <td className={CHART_TABLE_CLS.tdNum}>{tr.r2 === null ? "-" : tr.r2.toFixed(2)}</td>
                <td className={CHART_TABLE_CLS.td}>{t("scatter.trend.notCausal")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function BoxplotDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const tabela = boxplotTable(boxplotModelFromConfig(config));
  const liczba = (v: number | null): string =>
    v === null ? "-" : formatChartValue(v, lang, config.unit);
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("boxplot.table.label")}
          </th>
          {(
            ["n", "min", "whiskerLow", "q1", "median", "q3", "whiskerHigh", "max", "iqr"] as const
          ).map((kol) => (
            <th key={kol} scope="col" className={CHART_TABLE_CLS.thNum}>
              {t(`boxplot.table.${kol}`)}
            </th>
          ))}
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("boxplot.table.outliers")}
          </th>
        </tr>
      </thead>
      <tbody>
        {tabela.rows.map((r, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {r.label}
            </th>
            <td className={CHART_TABLE_CLS.tdNum}>{formatChartValue(r.n, lang, "")}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.min)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.whiskerLow)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.q1)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.median)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.q3)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.whiskerHigh)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.max)}</td>
            <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.iqr)}</td>
            <td className={CHART_TABLE_CLS.td}>
              {r.outliers.length === 0
                ? "-"
                : r.outliers.map((v) => formatChartValue(v, lang, config.unit)).join(", ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * ALTERNATYWA TEKSTOWA ROJU - komplet pozycyjny ORAZ pełna lista obserwacji.
 *
 * Sam komplet pozycyjny byłby tu za mało, i to jest różnica wobec boxplota.
 * Beeswarm obiecuje, że widać KAŻDĄ obserwację, więc tabela musi unieść tę
 * samą obietnicę - inaczej czytelnik, który nie widzi rysunku, dostaje mniej
 * informacji niż ten, który go widzi, a to jest wprost odwrotność tego, po co
 * alternatywa tekstowa istnieje.
 */
function BeeswarmDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const tabela = beeswarmTable(beeswarmModelFromConfig(config));
  const POZYCYJNE = ["n", "min", "q1", "median", "q3", "max", "mean", "iqr"] as const;
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("beeswarm.table.group")}
            </th>
            {POZYCYJNE.map((kol) => (
              <th key={kol} scope="col" className={CHART_TABLE_CLS.thNum}>
                {t(`beeswarm.summary.${kol}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.groups.map((g, i) => (
            <tr key={i}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {g.label}
              </th>
              {POZYCYJNE.map((kol) => (
                <td key={kol} className={CHART_TABLE_CLS.tdNum}>
                  {/* Dwa różne braki, jedna kreska: rój bez kompletu
                      pozycyjnego i pole, którego model nie orzekł (rozstęp
                      kwartyli leżących po obu krańcach zakresu double).
                      Liczba zastępcza w którymkolwiek z nich byłaby
                      twierdzeniem o danych, którego nikt nie policzył. */}
                  {g.summary === null || g.summary[kol] === null
                    ? "-"
                    : formatChartValue(g.summary[kol], lang, kol === "n" ? "" : config.unit)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {tabela.groups.map((g, gi) => (
        <table key={gi} className={CHART_TABLE_CLS.table}>
          <caption className="sr-only">{g.label}</caption>
          <thead>
            <tr>
              <th scope="col" className={CHART_TABLE_CLS.th}>
                {t("beeswarm.table.label")}
              </th>
              <th scope="col" className={CHART_TABLE_CLS.thNum}>
                {t("beeswarm.table.value")}
              </th>
            </tr>
          </thead>
          <tbody>
            {g.observations.map((o, oi) => (
              <tr key={oi}>
                <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                  {o.label}
                </th>
                <td className={CHART_TABLE_CLS.tdNum}>
                  {formatChartValue(o.value, lang, config.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}

function SeriesDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  // Kolumna prognozy istnieje TYLKO wtedy, gdy prognoza istnieje - inaczej
  // tabela sugerowałaby podział, którego w danych nie ma.
  const forecastFrom = config.forecastFrom;
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("frame.category")}
          </th>
          {config.series.map((s) => (
            <th key={s.colorSlot + s.name} scope="col" className={CHART_TABLE_CLS.thNum}>
              {s.name || t("frame.value")}
            </th>
          ))}
          {forecastFrom !== null && (
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("forecast.label")}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {config.categories.map((cat, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {cat}
            </th>
            {config.series.map((s) => (
              <td key={s.colorSlot + s.name} className={CHART_TABLE_CLS.tdNum}>
                {s.values[i] === null
                  ? "-"
                  : formatChartValue(s.values[i] as number, lang, config.unit)}
              </td>
            ))}
            {forecastFrom !== null && (
              <td className={CHART_TABLE_CLS.td}>
                {i >= forecastFrom ? t("forecast.tableFlag") : ""}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Tabela mostka. Poza wkładem każdego kroku niesie POZIOM PO KROKU - to jest
 * liczba, której wodospad nie pokazuje wprost (słupek koduje sam wkład), więc
 * bez tej kolumny alternatywa tekstowa byłaby uboższa od grafiki. Ostatni
 * wiersz to suma kontrolna: mostek, którego składniki nie sumują się do
 * różnicy stanów, jest błędem, i tabela mówi to wprost, a nie po cichu.
 */
/**
 * ALTERNATYWA TEKSTOWA HISTOGRAMU - i to jest miejsce, w którym najłatwiej
 * popełnić błąd, którego zabrania kolumna "Czego unikać" z tabeli doboru
 * formy: "średnia bez rozproszenia". Jedna liczba na dole tabeli i sprawa
 * zamknięta. Dlatego KOMPLET POZYCYJNY (min, Q1, mediana, Q3, max, IQR
 * i średnia) jedzie tu w całości i nie jest do wyboru wywołującego.
 *
 * DWIE TABELE, NIE JEDNA. Przedziały i komplet pozycyjny mówią o różnych
 * rzeczach i mają różne nagłówki: sklejenie ich w jedną tabelę dałoby
 * kolumny, które dla połowy wierszy nic nie znaczą, a czytnik ekranu czyta
 * nagłówek do każdej komórki.
 *
 * KOLUMNA GĘSTOŚCI POJAWIA SIĘ WARUNKOWO - dokładnie wtedy, gdy to ona
 * niesie wysokość słupka (przedziały nierówne). Przy przedziałach równych
 * jest licznością przemnożoną przez stałą, więc nie dodaje informacji,
 * a rozsadza tabelę.
 */
function HistogramDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const model = histogramModelFromConfig(config);
  const tabela = histogramTable(model);
  const gestosc = tabela.valueEncodes === "density";
  const maEtykiety = tabela.rows.some((r) => r.members.length > 0);
  const s = tabela.summary;
  // `number | null`, bo rozstęp jest ORZECZENIEM i wolno mu zamilczeć:
  // kwartyle po obu krańcach zakresu double dają różnicę, której nie da się
  // zapisać, a wpisana tam liczba (dawniej zero) czytałaby się jak rozkład
  // zdegenerowany.
  const pozycyjne: Array<[string, number | null]> = [
    [t("histogram.summary.n"), s.n],
    [t("histogram.summary.min"), s.min],
    [t("histogram.summary.q1"), s.q1],
    [t("histogram.summary.median"), s.median],
    [t("histogram.summary.q3"), s.q3],
    [t("histogram.summary.max"), s.max],
    [t("histogram.summary.mean"), s.mean],
    [t("histogram.summary.iqr"), s.iqr],
  ];
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <caption className="sr-only">
          {t("histogram.rule.label", {
            rule: t(`histogram.rule.${tabela.rule}`),
            count: model.binCount,
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("histogram.table.bin")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("histogram.table.count")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("histogram.table.share")}
            </th>
            {gestosc && (
              <th scope="col" className={CHART_TABLE_CLS.thNum}>
                {t("histogram.table.density")}
              </th>
            )}
            {maEtykiety && (
              <th scope="col" className={CHART_TABLE_CLS.th}>
                {t("histogram.table.members")}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((r, i) => (
            <tr key={i}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
              </th>
              <td className={CHART_TABLE_CLS.tdNum}>{formatChartValue(r.count, lang, "")}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{formatPercent(r.share, lang)}</td>
              {gestosc && (
                <td className={CHART_TABLE_CLS.tdNum}>
                  {r.density === null ? "-" : formatChartValue(r.density, lang, "")}
                </td>
              )}
              {maEtykiety && <td className={CHART_TABLE_CLS.td}>{r.members.join(", ")}</td>}
            </tr>
          ))}
          <tr>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {t("histogram.table.total")}
            </th>
            <td className={CHART_TABLE_CLS.tdNum}>{formatChartValue(tabela.total, lang, "")}</td>
            <td className={CHART_TABLE_CLS.tdNum} />
            {gestosc && <td className={CHART_TABLE_CLS.tdNum} />}
            {maEtykiety && <td className={CHART_TABLE_CLS.td} />}
          </tr>
        </tbody>
      </table>

      <table className={CHART_TABLE_CLS.table}>
        <caption className="sr-only">{t("histogram.table.summary")}</caption>
        <tbody>
          {pozycyjne.map(([nazwa, wartosc]) => (
            <tr key={nazwa}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {nazwa}
              </th>
              <td className={CHART_TABLE_CLS.tdNum}>
                {wartosc === null
                  ? "-"
                  : formatChartValue(
                      wartosc,
                      lang,
                      nazwa === t("histogram.summary.n") ? "" : config.unit,
                    )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function WaterfallDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  // Prefiks przez `keyPrefix` haka - tylko taki widzi bramka rozjazdu
  // kod<->słownik; klucz sklejony template literalem wypada z kontroli
  // parytetu PL/EN.
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const model = waterfallModel(config.categories, config.series[0]?.values ?? []);
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("frame.category")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("frame.value")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("waterfall.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {model.steps.map((step) => (
            <tr key={step.index}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {step.label}
              </th>
              <td className={CHART_TABLE_CLS.tdNum}>
                {formatChartValue(step.value, lang, config.unit)}
              </td>
              <td className={CHART_TABLE_CLS.tdNum}>
                {formatChartValue(step.kind === "step" ? step.to : step.value, lang, config.unit)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.checksumOk === false && (
        <p className="mt-2 text-xs" style={{ color: "var(--chart-negative-text)" }}>
          {t("waterfall.checksumFailed", {
            sum: formatChartValue(model.componentSum, lang, config.unit),
            delta: formatChartValue(model.stateDelta, lang, config.unit),
          })}
        </p>
      )}
    </>
  );
}

function PieDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const values = config.categories.map((label, i) => ({
    label,
    value: config.series[0]?.values[i] ?? null,
  }));
  // Mianownik TEN SAM, którym liczy kąty tarcza (`pieModel`): suma dodatnich.
  // Sumowanie wszystkiego rozjeżdżało grafikę z jej alternatywą tekstową -
  // zestaw [-10, 100] dawał na tarczy jeden wycinek 100%, a w tabeli "111%"
  // i "-11,1%". Każdy wiersz zostaje (tabela to jedyna pełna droga do liczb),
  // ale udział mówi o tym, co tarcza rzeczywiście rysuje.
  const { total } = pieModel(config, lang);
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          <th scope="col" className={CHART_TABLE_CLS.th}>
            {t("frame.category")}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t("frame.value")}
          </th>
          <th scope="col" className={CHART_TABLE_CLS.thNum}>
            {t("frame.share")}
          </th>
        </tr>
      </thead>
      <tbody>
        {values.map((v, i) => (
          <tr key={i}>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {v.label}
            </th>
            <td className={CHART_TABLE_CLS.tdNum}>
              {v.value === null ? "-" : formatChartValue(v.value, lang, config.unit)}
            </td>
            <td className={CHART_TABLE_CLS.tdNum}>
              {v.value === null || total <= 0 ? "-" : formatPercent(pieShare(v.value, total), lang)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * ALTERNATYWY TEKSTOWE CZTERECH RODZAJÓW BEZ RYSUNKU                  *
 *                                                                     *
 * Cztery tabele niżej są EKSPORTOWANE, choć nie stoi przy nich jeszcze *
 * ani jeden wpis w `CHART_KINDS`, `DRAWING_BY_KIND` i `TABLE_BY_KIND`: *
 * obie mapy są `Record<ChartKind, ...>`, więc dopisanie rodzaju bez    *
 * gotowego komponentu rysującego nie skompilowałoby całego drzewa,     *
 * a bez eksportu `noUnusedLocals` oblewałby ten plik jako martwy kod.  *
 * Domknie to osobna zmiana, gdy rysunki będą gotowe.                   *
 * ------------------------------------------------------------------ */

/**
 * Przypis wiersza wachlarza -> klucz słownika, JAWNIE i wyczerpująco - ta sama
 * reguła co `TORNADO_NOTE_KEYS` na górze pliku i z tego samego powodu: klucz
 * sklejony z wartości unii (`fan.note.${n}`) jest niewidoczny dla trzech
 * bramek i18n, a raz wypuścił na stronę publiczną napis
 * „tornado.note.oneLegged".
 *
 * Zapis bez wywołania `t` jest tu celowy: bramka `chartDictionaryKeys` szuka
 * sklejeń w źródle BEZ maskowania komentarzy, więc pełny cytat wzorca
 * oblewałby ją na własnej dokumentacji.
 */
const FAN_NOTE_KEYS: Record<FanRowNote, string> = {
  gap: "fan.note.gap",
  centralOutside: "fan.note.centralOutside",
  crossing: "fan.note.crossing",
  zeroWidth: "fan.note.zeroWidth",
  inverted: "fan.note.inverted",
  bandOverHistory: "fan.note.bandOverHistory",
  bandGap: "fan.note.bandGap",
  narrowing: "fan.note.narrowing",
  anchor: "fan.note.anchor",
  boundary: "fan.note.boundary",
};

/** Skąd wzięły się pasma - zdanie pod tabelą. Mapa jawna, nie sklejenie. */
const FAN_BAND_SOURCE_KEYS: Record<FanBandSource, string> = {
  series: "fan.bandSource.series",
  levels: "fan.bandSource.levels",
  bandPct: "fan.bandSource.bandPct",
  none: "fan.bandSource.none",
};

/** Skąd wzięła się ścieżka centralna - drugie zdanie pod tabelą. */
const FAN_CENTRAL_SOURCE_KEYS: Record<FanCentralSource, string> = {
  option: "fan.centralSource.option",
  name: "fan.centralSource.name",
  fallback: "fan.centralSource.fallback",
  none: "fan.centralSource.none",
};

/**
 * Stałe kolumny wachlarza z listy modelu (`FAN_COLUMNS`) - po niej wolno
 * iterować, ale klucz i tak idzie mapą: bramka `chartDictionaryKeys.test.ts`
 * zna wyłącznie prefiksy wpisane na swoją listę, a tej bramki nie wolno tu
 * zmieniać, więc sklejenie `fan.table.${k}` nie byłoby przez nic sprawdzone.
 */
const FAN_COLUMN_KEYS: Record<FanColumnKey, string> = {
  step: "fan.table.step",
  phase: "fan.table.phase",
  central: "fan.table.central",
};

/** Które ze stałych kolumn niosą liczbę - decyduje o wyrównaniu nagłówka. */
const FAN_COLUMN_NUM: Record<FanColumnKey, boolean> = {
  step: false,
  phase: false,
  central: true,
};

/**
 * Faza kroku. Nazwy biorę ze WSPÓLNEGO bloku `forecast.*`, a nie z osobnych
 * kluczy wachlarza: to są dokładnie te dwa słowa, którymi cały silnik nazywa
 * pomiar i przewidywanie (tak podpisuje strefę prognozy wykres kartezjański),
 * a drugi komplet o tej samej treści rozjechałby się przy pierwszym
 * przekładzie.
 */
const FAN_PHASE_KEYS: Record<"history" | "forecast", string> = {
  history: "forecast.historyLabel",
  forecast: "forecast.label",
};

/**
 * Trójka kolumn jednego poziomu pewności. Lista jest LOKALNA, bo model jej nie
 * eksportuje (`FAN_COLUMNS` celowo trzyma tylko kolumny STAŁE - kolumn pasm
 * jest po trzy na poziom i ich liczba zmienia się z danymi).
 */
const FAN_BAND_COLUMNS = ["lower", "upper", "width"] as const;

const FAN_BAND_COLUMN_KEYS: Record<(typeof FAN_BAND_COLUMNS)[number], string> = {
  lower: "fan.table.lower",
  upper: "fan.table.upper",
  width: "fan.table.width",
};

/**
 * ALTERNATYWA TEKSTOWA WACHLARZA - i to jest rodzaj, w którym tabela waży
 * najwięcej z całego silnika.
 *
 * Powód stoi w nagłówku `fanTable`: krawędź pasma jest JEDYNĄ liczbą tego
 * wykresu, której nie da się odczytać z rysunku. Pasmo ma kilkanaście procent
 * krycia, nie ma przy sobie podziałki, a przy trzech zagnieżdżonych poziomach
 * nikt nie odróżni na oko krawędzi 80% od 95%. Dlatego każdy poziom dostaje tu
 * PEŁNĄ trójkę - dolną, górną i szerokość - a nie samą szerokość: szerokość
 * mówi, ile niepewności, ale nie mówi, WOKÓŁ CZEGO ona leży.
 *
 * Wszystkie liczby są przepisane z gotowego modelu. Policzenie krawędzi po raz
 * drugi (choćby z centrum i procentu) rozjechałoby tabelę z rysunkiem przy
 * każdym pasmie podanym wprost - i nikt by tego nie zauważył, bo obie liczby
 * wyglądałyby równie wiarygodnie.
 */
export function FanDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  // `centralSource` jest polem MODELU, nie tabeli, więc model zostaje pod ręką.
  const model = fanModelFromConfig(config);
  const tabela = fanTable(model);
  const liczba = (v: number | null): string =>
    v === null ? "-" : formatChartValue(v, lang, config.unit);
  const maPasma = tabela.levels.length > 0;
  /**
   * Nagłówek kolumn pasma. Procent pewności wchodzi WYŁĄCZNIE wtedy, gdy autor
   * go podał: `hasKnownConfidence === false` albo `confidence === null` znaczy,
   * że zadeklarowana była sama szerokość (±%), a dopisanie tam „80%" byłoby
   * liczbą, której nikt nie policzył.
   */
  const etykietaPasma = (confidence: number | null): string =>
    !tabela.hasKnownConfidence || confidence === null
      ? t("fan.band.unknown")
      : t("fan.band.label", { confidence });
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            {FAN_COLUMNS.map((kol) => (
              <th
                key={kol}
                scope="col"
                rowSpan={maPasma ? 2 : 1}
                className={FAN_COLUMN_NUM[kol] ? CHART_TABLE_CLS.thNum : CHART_TABLE_CLS.th}
              >
                {t(FAN_COLUMN_KEYS[kol])}
              </th>
            ))}
            {tabela.levels.map((poziom) => (
              <th
                key={poziom.key}
                scope="colgroup"
                colSpan={FAN_BAND_COLUMNS.length}
                className={CHART_TABLE_CLS.thNum}
              >
                {etykietaPasma(poziom.confidence)}
              </th>
            ))}
          </tr>
          {maPasma && (
            <tr>
              {tabela.levels.map((poziom) =>
                FAN_BAND_COLUMNS.map((kol) => (
                  <th key={`${poziom.key}-${kol}`} scope="col" className={CHART_TABLE_CLS.thNum}>
                    {t(FAN_BAND_COLUMN_KEYS[kol])}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {tabela.rows.map((r) => (
            <tr key={r.index}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
                {r.notes.length > 0 && (
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {r.notes.map((n) => t(FAN_NOTE_KEYS[n])).join("; ")}
                  </span>
                )}
              </th>
              <td className={CHART_TABLE_CLS.td}>{t(FAN_PHASE_KEYS[r.phase])}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.central)}</td>
              {r.bands.map((b, bi) => (
                // Krok bez pasma to `null` w krawędziach, czyli MILCZENIE
                // modelu - i jedzie kreską. Zero wyglądałoby tu jak przedział
                // zwężony do punktu, czyli jak twierdzenie „tę wartość znam
                // dokładnie", a to jest mocniejsze niż cokolwiek na rysunku.
                <Fragment key={`${b.levelKey}-${bi}`}>
                  <td className={CHART_TABLE_CLS.tdNum}>{liczba(b.lower)}</td>
                  <td className={CHART_TABLE_CLS.tdNum}>{liczba(b.upper)}</td>
                  <td className={CHART_TABLE_CLS.tdNum}>{liczba(b.width)}</td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-muted-foreground">
        {t(FAN_BAND_SOURCE_KEYS[tabela.bandSource])}{" "}
        {t(FAN_CENTRAL_SOURCE_KEYS[model.centralSource])}
      </p>
      {/* Liczebność jedzie z jednostką PUSTĄ: „12 mld EUR" zamiast
          „12 obserwacji" byłoby zdaniem fałszywym o próbce. */}
      <p className="mt-1 text-xs text-muted-foreground">
        {t("fan.table.observations")}: {formatChartValue(tabela.observationCount, lang, "")}
      </p>
    </>
  );
}

/** Przyczyna odrzucenia serii z rysunku indeksu - mapa jawna, nie sklejenie. */
const INDEX_BASE_REJECTION_KEYS: Record<IndexBaseRejection, string> = {
  missingBase: "indexBase.rejection.missingBase",
  zeroBase: "indexBase.rejection.zeroBase",
  negativeBase: "indexBase.rejection.negativeBase",
};

/** Przypis przy serii indeksu - pięć wartości unii, pięć kluczy. */
const INDEX_BASE_NOTE_KEYS: Record<IndexBaseSeriesNote, string> = {
  noBase: "indexBase.note.noBase",
  extremeBase: "indexBase.note.extremeBase",
  mixedSign: "indexBase.note.mixedSign",
  unrepresentable: "indexBase.note.unrepresentable",
  flat: "indexBase.note.flat",
};

/** Skąd wziął się okres bazowy - zdanie pod tabelą. */
const INDEX_BASE_SOURCE_KEYS: Record<IndexBaseSource, string> = {
  explicit: "indexBase.base.source.explicit",
  first: "indexBase.base.source.first",
  none: "indexBase.base.source.none",
};

/** Kolumny indeksu z listy modelu - iteracja po `INDEX_BASE_COLUMNS`, klucz mapą. */
const INDEX_BASE_COLUMN_KEYS: Record<IndexBaseColumnKey, string> = {
  period: "indexBase.table.period",
  source: "indexBase.table.source",
  index: "indexBase.table.index",
};

/**
 * Kolumny POWTARZANE przy każdej serii: `INDEX_BASE_COLUMNS` bez `period`,
 * który jest nagłówkiem wiersza, a nie kolumną w grupie serii. Filtr zamiast
 * drugiej listy, żeby kolejność „source obok index" miała jedno źródło.
 */
const INDEX_BASE_PAIR = INDEX_BASE_COLUMNS.filter(
  (kol): kol is Exclude<IndexBaseColumnKey, "period"> => kol !== "period",
);

/**
 * ALTERNATYWA TEKSTOWA LINII NA INDEKSIE - wartość źródłowa stoi OBOK indeksu
 * i to jest najważniejsza cecha tej tabeli.
 *
 * Powód stoi przy `INDEX_BASE_COLUMNS`: rysunek pokazuje TEMPO i nie ma na nim
 * ani jednostki, ani poziomu. Gdyby tabela powtarzała sam indeks, wartości
 * źródłowe nie istniałyby w bloku nigdzie - a wtedy indeks przestałby być
 * przeliczeniem danych i stałby się ich podmianą.
 *
 * SERIA ODRZUCONA NIE ZNIKA. Seria bez użytecznej bazy nie ma linii na
 * rysunku, ale jej liczby źródłowe zostają w wierszach, a przyczyna stoi
 * nazwana w tabeli statusu: seria nieobecna bez podanego powodu czyta się jak
 * seria, której autor nie wpisał.
 */
export function IndexBaseDataTable({ config, lang }: { config: ChartConfig; lang: ChartLang }) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string, values?: Record<string, string | number>): string =>
    scoped(key, { lng: lang, ...values });
  const tabela = indexBaseTable(indexBaseModelFromConfig(config));
  // JEDNOSTKA IDZIE WYŁĄCZNIE DO KOLUMNY ŹRÓDŁOWEJ. Indeks jest ilorazem
  // dwóch wartości w tej samej jednostce, czyli jest bezwymiarowy - „110 mld
  // EUR" przy indeksie byłoby zdaniem fałszywym o każdej liczbie w kolumnie,
  // a model mówi to wprost polem `indexUnit: null`.
  const zrodlo = (v: number | null): string =>
    v === null ? "-" : formatChartValue(v, lang, tabela.sourceUnit);
  const indeks = (v: number | null): string => (v === null ? "-" : formatChartValue(v, lang, ""));
  const maJednostke = tabela.sourceUnit.trim() !== "";
  const naglowekPary = (kol: Exclude<IndexBaseColumnKey, "period">): string =>
    kol === "source" && maJednostke
      ? t("indexBase.table.sourceUnit", { unit: tabela.sourceUnit.trim() })
      : t(INDEX_BASE_COLUMN_KEYS[kol]);
  const maSerie = tabela.series.length > 0;
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" rowSpan={maSerie ? 2 : 1} className={CHART_TABLE_CLS.th}>
              {t(INDEX_BASE_COLUMN_KEYS.period)}
            </th>
            {tabela.series.map((s) => (
              <th
                key={s.index}
                scope="colgroup"
                colSpan={INDEX_BASE_PAIR.length}
                className={CHART_TABLE_CLS.thNum}
              >
                {s.name}
              </th>
            ))}
          </tr>
          {maSerie && (
            <tr>
              {tabela.series.map((s) =>
                INDEX_BASE_PAIR.map((kol) => (
                  <th key={`${s.index}-${kol}`} scope="col" className={CHART_TABLE_CLS.thNum}>
                    {naglowekPary(kol)}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {tabela.rows.map((r) => (
            <tr key={r.period}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
                {/* WIERSZ BAZOWY OZNACZONY, bo to jedyne miejsce, w którym
                    czytelnik widzi, wobec czego czyta cały wykres: tu każda
                    seria z rysunku ma dokładnie sto. */}
                {r.isBase && (
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {t("indexBase.table.baseRow")}
                  </span>
                )}
              </th>
              {r.cells.map((c) => (
                <Fragment key={c.seriesIndex}>
                  <td className={CHART_TABLE_CLS.tdNum}>{zrodlo(c.source)}</td>
                  <td className={CHART_TABLE_CLS.tdNum}>{indeks(c.indexed)}</td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <table className={CHART_TABLE_CLS.table}>
        {/* Podpis NAZYWA tabelę, a nie powtarza nazwy jednej z jej kolumn.
            Na wspólnym kluczu `table.status` czytelnik ekranu słyszał „Status
            serii" jako nazwę tabeli i zaraz potem jako nagłówek kolumny, więc
            z podpisu nie dowiadywał się niczego. */}
        <caption className="sr-only">{t("indexBase.table.bases")}</caption>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("indexBase.table.series")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("indexBase.table.base")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("indexBase.table.baseToMedian")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t("indexBase.table.status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {tabela.series.map((s) => (
            <tr key={s.index}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {s.name}
              </th>
              <td className={CHART_TABLE_CLS.tdNum}>{zrodlo(s.base)}</td>
              {/* Stosunek bazy do mediany jest ILORAZEM, więc bez jednostki -
                  ta sama reguła co przy samym indeksie. */}
              <td className={CHART_TABLE_CLS.tdNum}>{indeks(s.baseToMedian)}</td>
              <td className={CHART_TABLE_CLS.td}>
                {[
                  s.rejection === null ? null : t(INDEX_BASE_REJECTION_KEYS[s.rejection]),
                  ...s.notes.map((n) => t(INDEX_BASE_NOTE_KEYS[n])),
                ]
                  .filter((zdanie): zdanie is string => zdanie !== null)
                  .join("; ") || "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-muted-foreground">
        {/* BEZ NAZWY OKRESU BAZOWEGO NIE OGŁASZAMY BAZY. `base.label` brzmi
            „Baza: {{period}} = 100", a przy `baseSource === "none"` model daje
            `baseLabel` pusty - wychodziło z tego „Baza:  = 100" z podwójną
            spacją, czyli zdanie TWIERDZĄCE, że jakiś okres bazowy równa się
            stu, postawione bezpośrednio przed zdaniem mówiącym, że okresu
            bazowego nie ma. Sama wstawka była wypełniona, więc żadna bramka
            i18n tego nie widziała - pustego napisu nie da się odróżnić od
            nazwy okresu. Zostaje wtedy samo zdanie o przyczynie, które i tak
            niesie całą treść. */}
        {tabela.baseLabel === "" ? null : (
          <>{t("indexBase.base.label", { period: tabela.baseLabel })} </>
        )}
        {t(INDEX_BASE_SOURCE_KEYS[tabela.baseSource])}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{t("indexBase.axis.unitless")}</p>
    </>
  );
}

/** Przypis komórki stosu - pięć wartości unii, pięć kluczy, mapa jawna. */
const PERCENT_STACKED_CELL_NOTE_KEYS: Record<PercentStackedCellNote, string> = {
  zero: "percentStacked.cellNote.zero",
  missing: "percentStacked.cellNote.missing",
  negative: "percentStacked.cellNote.negative",
  tooLarge: "percentStacked.cellNote.tooLarge",
  noShare: "percentStacked.cellNote.noShare",
};

/** Przypis wiersza stosu - sześć wartości unii, sześć kluczy. */
const PERCENT_STACKED_ROW_NOTE_KEYS: Record<PercentStackedRowNote, string> = {
  empty: "percentStacked.note.empty",
  zeroTotal: "percentStacked.note.zeroTotal",
  rejected: "percentStacked.note.rejected",
  incomplete: "percentStacked.note.incomplete",
  rescaled: "percentStacked.note.rescaled",
  duplicate: "percentStacked.note.duplicate",
};

/** Kolumny stosu z listy modelu - iteracja po `PERCENT_STACKED_COLUMNS`, klucz mapą. */
const PERCENT_STACKED_COLUMN_KEYS: Record<PercentStackedColumnKey, string> = {
  category: "percentStacked.table.category",
  series: "percentStacked.table.series",
  value: "percentStacked.table.value",
  share: "percentStacked.table.share",
  total: "percentStacked.table.total",
};

/**
 * Jeden wiersz tabeli stosu: para (kategoria, seria). `c === null` znaczy
 * kategorię, w której nie ma ani jednej serii - taki wiersz zostaje, bo
 * kategoria stojąca na osi bez słupka jest faktem o danych.
 */
interface ParaStosu {
  r: PercentStackedTableRow;
  c: PercentStackedTableCell | null;
  pierwszy: boolean;
}

/** Które kolumny stosu niosą liczbę - decyduje o wyrównaniu nagłówka. */
const PERCENT_STACKED_COLUMN_NUM: Record<PercentStackedColumnKey, boolean> = {
  category: false,
  series: false,
  value: true,
  share: true,
  total: true,
};

/**
 * ALTERNATYWA TEKSTOWA STOSU 100% - WIERSZ NA PARĘ (kategoria, seria), a nie
 * kategoria z kolumnami serii, i ten wybór ma powód mierzalny przy ośmiu
 * seriach.
 *
 * Wariant macierzowy musiałby w jednej komórce zmieścić trzy różne rzeczy
 * (wartość bezwzględną, udział i przypis stanu), więc przy ośmiu seriach
 * dawałby siedemnaście kolumn, z których żadna nie mieści się na telefonie,
 * a czytnik ekranowy zapowiadałby do każdej komórki nagłówek złożony z nazwy
 * serii i nazwy podkolumny. Wariant parowy ma PIĘĆ kolumn niezależnie od
 * liczby serii, każdą z jednym nagłówkiem, i rośnie w dół - a w dół strona
 * rośnie za darmo.
 *
 * SUMA BEZWZGLĘDNA JEST OBOWIĄZKOWA. Stos 100% z definicji wyrzuca poziom:
 * dwa słupki o identycznej strukturze mogą różnić się rzędem wielkości
 * i wyglądają wtedy tak samo. Tabela jest jedynym miejscem, w którym czytelnik
 * tę różnicę zobaczy, więc kolumna sumy nie jest tu dodatkiem.
 */
export function PercentStackedDataTable({
  config,
  lang,
}: {
  config: ChartConfig;
  lang: ChartLang;
}) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  const tabela = percentStackedTable(percentStackedModelFromConfig(config));
  /**
   * Kategoria bez ani jednej serii nie może wypaść z tabeli: kategoria, która
   * na osi stoi bez słupka, jest faktem o danych, a tabela bez jej wiersza
   * mówiłaby, że autor jej nie wpisał. Taki wiersz jedzie z komórką `null`.
   */
  const wiersze = tabela.rows.flatMap((r): ParaStosu[] =>
    r.cells.length > 0
      ? r.cells.map((c, ci) => ({ r, c, pierwszy: ci === 0 }))
      : [{ r, c: null, pierwszy: true }],
  );
  const maPrzypisyKomorek = tabela.rows.some((r) => r.cells.some((c) => c.notes.length > 0));
  return (
    <table className={CHART_TABLE_CLS.table}>
      <thead>
        <tr>
          {PERCENT_STACKED_COLUMNS.map((kol) => (
            <th
              key={kol}
              scope="col"
              className={
                PERCENT_STACKED_COLUMN_NUM[kol] ? CHART_TABLE_CLS.thNum : CHART_TABLE_CLS.th
              }
            >
              {t(PERCENT_STACKED_COLUMN_KEYS[kol])}
            </th>
          ))}
          {maPrzypisyKomorek && <th scope="col" className={CHART_TABLE_CLS.th} />}
        </tr>
      </thead>
      <tbody>
        {wiersze.map(({ r, c, pierwszy }, i) => {
          // MIANOWNIK ALBO JEGO BRAK. `total` wychodzi z modelu jako zero
          // zarówno dla słupka o sumie rzeczywiście zerowej, jak i dla słupka
          // pustego albo odrzuconego - a to są trzy różne zdania. Udział bez
          // mianownika nie istnieje, więc idzie kreską; zero wpisane w tę
          // komórkę czytałoby się jak zmierzony udział zerowy.
          const maMianownik = r.total > 0;
          const bezSumy = r.notes.includes("empty") || r.notes.includes("rejected");
          return (
            <tr key={i}>
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
                {/* Przypis wiersza raz na kategorię, przy jej pierwszej parze:
                    powtórzony przy każdej serii byłby ośmioma kopiami tego
                    samego zdania w jednym słupku. */}
                {pierwszy && r.notes.length > 0 && (
                  <span className="block text-[10px] font-normal text-muted-foreground">
                    {r.notes.map((n) => t(PERCENT_STACKED_ROW_NOTE_KEYS[n])).join("; ")}
                  </span>
                )}
              </th>
              <td className={CHART_TABLE_CLS.td}>{c === null ? "-" : c.seriesName}</td>
              <td className={CHART_TABLE_CLS.tdNum}>
                {c === null || c.value === null
                  ? "-"
                  : formatChartValue(c.value, lang, config.unit)}
              </td>
              <td className={CHART_TABLE_CLS.tdNum}>
                {c === null || !maMianownik ? "-" : formatPercent(c.share, lang)}
              </td>
              <td className={CHART_TABLE_CLS.tdNum}>
                {bezSumy ? "-" : formatChartValue(r.total, lang, config.unit)}
              </td>
              {maPrzypisyKomorek && (
                <td className={CHART_TABLE_CLS.td}>
                  {c === null
                    ? ""
                    : c.notes.map((n) => t(PERCENT_STACKED_CELL_NOTE_KEYS[n])).join("; ")}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Tryb skali paneli - dwie wartości unii, dwa zdania, mapa jawna. */
const SMALL_MULTIPLES_SCALE_KEYS: Record<SmallMultiplesScaleMode, string> = {
  shared: "smallMultiples.scale.shared",
  free: "smallMultiples.scale.free",
};

/** Porządek paneli - sześć wartości unii, sześć zdań. */
const SMALL_MULTIPLES_ORDER_KEYS: Record<SmallMultiplesOrder, string> = {
  mean: "smallMultiples.order.mean",
  max: "smallMultiples.order.max",
  span: "smallMultiples.order.span",
  last: "smallMultiples.order.last",
  label: "smallMultiples.order.label",
  input: "smallMultiples.order.input",
};

/**
 * Przypisy panelu. Lista jest LOKALNA i celowo węższa od bloku `note.*`
 * w słowniku: `clamped` opisuje punkt przycięty do krawędzi panelu, a wiersz
 * tabeli tego faktu nie niesie (`SmallMultiplesPointState` ma tylko "value"
 * i "gap"), więc wypisanie go tutaj byłoby zdaniem bez pokrycia w modelu.
 */
const SMALL_MULTIPLES_NOTE_KEYS = {
  empty: "smallMultiples.note.empty",
  flattened: "smallMultiples.note.flattened",
  gap: "smallMultiples.note.gap",
  noIndexBase: "smallMultiples.note.noIndexBase",
} as const;

/** Kolumna podsumowania panelu bez `panel`, który jest nagłówkiem wiersza. */
type SmallMultiplesValueColumn = Exclude<SmallMultiplesSummaryColumn, "panel">;

const SMALL_MULTIPLES_COLUMN_KEYS: Record<SmallMultiplesSummaryColumn, string> = {
  panel: "smallMultiples.summary.panel",
  n: "smallMultiples.summary.n",
  min: "smallMultiples.summary.min",
  max: "smallMultiples.summary.max",
  mean: "smallMultiples.summary.mean",
  first: "smallMultiples.summary.first",
  last: "smallMultiples.summary.last",
  change: "smallMultiples.summary.change",
  changePct: "smallMultiples.summary.changePct",
  occupancy: "smallMultiples.summary.occupancy",
};

/**
 * Odczyt jednej kolumny podsumowania - ta sama konstrukcja co `MARGINESY` przy
 * mapie ciepła i z tego samego powodu: trzy z tych kolumn mierzą w czymś innym
 * niż dane (liczebność, procent zmiany, udział osi), więc wspólne
 * formatowanie po jednostce wykresu podpisałoby je fałszem.
 */
type OdczytPanelu = (
  r: SmallMultiplesTableRow,
  liczba: (v: number | null) => string,
  lang: ChartLang,
) => string;

const PANELE: Record<SmallMultiplesValueColumn, OdczytPanelu> = {
  // Liczebność obserwacji z jednostką PUSTĄ: „3 mld EUR" zamiast „3 punkty
  // pomiarowe" byłoby zdaniem fałszywym o próbce panelu.
  n: (r, _liczba, lang) => formatChartValue(r.n, lang, ""),
  min: (r, liczba) => liczba(r.min),
  max: (r, liczba) => liczba(r.max),
  mean: (r, liczba) => liczba(r.mean),
  first: (r, liczba) => liczba(r.first),
  last: (r, liczba) => liczba(r.last),
  change: (r, liczba) => liczba(r.change),
  // Model oddaje zmianę W PROCENTACH pierwszej wartości (50 znaczy +50%),
  // a `formatPercent` czyta ułamek - stąd dzielenie przez sto. `null` znaczy
  // procent od zera albo panel krótszy niż dwa punkty i zostaje milczeniem.
  changePct: (r, _liczba, lang) =>
    r.changePct === null ? "-" : formatPercent(r.changePct / 100, lang),
  occupancy: (r, _liczba, lang) => (r.occupancy === null ? "-" : formatPercent(r.occupancy, lang)),
};

/**
 * ALTERNATYWA TEKSTOWA PANELI - i to jedyny rodzaj, w którym tabela nie jest
 * zapisem rysunku, tylko RATUNKIEM.
 *
 * Panel spłaszczony przez wspólną oś pokazuje płaską kreskę: jego liczb nie da
 * się z obrazka odczytać nawet w przybliżeniu. Dlatego kolumna `occupancy`
 * zostaje na swoim miejscu - to jedyna liczba, która mówi czytelnikowi, JAKĄ
 * CZĘŚĆ osi ten panel zajmuje, czyli dlaczego dziewięć paneli jest płaskich.
 * Bez niej płaskość wygląda na własność danych, a jest własnością skali.
 *
 * TRYB SKALI I PORZĄDEK PANELI SĄ WYPISANE POD TABELĄ, bo od nich zależy,
 * czy panele wolno porównywać wzrokiem: przy osobnych osiach dwie linie na tej
 * samej wysokości mogą różnić się o rzędy wielkości, a kolejność paneli niesie
 * pierwsze wrażenie i musi być nazwana tak samo jak przy posortowanych
 * słupkach poziomych.
 */
export function SmallMultiplesDataTable({
  config,
  lang,
}: {
  config: ChartConfig;
  lang: ChartLang;
}) {
  const { t: scoped } = useTranslation("translation", { keyPrefix: "charts" });
  const t = (key: string): string => scoped(key, { lng: lang });
  // `order` jest polem MODELU, nie tabeli, więc model zostaje pod ręką.
  const model = smallMultiplesModelFromConfig(config);
  const tabela = smallMultiplesTable(model);
  // JEDNOSTKA STOI PRZY NAZWIE PANELU, a nie przy każdej liczbie - tak samo,
  // jak obiecuje zdanie `smallMultiples.reading.mixedUnits`. Panele bywają
  // WSKAŹNIKAMI o różnych jednostkach, więc jednostka jest własnością wiersza;
  // doklejona do sześciu liczb w wierszu byłaby sześcioma kopiami tej samej
  // informacji, a przy kolumnach liczebności i procentu - kopiami fałszywymi.
  const liczba = (v: number | null): string => (v === null ? "-" : formatChartValue(v, lang, ""));
  const przypisy = (r: SmallMultiplesTableRow): string[] => {
    const noty: string[] = [];
    if (r.empty) noty.push(t(SMALL_MULTIPLES_NOTE_KEYS.empty));
    if (r.flattened) noty.push(t(SMALL_MULTIPLES_NOTE_KEYS.flattened));
    // Panel pusty ma same luki, więc przypis o lukach byłby przy nim
    // powtórzeniem zdania, które już stoi obok.
    if (!r.empty && r.cells.some((c) => c.state === "gap")) {
      noty.push(t(SMALL_MULTIPLES_NOTE_KEYS.gap));
    }
    if (!r.empty && tabela.mode === "index" && r.indexBase === null) {
      noty.push(t(SMALL_MULTIPLES_NOTE_KEYS.noIndexBase));
    }
    return noty;
  };
  const KOLUMNY = SMALL_MULTIPLES_SUMMARY_COLUMNS.filter(
    (kol): kol is SmallMultiplesValueColumn => kol !== "panel",
  );
  return (
    <>
      <table className={CHART_TABLE_CLS.table}>
        <thead>
          <tr>
            <th scope="col" className={CHART_TABLE_CLS.th}>
              {t(SMALL_MULTIPLES_COLUMN_KEYS.panel)}
            </th>
            {KOLUMNY.map((kol) => (
              <th key={kol} scope="col" className={CHART_TABLE_CLS.thNum}>
                {t(SMALL_MULTIPLES_COLUMN_KEYS[kol])}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.rows.map((r) => {
            const noty = przypisy(r);
            return (
              <tr key={r.position}>
                <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                  {r.label}
                  {r.unit !== null && r.unit !== "" && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {r.unit}
                    </span>
                  )}
                  {noty.length > 0 && (
                    <span className="block text-[10px] font-normal text-muted-foreground">
                      {noty.join("; ")}
                    </span>
                  )}
                </th>
                {KOLUMNY.map((kol) => (
                  <td key={kol} className={CHART_TABLE_CLS.tdNum}>
                    {PANELE[kol](r, liczba, lang)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-2 text-xs text-muted-foreground">
        {t(SMALL_MULTIPLES_SCALE_KEYS[tabela.scaleMode])}{" "}
        {t(SMALL_MULTIPLES_ORDER_KEYS[model.order])}
      </p>
    </>
  );
}
