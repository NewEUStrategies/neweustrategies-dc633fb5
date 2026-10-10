// Schemat widgetu buildera `chart` - pola panelu w kolejności wyświetlania.
//
// Do PR2 stał w `WIDGET_SCHEMAS` w `schemas.ts`; tam zostało jedno odwołanie
// (`chart: CHART_WIDGET_SCHEMA`), więc wpis jest TYM SAMYM obiektem co przed
// przeniesieniem. Nowe pola widgetu wykresu dopisuje się TUTAJ - etykiety
// angielskie w `labelsEn.ts` (sekcja „chart widget (PR2)"), a przypadki
// `visibleWhen` w bramce `schemaVisibleWhen.test.ts`.
import type { SchemaField } from "../schemas";
import {
  CHART_COLORS_GROUP,
  CHART_DIRECTION_OPTIONS,
  CHART_FORECAST_GROUP,
  CHART_HONESTY_GROUP,
  CHART_PALETTE_OPTIONS,
  CHART_PROVENANCE_OPTIONS,
  CHART_REFERENCE_GROUP,
  CHART_RELIABILITY_OPTIONS,
  capsOfKind,
  chartColorsByCategory,
  chartColorsBySeries,
  chartHasForecast,
  chartHasForecastBand,
  hasChartBandEdges,
} from "./shared";

// POLA ODNIESIEŃ TYLKO TAM, GDZIE RODZAJ JE RYSUJE (`KIND_CAPS`), dokładnie
// jak w edytorze bloku CMS. Ukrycie pola nie kasuje zapisu: wartość zostaje
// w treści i wraca w panelu przy rodzaju, który ją rysuje. Predykaty wołają
// `capsOfKind(c.kind)` wprost, bo bramka zgodności ustawień rozpoznaje klucz
// widoczności po źródle predykatu.
const drawsTarget = (c: Record<string, unknown>): boolean => capsOfKind(c.kind).target;
const drawsBand = (c: Record<string, unknown>): boolean => capsOfKind(c.kind).band;
/** Przypis pasma: rodzaj rysuje pasmo, a pasmo ma obie krawędzie. */
const showsBandSource = (c: Record<string, unknown>): boolean =>
  capsOfKind(c.kind).band && hasChartBandEdges(c);

