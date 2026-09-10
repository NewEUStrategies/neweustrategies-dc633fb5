// Punkt wejścia silnika wykresów: ChartFrame (karta, legenda, tabela danych,
// podpis uczciwościowy) + właściwy rysunek zależnie od `kind`. Konsumowany
// przez blok CMS ("chart") i widget buildera ("chart") - jedna implementacja,
// obie platformy.
//
// TU SIĘ SKŁADA LEGENDA I TABELA, i to jest właściwe miejsce: legenda musi
// wskazywać dokładnie te znaczniki, które rysunek naprawdę narysował, a tabela
// musi liczyć udziały z tego samego mianownika, którym rysunek liczy kąty.
// Trzymanie obu w rysunku rozjeżdżało grafikę z jej alternatywą tekstową.
import { useCallback, useMemo, type ReactElement } from "react";
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
import { histogramModelFromConfig, histogramTable } from "@/lib/charts/kinds/histogram";
import { boxplotModelFromConfig, boxplotTable } from "@/lib/charts/kinds/boxplot";
import { beeswarmModelFromConfig, beeswarmTable } from "@/lib/charts/kinds/beeswarm";
import { scatterModelFromConfig, scatterTable } from "@/lib/charts/kinds/scatter";
import { heatmapModelFromConfig, heatmapTable } from "@/lib/charts/kinds/heatmap";
import {
  tornadoModelFromConfig,
  tornadoTable,
  type TornadoRowNote,
} from "@/lib/charts/kinds/tornado";

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

interface ChartProps {
  config: ChartConfig;
  lang: ChartLang;
  className?: string;
}

export function Chart({ config, lang, className }: ChartProps) {
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
      <Drawing config={config} lang={lang} />
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
type KindView = (props: { config: ChartConfig; lang: ChartLang }) => ReactElement | null;

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
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("heatmap.table.mean")}
            </th>
            <th scope="col" className={CHART_TABLE_CLS.thNum}>
              {t("heatmap.table.range")}
            </th>
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
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.margin.mean)}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.margin.range)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
              {t("heatmap.table.mean")}
            </th>
            {tabela.columnMargins.map((m, i) => (
              <td key={i} className={CHART_TABLE_CLS.tdNum}>
                {liczba(m.mean)}
              </td>
            ))}
            <td className={CHART_TABLE_CLS.tdNum} />
            <td className={CHART_TABLE_CLS.tdNum} />
          </tr>
        </tbody>
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
  const liczba = (v: number | null): string =>
    v === null ? "-" : formatChartValue(v, lang, config.unit);
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
              <th scope="row" className={`${CHART_TABLE_CLS.td} font-medium`}>
                {r.label}
              </th>
              <td className={CHART_TABLE_CLS.td}>{r.series}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.x)}</td>
              <td className={CHART_TABLE_CLS.tdNum}>{liczba(r.y)}</td>
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
                  {g.summary === null
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
  const pozycyjne: Array<[string, number]> = [
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
                {formatChartValue(
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
