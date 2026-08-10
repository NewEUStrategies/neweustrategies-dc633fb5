import i18n from "./i18n";

// Podgląd plików w platformie (PL/EN). Osobny bundle, bo popup podglądu
// obsługuje kilka powierzchni naraz - wpisy klubowe, dokumenty, czat - i żadna
// z nich nie powinna być właścicielem tych stringów.

const pl = {
  fileViewer: {
    open: "Podgląd",
    close: "Zamknij podgląd",
    download: "Pobierz",
    openInTab: "Otwórz w nowej karcie",
    loading: "Wczytuję dokument...",
    parsing: "Przetwarzam plik...",
    page: "Strona",
    sheet: "Arkusz",
    slide: "Slajd {{index}}",
    notes: "Notatki prelegenta",
    rows: "{{count}} wierszy",
    zoomIn: "Powiększ",
    zoomOut: "Pomniejsz",
    zoomReset: "Rozmiar oryginalny",
    prev: "Poprzedni",
    next: "Następny",
    error: "Nie udało się otworzyć podglądu tego pliku.",
    unsupported: "Tego formatu nie pokazujemy w podglądzie - pobierz plik, aby go otworzyć.",
    emptyDocument: "Dokument nie zawiera treści do pokazania.",
    legacyFormat:
      "To starszy format pakietu Office (.doc/.xls/.ppt). Pobierz plik, aby otworzyć go lokalnie.",
    protectedHint: "Plik może być zaszyfrowany lub uszkodzony.",
  },
};

const en: typeof pl = {
  fileViewer: {
    open: "Preview",
    close: "Close preview",
    download: "Download",
    openInTab: "Open in a new tab",
    loading: "Loading document...",
    parsing: "Processing file...",
    page: "Page",
    sheet: "Sheet",
    slide: "Slide {{index}}",
    notes: "Speaker notes",
    rows: "{{count}} rows",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Actual size",
    prev: "Previous",
    next: "Next",
    error: "We could not open a preview of this file.",
    unsupported: "We do not preview this format - download the file to open it.",
    emptyDocument: "The document has no content to display.",
    legacyFormat:
      "This is a legacy Office format (.doc/.xls/.ppt). Download the file to open it locally.",
    protectedHint: "The file may be encrypted or damaged.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/** No-op utrzymujący rejestrację słownika w chunku konsumenta. */
export function ensureI18n(): void {}
