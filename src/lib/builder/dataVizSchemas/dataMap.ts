// Schemat widgetu buildera `data-map` (kartogram) - pola panelu w kolejności
// wyświetlania.
//
// Do PR2 stał w `WIDGET_SCHEMAS` w `schemas.ts`; tam zostało jedno odwołanie
// (`"data-map": DATA_MAP_WIDGET_SCHEMA`), więc wpis jest TYM SAMYM obiektem co
// przed przeniesieniem. Nowe pola mapy danych dopisuje się TUTAJ - etykiety
// angielskie w `labelsEn.ts` (sekcja „data-map widget (PR2)"), a przypadki
// `visibleWhen` w bramce `schemaVisibleWhen.test.ts`.
import type { SchemaField } from "../schemas";
import {
  CHART_HONESTY_GROUP,
  CHART_PROVENANCE_OPTIONS,
  MAP_CLASS_OPTIONS,
  MAP_METHOD_OPTIONS,
  MAP_REGION_OPTIONS,
  MAP_SCHEME_OPTIONS,
  mapHasClasses,
} from "./shared";

const MAP_SCALE_GROUP = "Mapa / skala barw";

export const DATA_MAP_WIDGET_SCHEMA: ReadonlyArray<SchemaField> = [
  { key: "region", type: "select", label: "Region", options: MAP_REGION_OPTIONS },
  { key: "title", type: "i18nText", label: "Tytuł" },
  { key: "description", type: "i18nText", label: "Opis (podtytuł)" },
  {
    key: "data",
    type: "mapData",
    label: "Dane per kraj",
    rows: 6,
    // Pole danych (`MapDataField`): textarea, wklejenie arkusza, import
    // z podglądem i arkusz mapy z nazwami krajów i podglądem.
    hint: 'Jeden kraj na wiersz: "KOD; wartość" (kod ISO-2, np. PL; 12,5). Zakres wklejony z Excela albo Arkuszy Google zamienia się na ten format, a „Edytuj w arkuszu" pokazuje nazwy krajów i uwagi do wierszy.',
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
  { key: "caption", type: "i18nText", label: "Podpis pod mapą" },
  // ---- Mapa / skala barw (PR2) ----
  // Klucze czyta adapter `widgetMapConfig` (`src/lib/charts/widgetConfig.ts`).
  // Brak zapisu każdego z nich daje mapę sprzed PR2: niebieską, ciągłą.
  {
    key: "scheme",
    type: "mapScheme",
    label: "Schemat barw",
    group: MAP_SCALE_GROUP,
    options: MAP_SCHEME_OPTIONS,
    hint: "Rozbieżny - dla wskaźnika z punktem odniesienia (spadek - wzrost wokół środka skali).",
  },
  {
    key: "classes",
    type: "select",
    label: "Liczba klas",
    group: MAP_SCALE_GROUP,
    options: MAP_CLASS_OPTIONS,
    hint: "Klasy łatwiej porównać z legendą; skala ciągła pokazuje każdą różnicę.",
  },
  {
    key: "method",
    type: "select",
    label: "Metoda podziału",
    group: MAP_SCALE_GROUP,
    options: MAP_METHOD_OPTIONS,
    hint: "Kwantyle: podobna liczba krajów w każdej klasie. Równe przedziały: klasy jak podziałka, ale kraj odstający zostawia klasy puste.",
    visibleWhen: (c) => mapHasClasses(c.classes),
  },
  {
    // Napis, nie `number`: przecinek dziesiętny, jak cel i pasmo wykresu.
    key: "midpoint",
    type: "text",
    label: "Środek skali",
    group: MAP_SCALE_GROUP,
    placeholder: "np. 0",
    hint: "Wartość w neutralnym środku skali rozbieżnej (np. średnia UE). Puste = 0.",
    visibleWhen: (c) => c.scheme === "diverging",
  },
  // ---- Uczciwość (PR2) - te same pola co przy wykresie ----
  {
    key: "provenance",
    type: "select",
    label: "Pochodzenie liczb",
    group: CHART_HONESTY_GROUP,
    options: CHART_PROVENANCE_OPTIONS,
    hint: "Litera przy podtytule mówi czytelnikowi, czy liczba jest pomiarem, wyliczeniem, benchmarkiem czy szacunkiem.",
  },
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
];
