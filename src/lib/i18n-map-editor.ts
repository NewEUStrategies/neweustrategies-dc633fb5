// EDYTOR MAPY DANYCH - nakładka słownika dla AUTORA (`mapEditor.*`).
//
// Napisy edytora kartogramu w panelu admina: blok CMS (`DataMapBlock.tsx`),
// pole danych mapy i wybór schematu barw w builderze (`MapDataField.tsx`,
// `MapSchemeField.tsx`). Czytelnik opublikowanej strony nie potrzebuje żadnego
// z nich, więc nakładka jedzie wyłącznie z chunkami panelu - napisy mapy
// widziane przez czytelnika są w `i18n-charts-map.ts` (`chartsMap.*`).
//
// NAZWY SCHEMATÓW BARW I METOD PODZIAŁU są KANONICZNE i muszą być TE SAME co
// w nakładce czytelnika (`chartsMap.schemes.*`, `chartsMap.methods.*`): autor
// wybiera nazwę, którą czytelnik zobaczy w legendzie. Pilnuje tego bramka
// `chartOverlayParity.test.ts` (razem z parytetem PL/EN i zakazem pauzy).
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>`.
import i18n from "@/lib/i18n";

const pl = {
  mapEditor: {
    schemes: {
      blue: "niebieski",
      slate: "łupkowy",
      accent: "pomarańczowy (akcent)",
      diverging: "rozbieżny (spadek - wzrost)",
    },
    methods: {
      quantile: "kwantyle (równe liczebności)",
      equal: "równe przedziały",
      continuous: "skala ciągła",
    },
  },
};

const en: typeof pl = {
  mapEditor: {
    schemes: {
      blue: "Blue",
      slate: "Slate",
      accent: "Orange (accent)",
      diverging: "Diverging (decrease - increase)",
    },
    methods: {
      quantile: "Quantiles (equal counts)",
      equal: "Equal intervals",
      continuous: "Continuous scale",
    },
  },
};

let registered = false;
/** Idempotentne: rejestracja odbywa się raz, przy imporcie modułu. */
export function ensureMapEditorI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureMapEditorI18n();
