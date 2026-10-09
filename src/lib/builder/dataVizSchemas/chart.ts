// Schemat widgetu buildera `chart` - pola panelu w kolejności wyświetlania.
//
// Do PR2 stał w `WIDGET_SCHEMAS` w `schemas.ts`; tam zostało jedno odwołanie
// (`chart: CHART_WIDGET_SCHEMA`), więc wpis jest TYM SAMYM obiektem co przed
// przeniesieniem. Nowe pola widgetu wykresu dopisuje się TUTAJ - etykiety
// angielskie w `labelsEn.ts` (sekcja „chart widget (PR2)"), a przypadki
// `visibleWhen` w bramce `schemaVisibleWhen.test.ts`.
import type { SchemaField } from "../schemas";
import {
  CHART_DIRECTION_OPTIONS,
  CHART_PALETTE_OPTIONS,
  CHART_PROVENANCE_OPTIONS,
  CHART_REFERENCE_GROUP,
  CHART_RELIABILITY_OPTIONS,
  hasChartBandEdges,
} from "./shared";

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
    hint: 'Arkusz otwiera się w popupie z podglądem wykresu. Format tekstowy: pierwszy wiersz "; Nazwa serii; Nazwa serii", kolejne "Kategoria; wartość; wartość" (separator ";", przecinek dziesiętny dozwolony).',
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
    hint: "Akcent + neutralne: pierwsza seria w akcencie, pozostałe jako tło porównania. Kategorialna: każda seria we własnym kolorze - dla serii równorzędnych.",
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
  },
  {
    key: "bandMin",
    type: "text",
    label: "Pasmo optimum - od",
    group: CHART_REFERENCE_GROUP,
  },
  {
    key: "bandMax",
    type: "text",
    label: "Pasmo optimum - do",
    group: CHART_REFERENCE_GROUP,
    hint: "Pasmo rysuje się tylko ze źródłem (tytuł albo adres niżej). Bez źródła wykres pokaże „brak benchmarku”.",
  },
  {
    key: "bandSourceAuthor",
    type: "text",
    label: "Autor lub instytucja",
    group: CHART_REFERENCE_GROUP,
    placeholder: "np. Eurostat",
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourceTitle",
    type: "text",
    label: "Tytuł źródła",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourceContainer",
    type: "text",
    label: "Całość (czasopismo, serwis, seria)",
    group: CHART_REFERENCE_GROUP,
    hint: "Puste = dzieło samodzielne (raport, książka) - tytuł idzie kursywą.",
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourcePublisher",
    type: "text",
    label: "Wydawca",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourcePublished",
    type: "text",
    label: "Data publikacji",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourceAccessed",
    type: "text",
    label: "Data dostępu",
    group: CHART_REFERENCE_GROUP,
    visibleWhen: hasChartBandEdges,
  },
  {
    // `text`, nie `url`: pole `url` podpowiada STRONY SERWISU i bibliotekę
    // mediów, a źródło benchmarku to adres zewnętrzny.
    key: "bandSourceUrl",
    type: "text",
    label: "Adres źródła (URL)",
    group: CHART_REFERENCE_GROUP,
    placeholder: "https://",
    visibleWhen: hasChartBandEdges,
  },
  {
    key: "bandSourceReliability",
    type: "select",
    label: "Wiarygodność źródła",
    group: CHART_REFERENCE_GROUP,
    options: CHART_RELIABILITY_OPTIONS,
    visibleWhen: hasChartBandEdges,
  },
];
