// Stałe opcji wspólne dla schematów widgetów wizualizacji danych (`chart`,
// `data-map`) i mapy korytarzy (`feature-corridor-map`, pole `region`).
//
// Do PR2 żyły na górze `schemas.ts`. Schematy wykresu i mapy danych mają
// własne pliki obok (`chart.ts`, `dataMap.ts`), więc opcje, z których oba
// korzystają, są tutaj - JEDNA kopia, importowana przez `schemas.ts` i oba
// schematy. Moduł nie importuje `schemas.ts` w czasie wykonania (tylko typy),
// więc nie ma cyklu inicjalizacji.
import {
  MAP_CLASSES_MAX,
  MAP_CLASSES_MIN,
  MAP_METHODS,
  MAP_REGIONS,
  MAP_SCHEMES,
  isChartKind,
  type ChartKind,
  type MapMethod,
  type MapRegion,
  type MapScheme,
} from "@/lib/charts/types";
import { KIND_CAPS, type KindCaps } from "@/lib/charts/kindCaps";
import { CHART_PALETTES, type ChartPalette } from "@/lib/charts/seriesStyle";
import { METRIC_DIRECTIONS, type MetricDirection } from "@/lib/charts/status";
import {
  PROVENANCES,
  RELIABILITIES,
  type Provenance,
  type Reliability,
} from "@/lib/charts/sources";

/** Opcja pola `select` schematu - etykieta jest napisem ŹRÓDŁOWYM (PL). */
export type SchemaOption = { value: string; label: string };

/**
 * Regiony map (`data-map`, `feature-corridor-map`) - opcje WYPROWADZONE
 * z `MAP_REGIONS`, nie wpisane ręcznie.
 *
 * Schemat sam w sobie wymaga literałów: to zwykłe dane, a `options` nie ma
 * jak wiedzieć, że akurat te napisy są regionami. Ale literałem musi być tylko
 * ETYKIETA, i to wystarczy, żeby TypeScript przypilnował całości: tablica jest
 * typowana `Record<MapRegion, string>`, więc region dopisany do źródła bez
 * polskiej etykiety NIE SKOMPILUJE SIĘ, a etykieta dla regionu, którego nie ma
 * w źródle, jest niewyrażalna. Bramka
 * `src/lib/charts/__tests__/mapRegions.test.ts` sprawdza to samo od strony
 * PANELU (czy opcja rzeczywiście dojeżdża do pola `region` obu widgetów) -
 * kompilator pilnuje tablicy, bramka pilnuje tego, że ktoś jej użył.
 *
 * Etykiety są po polsku, bo schemat trzyma napisy ŹRÓDŁOWE; na angielskie
 * mapuje je `BUILDER_LABELS_EN` (i pilnuje tego bramka `labelsEn.test.ts`).
 */
const MAP_REGION_LABEL_PL: Record<MapRegion, string> = {
  europe: "Europa",
  world: "Świat",
  africa: "Afryka",
  asia: "Azja",
  "north-america": "Ameryka Północna",
  "south-america": "Ameryka Południowa",
  oceania: "Oceania",
};

export const MAP_REGION_OPTIONS: ReadonlyArray<SchemaOption> = MAP_REGIONS.map((value) => ({
  value,
  label: MAP_REGION_LABEL_PL[value],
}));

/**
 * System wykresów (specyfikacja 2026-10) - opcje palety, kierunku wskaźnika,
 * pochodzenia liczb i wiarygodności źródła WYPROWADZONE z `src/lib/charts`,
 * dokładnie jak regiony map wyżej: etykieta jest literałem, ale tablica
 * typowana `Record<Unia, string>` nie skompiluje się, gdy do źródła dojdzie
 * wartość bez etykiety. Słownictwo jest to samo, co w tooltipie i przypisie
 * wykresu (`charts.direction.*`, `charts.provenance.*`,
 * `charts.reliability.*`), żeby autor wybierał zdanie, które przeczyta
 * czytelnik. Na angielski mapuje je `BUILDER_LABELS_EN`.
 */
