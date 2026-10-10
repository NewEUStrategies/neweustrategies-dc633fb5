// EDYTOR MAPY DANYCH - nakładka słownika dla AUTORA (`mapEditor.*`).
//
// Napisy edytora kartogramu w panelu admina: blok CMS (`DataMapBlock.tsx`),
// siatka danych mapy (`MapDataGrid.tsx`), wybór skali barw
// (`MapScalePicker.tsx`, `MapSchemeField.tsx`), arkusz mapy w builderze
// (`MapDataDialog.tsx`, `MapDataField.tsx`) i tryb mapy podglądu wklejki.
// Czytelnik opublikowanej strony nie potrzebuje żadnego z nich, więc
// nakładka jedzie wyłącznie z chunkami panelu - napisy mapy widziane przez
// czytelnika są w `i18n-charts-map.ts` (`chartsMap.*`).
//
// NAZWY SCHEMATÓW BARW I METOD PODZIAŁU są KANONICZNE i muszą być TE SAME co
// w nakładce czytelnika (`chartsMap.schemes.*`, `chartsMap.methods.*`): autor
// wybiera nazwę, którą czytelnik zobaczy w legendzie. Pilnuje tego bramka
// `chartOverlayParity.test.ts` (razem z parytetem PL/EN i zakazem pauzy).
// Dlatego `methods` ma dokładnie trzy liście - liczba klas („5 klas") stoi
// osobno, w `scale.classesN`.
//
// Klucze wołane z kodu wypisuj JAWNIE mapą `Record<Unia, string>` - bramka
// `mapEditorKeys.test.ts` czyta je z plików edytora mapy i sprawdza
// w słowniku obu języków.
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
    grid: {
      label: "Dane mapy - kraj i wartość",
      code: "Kod kraju",
      country: "Kraj",
      value: "Wartość",
      status: "Uwagi",
      codeCell: "Kod albo nazwa kraju, wiersz {{n}}",
      // Nazwa dostępna komórki wartości - kontrakt PR2: „{kraj} - wartość".
      cell: "{{country}} - wartość",
      rowN: "Wiersz {{n}}",
      codePlaceholder: "PL albo Polska",
      valuePlaceholder: "brak danych",
      addRow: "Dodaj kraj",
      menu: "Działania na wierszu {{name}}",
      limitRows: "Osiągnięto limit wierszy: {{max}}.",
      invalidNumber:
        "To nie jest liczba - popraw wpis albo wyczyść komórkę (pusta komórka to brak danych).",
      // Napis zapisany w treści, którego czytnik mapy nie odczyta („12%").
      invalidStored:
        "Mapa nie odczyta tej zapisanej wartości jako liczby - popraw wpis albo wyczyść komórkę (pusta komórka to brak danych).",
      pasteHint:
        "Zakres z Excela, Arkuszy Google albo LibreOffice wklejasz w dowolną komórkę - trafia od niej w dół. Cała tabela wklejona w pustą siatkę albo w pierwszą komórkę otwiera podgląd. W kolumnie kodu możesz wpisać nazwę kraju (np. Czechy, Czech Republic, UK) - zamieni się na kod ISO-2. Ctrl+Z cofa zmianę.",
      pasted: "Wklejono dane z arkusza.",
      // Zapowiedź dla czytnika ekranu po zatwierdzeniu wiersza z uwagą.
      statusLive: "Wiersz {{n}}: {{status}}",
    },
    status: {
      unknown: "Nieznany kod albo nazwa kraju - wiersz nie trafi na mapę.",
      duplicate: "Kraj powtórzony - mapa pokaże wartość z wiersza {{row}}.",
      outside: "Poza wybranym regionem - kraj trafi do noty pod mapą, nie na rysunek.",
      outsideNoValue:
        "Poza wybranym regionem i bez wartości - kraju nie będzie ani na rysunku, ani w nocie pod mapą.",
      noValue: "Brak wartości - kraj będzie kreskowany jako brak danych.",
      invalidValue:
        "Zapisana wartość nie jest liczbą, którą mapa odczyta - kraj będzie kreskowany jako brak danych, dopóki jej nie poprawisz.",
      noCountry: "Wpisz kod albo nazwę kraju - wartość bez kraju nie trafi na mapę.",
    },
    menu: {
      insertAbove: "Wstaw wiersz powyżej",
      insertBelow: "Wstaw wiersz poniżej",
      moveUp: "Przesuń w górę",
      moveDown: "Przesuń w dół",
      remove: "Usuń wiersz",
    },
    scale: {
      group: "Skala barw",
      scheme: "Schemat barw",
      classes: "Liczba klas",
      classesN: {
        c3: "3 klasy",
        c4: "4 klasy",
        c5: "5 klas",
        c6: "6 klas",
        c7: "7 klas",
      },
      method: "Metoda podziału",
      midpoint: "Środek skali (puste = 0)",
      midpointHint:
        "Wartość w neutralnym środku skali rozbieżnej, np. średnia UE albo zero zmiany. Przecinek dziesiętny jest dozwolony.",
      // Wpis środka, który nie jest liczbą - zapisany środek zostaje.
      midpointInvalid:
        "To nie jest liczba - mapa zostaje przy poprzednim środku skali. Popraw wpis albo wyczyść pole (puste = 0).",
      divergingHint:
        "Rozbieżny - dla wskaźnika z punktem odniesienia: spadek i wzrost wokół środka skali.",
      legend: "Podgląd legendy",
      legendEmpty: "Legenda pojawi się, gdy mapa dostanie wartości.",
    },
    preview: {
      transpose: "Kraje w kolumnach (zamień wiersze z kolumnami)",
      countryColumn: "Kolumna krajów",
    },
    import: {
      // Podpowiedź pola importu mapy - kolumnę krajów rozpoznaje podgląd.
      hint: "xlsx, xls, ods, csv, tsv i inne arkusze - kolumnę krajów (kod ISO-2, ISO-3 albo nazwa) i kolumnę wartości wskażesz w podglądzie",
    },
    dialog: {
      open: "Edytuj w arkuszu",
      title: "Arkusz danych mapy",
      subtitle: "Edytuj kraje i wartości jak w arkuszu - mapa po prawej odświeża się na bieżąco.",
      preview: "Podgląd mapy",
      reset: "Przywróć",
      close: "Zamknij",
    },
    block: {
      dataGroup: "Dane",
      referencesGroup: "Odniesienia i podpis",
      caption: "Podpis pod mapą",
      sourcesHint:
        "Źródła trafiają do przypisów pod mapą, a w artykule - do wspólnej sekcji przypisów.",
      missingNotes: "Dopisz, czego mapa NIE pokazuje - np. kraje bez danych albo inny rok pomiaru.",
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
    grid: {
      label: "Map data - country and value",
      code: "Country code",
      country: "Country",
      value: "Value",
      status: "Notes",
      codeCell: "Country code or name, row {{n}}",
      cell: "{{country}} - value",
      rowN: "Row {{n}}",
      codePlaceholder: "PL or Poland",
      valuePlaceholder: "no data",
      addRow: "Add country",
      menu: "Actions for row {{name}}",
      limitRows: "Row limit reached: {{max}}.",
      invalidNumber:
        "This is not a number - correct the entry or clear the cell (an empty cell means no data).",
      invalidStored:
        "The map cannot read this saved value as a number - correct the entry or clear the cell (an empty cell means no data).",
      pasteHint:
        "Paste a range from Excel, Google Sheets or LibreOffice into any cell - it fills from that cell down. A whole table pasted into an empty sheet or into the first cell opens a preview. You can type a country name in the code column (e.g. Czechy, Czech Republic, UK) - it becomes the ISO-2 code. Ctrl+Z undoes the change.",
      pasted: "Data pasted from the spreadsheet.",
      statusLive: "Row {{n}}: {{status}}",
    },
    status: {
      unknown: "Unknown country code or name - the row will not reach the map.",
      duplicate: "Repeated country - the map shows the value from row {{row}}.",
      outside:
        "Outside the selected region - the country goes to the note under the map, not to the drawing.",
      outsideNoValue:
        "Outside the selected region and without a value - the country appears neither on the drawing nor in the note under the map.",
      noValue: "No value - the country will be hatched as no data.",
      invalidValue:
        "The saved value is not a number the map can read - the country will be hatched as no data until you correct it.",
      noCountry: "Enter a country code or name - a value without a country will not reach the map.",
    },
    menu: {
      insertAbove: "Insert row above",
      insertBelow: "Insert row below",
      moveUp: "Move up",
      moveDown: "Move down",
      remove: "Delete row",
    },
    scale: {
      group: "Colour scale",
      scheme: "Colour scheme",
      classes: "Number of classes",
      classesN: {
        c3: "3 classes",
        c4: "4 classes",
        c5: "5 classes",
        c6: "6 classes",
        c7: "7 classes",
      },
      method: "Classification method",
      midpoint: "Scale midpoint (empty = 0)",
      midpointHint:
        "The value at the neutral middle of the diverging scale, e.g. the EU average or zero change. A decimal comma is accepted.",
      midpointInvalid:
        "This is not a number - the map keeps the previous midpoint. Correct the entry or clear the field (empty = 0).",
      divergingHint:
        "Diverging - for an indicator with a reference point: decrease and increase around the middle of the scale.",
      legend: "Legend preview",
      legendEmpty: "The legend appears once the map has values.",
    },
    preview: {
      transpose: "Countries in columns (swap rows and columns)",
      countryColumn: "Country column",
    },
    import: {
      hint: "xlsx, xls, ods, csv, tsv and other spreadsheets - you pick the country column (ISO-2 code, ISO-3 code or name) and the value column in the preview",
    },
    dialog: {
      open: "Edit as a sheet",
      title: "Map data sheet",
      subtitle:
        "Edit countries and values like a spreadsheet - the map on the right updates as you go.",
      preview: "Map preview",
      reset: "Reset",
      close: "Close",
    },
    block: {
      dataGroup: "Data",
      referencesGroup: "References and caption",
      caption: "Caption under the map",
      sourcesHint:
        "Sources go to the footnotes under the map and, in an article, to the shared footnote section.",
      missingNotes:
        "Add what the map does NOT show - e.g. countries without data or a different measurement year.",
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
