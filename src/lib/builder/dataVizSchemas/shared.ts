// Stałe opcji wspólne dla schematów widgetów wizualizacji danych (`chart`,
// `data-map`) i mapy korytarzy (`feature-corridor-map`, pole `region`).
//
// Do PR2 żyły na górze `schemas.ts`. Schematy wykresu i mapy danych mają
// własne pliki obok (`chart.ts`, `dataMap.ts`), więc opcje, z których oba
// korzystają, są tutaj - JEDNA kopia, importowana przez `schemas.ts` i oba
// schematy. Moduł nie importuje `schemas.ts` w czasie wykonania (tylko typy),
// więc nie ma cyklu inicjalizacji.
import { MAP_REGIONS, type MapRegion } from "@/lib/charts/types";
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
