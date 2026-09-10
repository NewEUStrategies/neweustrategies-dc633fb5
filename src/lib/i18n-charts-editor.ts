// PORADY DLA AUTORA BLOKU - NAKŁADKA WYŁĄCZNIE DLA PANELU ADMINA.
//
// PO CO OSOBNY PLIK, a nie sekcja w `i18n-charts.ts`. Te napisy mówią do
// AUTORA, nie do czytelnika: "powyżej sześciu barw paleta przestaje być
// rozdzielna", "podpis bez zdania o tym, czego wykres NIE pokazuje, zamienia
// wykres analityczny w ilustrację". Czytelnik opublikowanego wpisu nie może
// nic z tą informacją zrobić - nie wybiera formy wykresu ani nie pisze
// podpisu - a mimo to płacił za nią transferem, bo słownik wykresów jest
// importowany przez ramę karty na każdej publicznej stronie z wykresem.
//
// Nakładki i18n są w tym repozytorium ADDYTYWNE (`addResourceBundle` z `deep`
// i `overwrite`), więc podział niczego nie psuje: klucze `charts.editor.*`
// istnieją dokładnie tam, gdzie ktoś je woła, i tylko tam. Jedynym
// konsumentem jest `DataVizBlocks.tsx`, czyli edytor bloku w panelu, a kod
// panelu jedzie osobnymi chunkami - bramka budżetu bundla liczy je do
// OVERALL, nie do publicznego. Pilnuje tego bramka
// `check:i18n-overlay-imports`: kto woła klucz z nakładki, ten musi tę
// nakładkę zaimportować.
//
// USUNIĘTY PRZY OKAZJI KLUCZ `smoothingWithoutPoints`. Ostrzegał przed
// wygładzoną linią bez widocznych punktów obserwacji, a `shouldShowDots`
// zwraca `smoothing > 0 || pointCount <= DOTS_MAX_POINTS` - czyli wygładzenie
// SAMO zapala punkty i ten stan jest w tym silniku nieosiągalny. Klucz był
// zdefiniowany w obu językach i nie wołał go nikt. Ostrzeżenie o defekcie,
// który nie może wystąpić, jest gorsze od jego braku: sugeruje czytającemu
// kod, że taki stan istnieje.
import i18n from "@/lib/i18n";

const pl = {
  charts: {
    editor: {
      // Ostrzeżenia dyscypliny - nie blokują zapisu, mówią, co się psuje.
      tooManySeries:
        "Powyżej {{max}} kolorów kategorialnych paleta przestaje być rozdzielna dla daltonizmu. Pogrupuj serie albo podziel wykres na small multiples.",
      tooManySlices:
        "Tarcza powyżej {{max}} kategorii koduje kątem i powierzchnią, czyli najsłabszymi kanałami. Nadmiar zwija się w jeden wycinek zbiorczy - rozważ słupki poziome.",
      // TRZY GRANICE PIERŚCIENIA. Wszystkie policzalne, więc nie ma sensu
      // liczyć na czujność autora - ale żadna nie blokuje zapisu, bo każda ma
      // wyjątki (np. dwa segmenty jako celowo minimalna ilustracja udziału).
      pieTooFewSlices:
        "Pierścień z dwoma albo trzema segmentami to koło z dziurą - miernik albo pojedynczy słupek 100% mówi to samo bez pytania czytelnika o kąt.",
      pieClosePercentages:
        "Udziały różnią się o mniej niż {{pp}} punkty procentowe, więc pierścień pokaże je jako identyczne. Do porównania weź słupki poziome - długość jest najwyżej w hierarchii percepcyjnej.",
      signClashesWithTerracotta:
        "Wykres koduje znak czerwienią, więc terakota (slot 6) nie może być na nim kategorią.",
      forecastWithoutBand:
        "Prognoza bez pasma niepewności sugeruje pewność, której nie ma. Podaj szerokość pasma.",
      missingNotes:
        "Podpis bez zdania „czego nie pokazuje” zmienia wykres analityczny w ilustrację.",
    },
  },
};

const en: typeof pl = {
  charts: {
    editor: {
      tooManySeries:
        "Above {{max}} categorical colours the palette stops being separable for colour-blind readers. Group the series or split the chart into small multiples.",
      tooManySlices:
        "A pie above {{max}} categories encodes with angle and area, the weakest channels. The overflow folds into one aggregate slice - consider sorted horizontal bars.",
      pieTooFewSlices:
        "A ring with two or three segments is a circle with a hole - a meter or a single 100% bar says the same without asking the reader to judge an angle.",
      pieClosePercentages:
        "The shares differ by less than {{pp}} percentage points, so the ring will render them as identical. Use horizontal bars for the comparison - length is highest in the perceptual hierarchy.",
      signClashesWithTerracotta:
        "This chart encodes sign with red, so terracotta (slot 6) cannot also be a category on it.",
      forecastWithoutBand:
        "A forecast without an uncertainty band implies a certainty that is not there. Set the band width.",
      missingNotes:
        "A caption without the “what it does not show” sentence turns an analytical chart into an illustration.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

/** Żywe wiązanie utrzymuje rejestrację razem z widokiem edytora. */
export function ensureChartsEditorI18n(): void {}