const CHART_PALETTE_LABEL_PL: Record<ChartPalette, string> = {
  focus: "akcent + neutralne (domyślna)",
  categorical: "kategorialna (kolor serii z palety)",
};

const CHART_DIRECTION_LABEL_PL: Record<MetricDirection, string> = {
  higher: "wyżej znaczy lepiej",
  lower: "niżej znaczy lepiej",
  range: "najlepiej w przedziale",
};

const CHART_PROVENANCE_LABEL_PL: Record<Provenance, string> = {
  D: "D - Twoje dane",
  W: "W - wyliczenie",
  B: "B - benchmark ze źródła",
  E: "E - szacunek lub heurystyka",
  "?": "? - brak danych",
};

const CHART_RELIABILITY_LABEL_PL: Record<Reliability, string> = {
  A: "A - źródło pierwotne",
  B: "B - źródło wtórne, rzetelne",
  C: "C - omówienie",
};

export const CHART_PALETTE_OPTIONS: ReadonlyArray<SchemaOption> = CHART_PALETTES.map((value) => ({
  value,
  label: CHART_PALETTE_LABEL_PL[value],
}));

// Pusta wartość na czele = „brak deklaracji": renderer (`chartReferenceFields`)
// odrzuca wszystko spoza dziedziny, więc wykres nie dostaje kierunku,
// litery pochodzenia ani oceny wiarygodności, której autor nie wybrał.
export const CHART_DIRECTION_OPTIONS: ReadonlyArray<SchemaOption> = [
  { value: "", label: "brak" },
  ...METRIC_DIRECTIONS.map((value) => ({ value, label: CHART_DIRECTION_LABEL_PL[value] })),
];

export const CHART_PROVENANCE_OPTIONS: ReadonlyArray<SchemaOption> = [
  { value: "", label: "brak" },
  ...PROVENANCES.map((value) => ({ value, label: CHART_PROVENANCE_LABEL_PL[value] })),
];

export const CHART_RELIABILITY_OPTIONS: ReadonlyArray<SchemaOption> = [
  { value: "", label: "nie oceniono" },
  ...RELIABILITIES.map((value) => ({ value, label: CHART_RELIABILITY_LABEL_PL[value] })),
];

export const CHART_REFERENCE_GROUP = "System wykresów / odniesienia";

/**
 * Pola przypisu pasma optimum mają sens dopiero przy OBU krawędziach pasma:
 * renderer (`parseChartBand`) bez jednej z nich pasma nie tworzy, więc przypis
 * nad nieistniejącym pasmem byłby obietnicą bez pokrycia. Krawędzie są
 * NAPISAMI (renderer czyta je `getStr`), stąd sprawdzenie typu.
 */
export const hasChartBandEdges = (c: Record<string, unknown>): boolean =>
  typeof c.bandMin === "string" &&
  c.bandMin.trim() !== "" &&
  typeof c.bandMax === "string" &&
  c.bandMax.trim() !== "";

// ---- Kolory, uczciwość i prognoza wykresu (PR2) ----

export const CHART_COLORS_GROUP = "System wykresów / kolory";
export const CHART_HONESTY_GROUP = "System wykresów / uczciwość";
export const CHART_FORECAST_GROUP = "System wykresów / prognoza";

/**
 * Zdolności rodzaju zapisanego w treści. Brak albo nieznany zapis to rodzaj
 * domyślny („bar"), dokładnie jak w parserze (`parseChartKind`), więc pole
 * widoczne warunkowo pokazuje się tak, jak rysuje renderer.
 *
 * Predykaty `visibleWhen` wołają to jako `capsOfKind(c.kind)`, a nie
 * `capsOfKind(c)`: generator próbek bramki zgodności ustawień rozpoznaje
 * klucz, od którego zależy widoczność, po ŹRÓDLE predykatu.
 */
export function capsOfKind(kind: unknown): KindCaps {
  const k: ChartKind = isChartKind(kind) ? kind : "bar";
  return KIND_CAPS[k];
}

