// Punkt wejścia silnika wykresów: ChartFrame (karta, legenda, tabela danych,
// podpis uczciwościowy) + właściwy rysunek zależnie od `kind`. Konsumowany
// przez blok CMS ("chart") i widget buildera ("chart") - jedna implementacja,
// obie platformy.
//
// TU SIĘ SKŁADA LEGENDA I TABELA, i to jest właściwe miejsce: legenda musi
// wskazywać dokładnie te znaczniki, które rysunek naprawdę narysował, a tabela
// musi liczyć udziały z tego samego mianownika, którym rysunek liczy kąty.
// Trzymanie obu w rysunku rozjeżdżało grafikę z jej alternatywą tekstową.
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ChartConfig } from "@/lib/charts/types";
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

  const legend: LegendItem[] = useMemo(() => {
    if (isWaterfall) {
      // Mostek nie ma serii - ma ZNAK. Klucz mówi więc o kierunku, i to jest
      // jedyna legenda, jaka ma tu sens; nazwy kroków niesie oś kategorii.
      return [
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
  }, [config, isPie, isWaterfall, t]);

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

  const table = isWaterfall ? (
    <WaterfallDataTable config={config} lang={lang} />
  ) : isPie ? (
    <PieDataTable config={config} lang={lang} />
  ) : (
    <SeriesDataTable config={config} lang={lang} />
  );

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
      {isPie ? (
        <PieChart config={config} lang={lang} />
      ) : (
        <CartesianChart config={config} lang={lang} />
      )}
    </ChartFrame>
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
