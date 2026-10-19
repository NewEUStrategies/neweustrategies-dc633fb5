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
//
// OBJAŚNIENIE I BENCHMARK Z REJESTRU (SPEC §5.5). Panel podaje `metricId`
// (i opcjonalnie zlokalizowany benchmark z `useBenchmark`), a ten plik
// wypełnia pola uczciwości, które silnik już renderuje: `metric` (dymek
// objaśnienia `MetricTooltip`), `band`/`target` (strefa „dobry + optymalny”),
// `sources` (przypisy AKTYWNEGO kontekstu), `direction` i `provenance` (B,
// gdy każde pasmo pochodzi z kwartyli źródła; E, gdy choć jedno jest
// heurystyką). Bez tych pól wynik jest identyczny jak dotąd - wstecznie zgodny.
import { defaultChartConfig } from "@/lib/charts/parse";
import { type ChartConfig, type ChartKind, type ChartSeries } from "@/lib/charts/types";
import type { BarStyle } from "@/lib/charts/palette";
import { slotForSeries } from "@/lib/charts/palette";
import type { ChartLang } from "@/lib/charts/format";
import type { ChartBand, ChartTarget, MetricDirection } from "@/lib/charts/status";
import type { Provenance } from "@/lib/charts/sources";
import {
  citationsFor,
  toChartMetric,
  type LocalizedBenchmark,
  type LocalizedContext,
  type LocalizedSource,
} from "@/lib/analytics/semantic/benchmarks/adapter";
import { normalizeToUnit } from "@/lib/analytics/semantic/benchmarks/evaluate";
import { metricHelp } from "@/lib/analytics/semantic/metricHelp";
import { metricById, type MetricId } from "@/lib/analytics/semantic/metrics";

/** Benchmark wykresu: wpis, AKTYWNY kontekst i źródła grupy (z `useBenchmark`). */
export interface BiChartBenchmark {
  bench: LocalizedBenchmark;
  context: LocalizedContext;
  sources: readonly LocalizedSource[];
}

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
  /** Wskaźnik z rejestru - dymek objaśnienia (`metricHelp`) i skala jednostek pasma. */
  metricId?: MetricId;
  /** Benchmark: strefa dobra, przypisy, kierunek i pochodzenie liczb. */
  benchmark?: BiChartBenchmark;
  /** Kierunek wskaźnika; domyślnie z aktywnego kontekstu benchmarku. */
  direction?: MetricDirection;
  /** Język objaśnienia z rejestru; domyślnie polski. */
  lang?: ChartLang;
}

/** Miary, dla których zero jest naturalną dolną granicą (poziomy, udziały, przeżycie kohorty). */
const NON_NEGATIVE = new Set<LocalizedContext["measure"]>([
  "level",
  "share_of_base",
  "cohort_survival",
]);
/** Miary-udziały: górną granicą jest całość (100 pp). */
const SHARE = new Set<LocalizedContext["measure"]>(["share_of_base", "cohort_survival"]);

/**
 * Strefa „dobry + optymalny” aktywnego kontekstu w jednostkach SERII.
 *
 * Pasma rejestru są w jednostce kontekstu (punkty procentowe, grosze,
 * godziny), a seria - w jednostce metryki (udział jako ułamek, dni); skalę
 * daje ta sama normalizacja co ocena (`normalizeToUnit`), więc wykres
 * i kafel nie mogą rozjechać się o rząd wielkości. Bez przeliczenia
 * (inna wielkość, kwota wobec procentu) strefy nie ma.
 *
 * OTWARTE KOŃCE. `ChartBand` jest przedziałem domkniętym. Koniec otwarty
 * zamykamy tylko tam, gdzie granica jest FAKTEM, a nie twierdzeniem: zero
 * dla poziomów i udziałów, 100 pp dla udziałów. Gdy strefa dalej jest
 * otwarta („NRR ≥ 110 %”), rysujemy LINIĘ PROGU (`target`) zamiast pasma -
 * dorysowana górna granica optimum byłaby liczbą bez źródła.
 */
export function benchmarkZone(
  context: LocalizedContext,
  metricId: MetricId | undefined,
): { band: { min: number; max: number } | null; target: number | null } {
  const none = { band: null, target: null };
  const good = context.bands
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.tier === "good" || b.tier === "optimal");
  if (good.length === 0) return none;
  const first = good[0].b;
  const last = good[good.length - 1].b;
  const scale = metricId ? normalizeToUnit(1, metricById(metricId).unit, context.unit) : 1;
  if (scale === null || scale === 0) return none;
  const natural = context.displayUnit !== "score" && NON_NEGATIVE.has(context.measure);
  const lo = first.min ?? (natural ? 0 : null);
  const ceiling = context.unit === "fraction" ? 1 : 100;
  const hi = last.max ?? (SHARE.has(context.measure) ? ceiling : null);
  if (lo !== null && hi !== null)
    return { band: { min: lo / scale, max: hi / scale }, target: null };
  const threshold = lo ?? hi;
  return threshold === null ? none : { band: null, target: threshold / scale };
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

/** Pola uczciwości z rejestru: objaśnienie, strefa, przypisy, kierunek, pochodzenie. */
function registryFields(
  input: BiChartInput,
  base: ChartConfig,
): Pick<ChartConfig, "metric" | "band" | "target" | "sources" | "direction" | "provenance"> {
  const lang = input.lang ?? "pl";
  const bench = input.benchmark;
  const metric = input.metricId
    ? metricHelp(input.metricId, lang, bench?.bench ?? null)
    : bench
      ? toChartMetric(bench.bench)
      : base.metric;
  if (!bench) {
    return {
      metric,
      band: base.band,
      target: base.target,
      sources: base.sources,
      direction: input.direction ?? base.direction,
      provenance: base.provenance,
    };
  }
  const sources = citationsFor(bench.context, bench.sources);
  const zone = benchmarkZone(bench.context, input.metricId);
  // Pasmo bez przypisu `effectiveBand` i tak by odrzucił - wskazujemy
  // pierwsze źródło aktywnego kontekstu (to ono wyznacza granice pasm).
  const sourceId = sources[0]?.id ?? null;
  const band: ChartBand | null =
    zone.band && sourceId !== null ? { ...zone.band, sourceId, demo: false } : null;
  const target: ChartTarget | null = zone.target !== null ? { value: zone.target } : base.target;
  const provenance: Provenance = bench.context.bands.every((b) => b.basis === "B") ? "B" : "E";
  return {
    metric,
    band,
    target,
    sources,
    direction: input.direction ?? bench.context.direction,
    provenance,
  };
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
    ...registryFields(input, base),
  };
}
