// KARTOGRAM DLA CZYTELNIKA - nakładka słownika mapy danych (`chartsMap.*`).
//
// PO CO OSOBNY PLIK, a nie gałąź w `i18n-charts.ts`. Słownik wykresów jedzie
// z ramą karty na każdej publicznej stronie z wykresem, a napisy mapy (legenda
// klas, „brak danych", pozycja i przedział w tooltipie, teksty „Jak czytać")
// potrzebuje wyłącznie strona z kartogramem. Właścicielem renderu mapy jest
// `ChoroplethMap.tsx` i to on (razem z legendą `MapLegend.tsx`) importuje tę
// nakładkę.
//
// NAZWY SCHEMATÓW BARW I METOD PODZIAŁU są KANONICZNE: te same słowa stoją
// w nakładce edytora mapy (`mapEditor.*` w `i18n-map-editor.ts`), żeby autor
// wybierał dokładnie tę nazwę, którą czytelnik zobaczy w legendzie. Bramka
// `chartOverlayParity.test.ts` pilnuje zgodności obu kopii, parytetu PL/EN
// i braku pauzy w miejscu łącznika.
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>` (bramka
// `chartDictionaryKeys.test.ts` zakazuje kluczy sklejanych z wartości unii).
//
// LICZBA KLAS IDZIE WSTAWKĄ `{{n}}`, NIE `{{count}}`. `count` uruchamia
// w i18next formy mnogie, a te mają w polskim inne liście (`_few`, `_many`)
// niż w angielskim - bramka parytetu wymaga tych samych liści w obu
// językach. Zdanie jest więc ułożone tak, żeby liczba nie odmieniała
// rzeczownika („Liczba klas: 5").
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
    table: {
      country: "Kraj",
      value: "Wartość",
    },
    empty: "Brak danych mapy.",
    loadError: "Nie udało się wczytać mapy.",
    // Kraj BEZ wartości - tooltip i legenda (próbka kreskowana).
    noData: "brak danych",
    // Ta sama pozycja w kluczu PNG: płótno eksportu maluje próbkę jednym
    // kolorem, więc kreskowanie mówi słowami.
    noDataHatched: "brak danych (kreskowanie)",
    // Przedział klasy w legendzie i w tooltipie. Słowami, nie łącznikiem:
    // „-5 - 3%" przy wartościach ujemnych czyta się jak odejmowanie.
    range: "od {{from}} do {{to}}",
    tip: {
      value: "Wartość",
      rank: "Pozycja",
      rankValue: "{{rank}}. z {{total}}",
      range: "Przedział",
    },
    legend: {
      label: "Legenda mapy",
      method: "Podział: {{method}}",
      midpoint: "Punkt środkowy: {{value}}",
    },
    notes: {
      outside: "Poza mapą tego regionu (tylko w tabeli): {{ids}}",
    },
    // Okno „Jak czytać" ramy (`meta.help`) - zdania mapy zamiast zdań
    // o osiach i seriach, których kartogram nie ma.
    read: {
      elements:
        "Każdy kraj ma kolor według swojej wartości. Kraje kreskowane nie mają danych. Pełne liczby, także dla regionów spoza mapy, są w tabeli danych pod mapą.",
      coloursSequential:
        "Schemat: {{scheme}}. Im wyraźniej kolor odcina się od tła, tym wyższa wartość.",
      coloursDiverging:
        "Schemat: {{scheme}}. Kolor neutralny oznacza punkt środkowy ({{midpoint}}) i wartości blisko niego; jeden odcień oznacza wartości poniżej, drugi - powyżej. Im mocniejszy kolor, tym dalej od środka.",
      scaleClassed:
        "Liczba klas: {{n}}, podział: {{method}}. Kraje w jednej klasie mają ten sam kolor, a granice klas podaje legenda.",
      // `{{method}}` to kanoniczna nazwa `methods.continuous` - jedno źródło.
      scaleContinuous:
        "Podział: {{method}}. Kolor zmienia się płynnie wraz z wartością, a legenda podaje wartość najniższą i najwyższą.",
      // Dwa zdania, bo dymek skali ciągłej nie ma przedziału klasy - pomoc
      // nie obiecuje faktu, którego czytelnik nie zobaczy.
      interactionsClassed:
        "Najedź na kraj albo przejdź do niego klawiszem Tab, aby zobaczyć wartość, pozycję i przedział klasy. Na ekranie dotykowym stuknij kraj; stuknięcie obok albo klawisz Escape zamyka dymek.",
      interactionsContinuous:
        "Najedź na kraj albo przejdź do niego klawiszem Tab, aby zobaczyć wartość i pozycję. Na ekranie dotykowym stuknij kraj; stuknięcie obok albo klawisz Escape zamyka dymek.",
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
    table: {
      country: "Country",
      value: "Value",
    },
    empty: "No map data.",
    loadError: "Map failed to load.",
    noData: "no data",
    noDataHatched: "no data (hatched)",
    range: "{{from}} to {{to}}",
    tip: {
      value: "Value",
      rank: "Rank",
      rankValue: "{{rank}} of {{total}}",
      range: "Class range",
    },
    legend: {
      label: "Map legend",
      method: "Classes: {{method}}",
      midpoint: "Midpoint: {{value}}",
    },
    notes: {
      outside: "Outside this region's map (table only): {{ids}}",
    },
    read: {
      elements:
        "Each country is coloured by its value. Hatched countries have no data. The full figures, including regions outside the map, are in the data table below the map.",
      coloursSequential:
        "Scheme: {{scheme}}. The more a colour stands out from the background, the higher the value.",
      coloursDiverging:
        "Scheme: {{scheme}}. The neutral colour marks the midpoint ({{midpoint}}) and values close to it; one hue marks values below it, the other values above it. The stronger the colour, the further from the midpoint.",
      scaleClassed:
        "Number of classes: {{n}}, method: {{method}}. Countries in one class share one colour, and the legend gives the class boundaries.",
      scaleContinuous:
        "Method: {{method}}. The colour changes smoothly with the value, and the legend gives the lowest and the highest value.",
      interactionsClassed:
        "Hover over a country or reach it with the Tab key to see its value, rank and class range. On a touch screen, tap a country; tapping elsewhere or pressing Escape closes the tooltip.",
      interactionsContinuous:
        "Hover over a country or reach it with the Tab key to see its value and rank. On a touch screen, tap a country; tapping elsewhere or pressing Escape closes the tooltip.",
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