export const CHART_WIDGET_SCHEMA: ReadonlyArray<SchemaField> = [
  {
    key: "kind",
    type: "select",
    label: "Rodzaj wykresu",
    options: [
      { value: "bar", label: "kolumny" },
      { value: "bar-horizontal", label: "słupki poziome" },
      { value: "line", label: "linia" },
      { value: "area", label: "pole (area)" },
      { value: "pie", label: "kołowy" },
      { value: "donut", label: "pierścień (donut)" },
      // Mostek był w typie `ChartKind` i w edytorze bloku CMS, ale nie tutaj -
      // czyli autor widgetu buildera nie mógł go wybrać wcale. Bramka
      // `src/lib/charts/__tests__/chartKinds.test.ts` pilnuje, żeby ta lista
      // obejmowała każdy rodzaj z `CHART_KINDS`.
      { value: "waterfall", label: "wodospadowy (mostek)" },
      { value: "histogram", label: "histogram (rozkład)" },
      { value: "boxplot", label: "boxplot (rozkład)" },
      { value: "beeswarm", label: "rój punktów (rozkład)" },
      { value: "scatter", label: "punktowy (zależność)" },
      { value: "heatmap", label: "mapa ciepła (wrażliwość)" },
      { value: "tornado", label: "tornado (wrażliwość)" },
      { value: "fan", label: "wachlarz (scenariusze)" },
      { value: "index-base", label: "indeks, baza = 100 (różne skale)" },
      { value: "percent-stacked", label: "stos 100% (struktura)" },
      { value: "small-multiples", label: "małe panele (wiele podmiotów)" },
    ],
  },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
  {
    key: "data",
    type: "chartData",
    label: "Dane",
    rows: 6,
    hint: 'Arkusz otwiera się w popupie z podglądem wykresu. Format tekstowy: pierwszy wiersz "; Nazwa serii; Nazwa serii", kolejne "Kategoria; wartość; wartość" (separator ";", przecinek dziesiętny dozwolony). Zakres wklejony z Excela albo Arkuszy Google zamienia się na ten format.',
  },
  { key: "unit", type: "text", label: "Jednostka (np. %, mld EUR)" },
  {
    key: "stacked",
    type: "select",
    label: "Skumulowany (stacked)",
    options: [
      { value: "off", label: "nie" },
      { value: "on", label: "tak" },
    ],
    visibleWhen: (c) => c.kind === "bar" || c.kind === "bar-horizontal" || !c.kind,
  },
  { key: "height", type: "number", label: "Wysokość (px)", min: 160, max: 640, step: 10 },
  {
    key: "showLegend",
    type: "select",
    label: "Legenda",
    options: [
      { value: "on", label: "tak" },
      { value: "off", label: "nie" },
    ],
  },
  {
    key: "showGrid",
    type: "select",
    label: "Siatka",
    options: [
      { value: "on", label: "tak" },
      { value: "off", label: "nie" },
    ],
    // Wykres kołowy nie ma osi, więc nie ma czego kreskować - przełącznik
    // był tam cichym no-opem i tylko mylił autora.
    visibleWhen: (c) => c.kind !== "pie" && c.kind !== "donut",
  },
  {
    key: "showValues",
    type: "select",
    label: "Etykiety wartości",
    options: [
      { value: "off", label: "nie" },
      { value: "on", label: "tak" },
    ],
    hint: "Na wykresie kołowym wartość pojawia się pod udziałem procentowym, w wycinkach od 8% wzwyż.",
  },
  {
    key: "animate",
    type: "select",
    label: "Animacja wejścia",
    options: [
      { value: "on", label: "tak" },
      { value: "off", label: "nie" },
    ],
  },
  { key: "source", type: "i18nText", label: "Źródło danych" },
  { key: "caption", type: "i18nText", label: "Podpis pod wykresem" },
  // ---- System wykresów / odniesienia (specyfikacja 2026-10) ----
  // Pola PŁASKIE: panel buildera nie ma edytora list, więc pasmo optimum ma
  // tu jedno źródło (`bandSource*`), które renderer składa w przypis. Cel
  // i krawędzie pasma są NAPISAMI (`text`, nie `number`) - renderer czyta
  // je `getStr` i parsuje tym samym `num` co blok CMS, z przecinkiem
  // dziesiętnym; pole `number` zapisywałoby liczbę, której `getStr` nie widzi.
  {
    key: "palette",
    type: "select",
    label: "Paleta kolorów",
    group: CHART_REFERENCE_GROUP,
    options: CHART_PALETTE_OPTIONS,
    default: "focus",
    hint: "Akcent + neutralne: seria wyróżniona w akcencie, pozostałe jako tło porównania. Kategorialna: każda seria we własnym kolorze - dla serii równorzędnych.",
    // Mostek, mapa ciepła i tornado kodują kolorem znak albo wartość
    // (`KIND_CAPS.palette` = false) - wybór palety nie zmienia tam rysunku.
    visibleWhen: (c) => capsOfKind(c.kind).palette,
  },
  {
    key: "direction",
    type: "select",
    label: "Kierunek wskaźnika",
    group: CHART_REFERENCE_GROUP,
    options: CHART_DIRECTION_OPTIONS,
    hint: "Rozstrzyga, które wyjście poza pasmo optimum jest dobrą wiadomością - kolor statusu i zmiany w tooltipie.",
  },
  {
    key: "provenance",
    type: "select",
    label: "Pochodzenie liczb",
    group: CHART_REFERENCE_GROUP,
    options: CHART_PROVENANCE_OPTIONS,
    hint: "Litera przy podtytule mówi czytelnikowi, czy liczba jest pomiarem, wyliczeniem, benchmarkiem czy szacunkiem.",
  },
  {
    key: "target",
    type: "text",
    label: "Linia celu (wartość)",
    group: CHART_REFERENCE_GROUP,
    placeholder: "np. 25",
    hint: "Puste = bez linii celu. Wartość rysuje się przerywaną linią „cel X”.",
    visibleWhen: drawsTarget,
  },
  {
    key: "bandMin",
    type: "text",
    label: "Pasmo optimum - od",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: drawsBand,
  },
  {
    key: "bandMax",
    type: "text",
    label: "Pasmo optimum - do",
    group: CHART_REFERENCE_GROUP,
    hint: "Pasmo rysuje się tylko ze źródłem (tytuł albo adres niżej). Bez źródła wykres pokaże „brak benchmarku”.",
    visibleWhen: drawsBand,
  },
  {
    key: "bandSourceAuthor",
    type: "text",
    label: "Autor lub instytucja",
    group: CHART_REFERENCE_GROUP,
    placeholder: "np. Eurostat",
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourceTitle",
    type: "text",
    label: "Tytuł źródła",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourceContainer",
    type: "text",
    label: "Całość (czasopismo, serwis, seria)",
    group: CHART_REFERENCE_GROUP,
    hint: "Puste = dzieło samodzielne (raport, książka) - tytuł idzie kursywą.",
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourcePublisher",
    type: "text",
    label: "Wydawca",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourcePublished",
    type: "text",
    label: "Data publikacji",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourceAccessed",
    type: "text",
    label: "Data dostępu",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: showsBandSource,
  },
  {
    // `text`, nie `url`: pole `url` podpowiada STRONY SERWISU i bibliotekę
    // mediów, a źródło benchmarku to adres zewnętrzny.
    key: "bandSourceUrl",
    type: "text",
    label: "Adres źródła (URL)",
    group: CHART_REFERENCE_GROUP,
    placeholder: "https://",
    visibleWhen: showsBandSource,
  },
  {
    key: "bandSourceReliability",
    type: "select",
    label: "Wiarygodność źródła",
    group: CHART_REFERENCE_GROUP,
    options: CHART_RELIABILITY_OPTIONS,
    visibleWhen: showsBandSource,
  },
  // ---- System wykresów / kolory (PR2) ----
  // Klucze czyta adapter `widgetChartConfig` (`src/lib/charts/widgetConfig.ts`).
  // `seriesColors` jest napisem POZYCYJNYM numerów slotów ("3;4;8" - seria 1,
  // 2, 3), akcenty są INDEKSAMI liczonymi od zera, jak w bloku CMS.
  {
    key: "seriesColors",
    type: "chartSeriesColors",
    label: "Kolory serii",
    group: CHART_COLORS_GROUP,
    hint: "Próbka pokazuje kolor, którym seria jest narysowana. Kolor wybierasz z próbek palety.",
    visibleWhen: (c) => chartColorsBySeries(c.kind),
  },
  {
    key: "accentSeries",
    type: "chartAccent",
    label: "Seria wyróżniona",
    group: CHART_COLORS_GROUP,
    hint: "Seria w akcencie marki; pozostałe są tłem porównania. W palecie kategorialnej seria zachowuje swój kolor, a wyróżnia ją linia ciągła i znacznik koła. Domyślnie pierwsza seria.",
    // W OBU PALETACH. Ranga serii wyróżnionej steruje też kształtem (linia
    // ciągła, znacznik koła; przerywanie i kreskowanie dalszych serii), więc
    // pole ukryte pod paletą kategorialną zostawiało zapisany wybór, który
    // nadal zmieniał rysunek, bez kontrolki do jego cofnięcia. Rodzaj, który
    // palety nie stosuje (`KIND_CAPS.palette` = false), rangi nie rysuje -
    // tak samo małe panele (`colorTarget: "panels"`): każdy panel ma jedną
    // farbę, a serii wyróżnionej rysunek nie czyta.
    visibleWhen: (c) => capsOfKind(c.kind).colorTarget === "series" && capsOfKind(c.kind).palette,
  },
  {
    key: "accentCategory",
    type: "chartAccent",
    label: "Wycinek wyróżniony",
    group: CHART_COLORS_GROUP,
    hint: "Wycinek w akcencie marki (w palecie kategorialnej - z obrysem); nigdy nie trafia do „Pozostałe”. Domyślnie największy wycinek.",
    visibleWhen: (c) => chartColorsByCategory(c.kind),
  },
  // ---- System wykresów / uczciwość (PR2) ----
  // Te same pola co w bloku CMS (`CaptionMetaFields`) i te same etykiety.
  {
    key: "demo",
    type: "select",
    label: "Dane demonstracyjne (odznaka „demo”)",
    group: CHART_HONESTY_GROUP,
    options: [
      { value: "off", label: "nie" },
      { value: "on", label: "tak" },
    ],
  },
  {
    key: "sourceDate",
    type: "text",
    label: "Data danych",
    group: CHART_HONESTY_GROUP,
    placeholder: "np. 2026-06-30",
  },
  {
    key: "sampleSize",
    type: "number",
    label: "n - liczba obserwacji",
    group: CHART_HONESTY_GROUP,
    min: 1,
    step: 1,
  },
  { key: "notesShows", type: "i18nText", label: "Co pokazuje", group: CHART_HONESTY_GROUP },
  {
    key: "notesSurprising",
    type: "i18nText",
    label: "Co jest zaskakujące",
    group: CHART_HONESTY_GROUP,
  },
  {
    key: "notesHidden",
    type: "i18nText",
    label: "Czego NIE pokazuje",
    group: CHART_HONESTY_GROUP,
  },
  // ---- System wykresów / prognoza (PR2) ----
  {
    // NUMER kategorii liczony od jednej, jak w edytorze bloku; adapter
    // widgetu przelicza go na indeks silnika.
    key: "forecastFrom",
    type: "number",
    label: "Prognoza od kategorii numer",
    group: CHART_FORECAST_GROUP,
    // Od drugiej: prognoza od pierwszej kategorii nie ma historii, a parser
    // takiej granicy nie przyjmuje.
    min: 2,
    step: 1,
    hint: "Puste = cały szereg jest historią. Numer 2 znaczy: prognoza od drugiej kategorii.",
    visibleWhen: (c) => chartHasForecast(c.kind),
  },
  {
    key: "forecastBandPct",
    type: "number",
    label: "Pasmo niepewności ±%",
    group: CHART_FORECAST_GROUP,
    min: 0,
    max: 100,
    step: 1,
    visibleWhen: (c) => chartHasForecastBand(c.kind),
  },
];
