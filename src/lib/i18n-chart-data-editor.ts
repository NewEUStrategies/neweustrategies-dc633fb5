// EDYTOR DANYCH WYKRESU - nakładka słownika dla AUTORA (`chartEditor.*`).
//
// Napisy arkusza danych, podglądu wklejki, wyboru koloru serii i serii
// wyróżnionej - wspólne dla edytora bloku CMS (`DataVizBlocks.tsx`) i arkusza
// widgetu buildera (`ChartDataSpreadsheetDialog.tsx`). Czytelnik opublikowanej
// strony nie potrzebuje żadnego z nich, więc nakładka jedzie wyłącznie
// z chunkami panelu.
//
// NIE MYLIĆ z `i18n-charts-editor.ts` (`charts.editor.*`, `<rodzaj>.advice.*`):
// tamta nakładka niesie PORADY doboru formy i dyscypliny palety, ta - napisy
// samych kontrolek edycji danych.
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>` (bramka
// `chartDictionaryKeys.test.ts`). Parytet PL/EN i zakaz pauzy w miejscu
// łącznika pilnuje `chartOverlayParity.test.ts`.
import i18n from "@/lib/i18n";

const pl = {
  chartEditor: {
    accent: {
      // Wybór serii malowanej akcentem palety ról (`accentSeries`).
      label: "Seria wyróżniona",
      // Tarcza i pierścień: kolor ma kategoria, więc wyróżnia się wycinek.
      categoryLabel: "Wycinek wyróżniony",
      categoryAuto: "Największy wycinek (domyślnie)",
      // Paleta kategorialna: seria wyróżniona zachowuje swój kolor, ale ranga
      // nadal decyduje o kształcie (linia ciągła, znacznik koła).
      categoricalHint:
        "W palecie kategorialnej seria wyróżniona zachowuje swój kolor - wyróżnia ją rysunek: linia ciągła i znacznik koła, bez kreskowania.",
    },
    colors: {
      // Paleta ról nie czyta koloru wybranego przy serii - mówi to autorowi
      // zdanie pod wyborem, zamiast kazać mu szukać zmiany w podglądzie.
      customHint: "Kolory własne działają w palecie kategorialnej",
      // Rangi 3 i 4 palety ról to kolory sygnałowe (turkus, fiolet), nie
      // neutralne - zdanie mówi o roli, a nie o odcieniu.
      focusRoles:
        "Kolory daje paleta ról: seria wyróżniona w akcencie, pozostałe jako tło porównania.",
      pickerLabel: "Kolor serii {{name}}",
      pickerTitle: "Kolor serii",
      recommended: "Rozdzielne dla daltonizmu",
      other: "Pozostałe kolory",
      legacySlot: "Kolor nr {{n}} spoza palety wyboru",
      roleTitle: "Kolor z palety ról - zmienia go wybór serii wyróżnionej",
      empty: "Najpierw dodaj serie w arkuszu danych.",
      // Rangi palety ról: 0 = seria wyróżniona, 1..4 = tło porównania.
      roles: {
        accent: "Akcent",
        context1: "Tło 1",
        context2: "Tło 2",
        context3: "Tło 3",
        context4: "Tło 4",
      },
      // Nazwy odcieni, które próbnik oferuje (`PICKER_SLOTS`). Klucz to
      // nazwa slotu z `palette.ts`, nie numer - numer nic autorowi nie mówi.
      slots: {
        granat: "granat",
        szalwia: "szałwia",
        sliwka: "śliwka",
        indygo: "indygo",
        oliwka: "oliwka",
        morski: "morski",
        grafit: "grafit",
        czerwien: "czerwień",
        atrament: "atrament",
        ametyst: "ametyst",
        bordo: "bordo",
        mech: "mech",
        fuksja: "fuksja",
        malina: "malina",
      },
    },
    grid: {
      label: "Arkusz danych wykresu",
      corner: "Kategoria",
      seriesN: "Seria {{n}}",
      categoryN: "Kategoria {{n}}",
      seriesName: "Nazwa serii {{n}}",
      categoryName: "Etykieta kategorii {{n}}",
      cell: "{{category}} - {{series}}",
      addSeries: "Dodaj serię",
      addCategory: "Dodaj kategorię",
      transpose: "Zamień wiersze z kolumnami",
      transposeBlocked: "Po zamianie dane przekroczyłyby limit serii albo kategorii.",
      limitSeries: "Osiągnięto limit serii: {{max}}.",
      limitCategories: "Osiągnięto limit kategorii: {{max}}.",
      invalidNumber: "To nie jest liczba - popraw wpis albo wyczyść komórkę.",
      pasteHint:
        "Zakres z Excela, Arkuszy Google albo LibreOffice wklejasz w dowolną komórkę - trafia od niej w prawo i w dół. Cała tabela wklejona w pierwszą komórkę otwiera podgląd. Ctrl+Z cofa zmianę.",
      pasted: "Wklejono dane z arkusza.",
      menuSeries: "Działania na serii {{name}}",
      menuCategory: "Działania na kategorii {{name}}",
    },
    menu: {
      insertAbove: "Wstaw kategorię powyżej",
      insertBelow: "Wstaw kategorię poniżej",
      moveUp: "Przesuń w górę",
      moveDown: "Przesuń w dół",
      removeCategory: "Usuń kategorię",
      accentCategory: "Wyróżnij ten wycinek",
      insertBefore: "Wstaw serię przed",
      insertAfter: "Wstaw serię za",
      moveLeft: "Przesuń w lewo",
      moveRight: "Przesuń w prawo",
      sortAsc: "Sortuj kategorie rosnąco według tej serii",
      sortDesc: "Sortuj kategorie malejąco według tej serii",
      accentSeries: "Wyróżnij tę serię",
      color: "Zmień kolor serii",
      removeSeries: "Usuń serię",
    },
    preview: {
      titlePaste: "Wklejanie tabeli",
      titleFile: "Import tabeli z pliku",
      descriptionChart:
        "Sprawdź układ tabeli. Zastosowanie zastąpi dane wykresu, a Ctrl+Z cofnie zmianę.",
      descriptionMap:
        "Sprawdź układ tabeli. Zastosowanie zastąpi dane mapy, a Ctrl+Z cofnie zmianę.",
      header: "Pierwszy wiersz to nagłówek",
      transpose: "Serie w wierszach (zamień wiersze z kolumnami)",
      locale: "Format liczb",
      locales: {
        auto: "Rozpoznaj automatycznie",
        pl: "Polski (1 234,5)",
        en: "Angielski (1,234.5)",
      },
      valueColumn: "Kolumna wartości",
      summaryChart: "Kategorie: {{categories}}, serie: {{series}}",
      summaryMap: "Kraje: {{count}}",
      shown: "Podgląd pierwszych {{shown}} z {{total}} wierszy.",
      empty: "W tym układzie tabela nie daje żadnych danych.",
      country: "Kraj",
      value: "Wartość",
      apply: "Zastosuj",
      cancel: "Anuluj",
    },
  },
};

const en: typeof pl = {
  chartEditor: {
    accent: {
      label: "Highlighted series",
      categoryLabel: "Highlighted slice",
      categoryAuto: "Largest slice (default)",
      categoricalHint:
        "In the categorical palette the highlighted series keeps its colour - its drawing sets it apart: a solid line and a circle marker, no hatching.",
    },
    colors: {
      customHint: "Custom colours apply in the categorical palette",
      focusRoles:
        "Colours come from the role palette: the highlighted series in the accent, the others as the comparison background.",
      pickerLabel: "Colour of series {{name}}",
      pickerTitle: "Series colour",
      recommended: "Colour-blind separable",
      other: "Other colours",
      legacySlot: "Colour no. {{n}} outside the picker palette",
      roleTitle: "Colour from the role palette - set by choosing the highlighted series",
      empty: "Add series in the data sheet first.",
      roles: {
        accent: "Accent",
        context1: "Context 1",
        context2: "Context 2",
        context3: "Context 3",
        context4: "Context 4",
      },
      slots: {
        granat: "navy",
        szalwia: "sage",
        sliwka: "plum",
        indygo: "indigo",
        oliwka: "olive",
        morski: "sea green",
        grafit: "graphite",
        czerwien: "red",
        atrament: "ink",
        ametyst: "amethyst",
        bordo: "burgundy",
        mech: "moss",
        fuksja: "fuchsia",
        malina: "raspberry",
      },
    },
    grid: {
      label: "Chart data sheet",
      corner: "Category",
      seriesN: "Series {{n}}",
      categoryN: "Category {{n}}",
      seriesName: "Name of series {{n}}",
      categoryName: "Label of category {{n}}",
      cell: "{{category}} - {{series}}",
      addSeries: "Add series",
      addCategory: "Add category",
      transpose: "Swap rows and columns",
      transposeBlocked: "After swapping, the data would exceed the series or category limit.",
      limitSeries: "Series limit reached: {{max}}.",
      limitCategories: "Category limit reached: {{max}}.",
      invalidNumber: "This is not a number - correct the entry or clear the cell.",
      pasteHint:
        "Paste a range from Excel, Google Sheets or LibreOffice into any cell - it fills from that cell to the right and down. A whole table pasted into the first cell opens a preview. Ctrl+Z undoes the change.",
      pasted: "Data pasted from the spreadsheet.",
      menuSeries: "Actions for series {{name}}",
      menuCategory: "Actions for category {{name}}",
    },
    menu: {
      insertAbove: "Insert category above",
      insertBelow: "Insert category below",
      moveUp: "Move up",
      moveDown: "Move down",
      removeCategory: "Delete category",
      accentCategory: "Highlight this slice",
      insertBefore: "Insert series before",
      insertAfter: "Insert series after",
      moveLeft: "Move left",
      moveRight: "Move right",
      sortAsc: "Sort categories ascending by this series",
      sortDesc: "Sort categories descending by this series",
      accentSeries: "Highlight this series",
      color: "Change series colour",
      removeSeries: "Delete series",
    },
    preview: {
      titlePaste: "Pasting a table",
      titleFile: "Importing a table from a file",
      descriptionChart:
        "Check the table layout. Applying replaces the chart data, and Ctrl+Z undoes the change.",
      descriptionMap:
        "Check the table layout. Applying replaces the map data, and Ctrl+Z undoes the change.",
      header: "First row is a header",
      transpose: "Series in rows (swap rows and columns)",
      locale: "Number format",
      locales: {
        auto: "Detect automatically",
        pl: "Polish (1 234,5)",
        en: "English (1,234.5)",
      },
      valueColumn: "Value column",
      summaryChart: "Categories: {{categories}}, series: {{series}}",
      summaryMap: "Countries: {{count}}",
      shown: "Preview of the first {{shown}} of {{total}} rows.",
      empty: "In this layout the table yields no data.",
      country: "Country",
      value: "Value",
      apply: "Apply",
      cancel: "Cancel",
    },
  },
};

let registered = false;
/** Idempotentne: rejestracja odbywa się raz, przy imporcie modułu. */
export function ensureChartDataEditorI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureChartDataEditorI18n();