/** Kolor ma seria (albo panel) - wybór kolorów serii ma sens. */
export const chartColorsBySeries = (kind: unknown): boolean => {
  const target = capsOfKind(kind).colorTarget;
  return target === "series" || target === "panels";
};

/** Kolor ma kategoria (wycinki tarczy) - wybiera się wycinek w akcencie. */
export const chartColorsByCategory = (kind: unknown): boolean =>
  capsOfKind(kind).colorTarget === "category";

/**
 * Prognoza: granicę historii rysuje rysownik kartezjański i wachlarz; pasmo
 * niepewności tylko linia, pole i wachlarz (`CartesianChart`: `bandPct` przy
 * `isLine`, `fanChart.ts`: droga z `forecastBandPct`).
 *
 * Indeks bazy 100 jest w rodzinie kartezjańskiej, ale `forecastFrom` nie
 * czyta ani jego rysunek, ani tabela (`indexBase.ts`: okres bazowy jest
 * jawnym wyborem autora, nie granicą prognozy) - pole byłoby tam kontrolką
 * bez skutku. Bramka `chartSchemaKindCaps.test.tsx` trzyma zbiór rodzajów
 * i dowodzi renderem, że indeks granicy nie rysuje.
 */
export const chartHasForecast = (kind: unknown): boolean =>
  capsOfKind(kind).family === "cartesian" && kind !== "index-base";

export const chartHasForecastBand = (kind: unknown): boolean =>
  kind === "line" || kind === "area" || kind === "fan";

/**
 * Schematy barw i metody podziału kartogramu. Nazwy są KANONICZNE - te same
 * co w nakładkach `mapEditor.*` (autor) i `chartsMap.*` (czytelnik), żeby
 * autor wybierał nazwę, którą czytelnik zobaczy w legendzie. Tablice typowane
 * `Record<Unia, string>` nie skompilują się, gdy w `types.ts` przybędzie
 * schemat albo metoda bez etykiety.
 */
const MAP_SCHEME_LABEL_PL: Record<MapScheme, string> = {
  blue: "niebieski",
  slate: "łupkowy",
  accent: "pomarańczowy (akcent)",
  diverging: "rozbieżny (spadek - wzrost)",
};

const MAP_METHOD_LABEL_PL: Record<MapMethod, string> = {
  quantile: "kwantyle (równe liczebności)",
  equal: "równe przedziały",
};

export const MAP_SCHEME_OPTIONS: ReadonlyArray<SchemaOption> = MAP_SCHEMES.map((value) => ({
  value,
  label: MAP_SCHEME_LABEL_PL[value],
}));

export const MAP_METHOD_OPTIONS: ReadonlyArray<SchemaOption> = MAP_METHODS.map((value) => ({
  value,
  label: MAP_METHOD_LABEL_PL[value],
}));

/** Polska odmiana „klasa" po liczebniku 3..7 (3-4 „klasy", 5-7 „klas"). */
function classesLabelPl(n: number): string {
  return `${n} ${n >= 2 && n <= 4 ? "klasy" : "klas"}`;
}

/**
 * Liczba klas: zero (skala ciągła) NA CZELE, bo tak parser czyta brak klucza
 * - opublikowana mapa bez zapisu widzi w panelu dokładnie to, co rysuje.
 * Zapis jest NAPISEM ("0", "3".."7"); adapter widgetu parsuje go `num`.
 */
export const MAP_CLASS_OPTIONS: ReadonlyArray<SchemaOption> = [
  { value: "0", label: "skala ciągła" },
  ...Array.from({ length: MAP_CLASSES_MAX - MAP_CLASSES_MIN + 1 }, (_, i) => {
    const n = MAP_CLASSES_MIN + i;
    return { value: String(n), label: classesLabelPl(n) };
  }),
];

/** Metoda podziału ma sens tylko przy klasach - skala ciągła jej nie używa. */
export const mapHasClasses = (classes: unknown): boolean => {
  const n = typeof classes === "number" ? classes : Number(classes);
  return (
    (typeof classes === "number" || (typeof classes === "string" && classes.trim() !== "")) &&
    Number.isFinite(n) &&
    Math.round(n) > 0
  );
};
