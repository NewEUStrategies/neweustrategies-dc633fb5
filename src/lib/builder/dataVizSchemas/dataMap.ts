// Schemat widgetu buildera `data-map` (kartogram) - pola panelu w kolejności
// wyświetlania.
//
// Do PR2 stał w `WIDGET_SCHEMAS` w `schemas.ts`; tam zostało jedno odwołanie
// (`"data-map": DATA_MAP_WIDGET_SCHEMA`), więc wpis jest TYM SAMYM obiektem co
// przed przeniesieniem. Nowe pola mapy danych dopisuje się TUTAJ - etykiety
// angielskie w `labelsEn.ts` (sekcja „data-map widget (PR2)"), a przypadki
// `visibleWhen` w bramce `schemaVisibleWhen.test.ts`.
import type { SchemaField } from "../schemas";
import { MAP_REGION_OPTIONS } from "./shared";

export const DATA_MAP_WIDGET_SCHEMA: ReadonlyArray<SchemaField> = [
  { key: "region", type: "select", label: "Region", options: MAP_REGION_OPTIONS },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
  {
    key: "data",
    type: "mapData",
    label: "Dane per kraj",
    rows: 6,
    hint: 'Jeden kraj na wiersz: "KOD; wartość" (kod ISO-2, np. PL; 12,5).',
  },
  { key: "unit", type: "text", label: "Jednostka (np. %, mln)" },
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
    key: "animate",
    type: "select",
    label: "Animacja wejścia",
    options: [
      { value: "on", label: "tak" },
      { value: "off", label: "nie" },
    ],
  },
  { key: "source", type: "i18nText", label: "Źródło danych" },
];
