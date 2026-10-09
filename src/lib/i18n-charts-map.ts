// KARTOGRAM DLA CZYTELNIKA - nakładka słownika mapy danych (`chartsMap.*`).
//
// PO CO OSOBNY PLIK, a nie gałąź w `i18n-charts.ts`. Słownik wykresów jedzie
// z ramą karty na każdej publicznej stronie z wykresem, a napisy mapy (legenda
// klas, „brak danych", pozycja i przedział w tooltipie, teksty „Jak czytać")
// potrzebuje wyłącznie strona z kartogramem. Właścicielem renderu mapy jest
// `ChoroplethMap.tsx` i to on importuje tę nakładkę.
//
// NAZWY SCHEMATÓW BARW I METOD PODZIAŁU są KANONICZNE: te same słowa stoją
// w nakładce edytora mapy (`mapEditor.*` w `i18n-map-editor.ts`), żeby autor
// wybierał dokładnie tę nazwę, którą czytelnik zobaczy w legendzie. Bramka
// `chartOverlayParity.test.ts` pilnuje zgodności obu kopii, parytetu PL/EN
// i braku pauzy w miejscu łącznika.
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>` (bramka
// `chartDictionaryKeys.test.ts` zakazuje kluczy sklejanych z wartości unii).
import i18n from "@/lib/i18n";

const pl = {
  chartsMap: {
    schemes: {
      blue: "niebieski",
      slate: "łupkowy",
      accent: "pomarańczowy (akcent)",
      diverging: "rozbieżny (spadek - wzrost)",
    },
    methods: {
      quantile: "kwantyle (równe liczebności)",
      equal: "równe przedziały",
      // `classes: 0` - skala bez klas, kolor liczony z wartości wprost.
      continuous: "skala ciągła",
    },
  },
};

const en: typeof pl = {
  chartsMap: {
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
export function ensureChartsMapI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureChartsMapI18n();
