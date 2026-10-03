// Wspólny słownik GLOBALNEGO OBSZARU WGRYWANIA (`@/components/ui/upload-area`).
//
// Obszary wgrywania stoją na kilkunastu powierzchniach (media, CRM, newsletter,
// wydarzenia, kariera, wygląd, wykresy) i przed ujednoliceniem każda miała
// własne mikro-teksty: raz „Wgraj", raz „Kliknij aby wybrac plik", raz sam
// przycisk bez zdania o dozwolonych formatach. Tu stoi WSPÓLNY rdzeń tej
// kopii - zdania o formatach i błędach, etykiety urządzeń podglądu i opisy
// obszarów per rodzaj pliku, które powtarzają się między powierzchniami. Kopia
// charakterystyczna dla jednej powierzchni zostaje w jej własnym słowniku.
//
// KLUCZ WCHODZI TU RAZEM Z POWIERZCHNIĄ, KTÓRA GO CZYTA. Zasiane „na zapas”
// ogólne CTA, podmiana i usunięcie pliku, stany wysyłki i przetwarzania,
// zdanie o przeciąganiu i limit rozmiaru (także w wariantach dla wielu
// plików) oraz opisy obszarów audio, danych i dokumentu nie miały ani jednego
// czytelnika - powierzchnie podają własne etykiety przycisków. Tłumacz
// utrzymywał je w dwóch językach, a poprawka wniesiona w nie nie zmieniała
// żadnego ekranu. Pilnuje tego src/lib/__tests__/overlayReaders.test.ts.
//
// Nakładka rejestruje się side-effectem importu; plik, który używa kluczy
// `uploadArea.*`, MUSI zaimportować `@/lib/i18n-upload-area` (bramka
// src/lib/ci/__tests__/i18nOverlayImports.test.ts).
import i18n from "./i18n";

const pl = {
  uploadArea: {
    badType: "Ten plik ma niedozwolony typ ({{name}}). Wgraj plik z listy dozwolonych formatów.",
    tooLarge: "Plik {{name}} jest za duży - maksymalnie {{max}} MB.",
    uploadError: "Nie udało się wgrać pliku.",
    devices: {
      desktop: "Komputer",
      tablet: "Tablet",
      mobile: "Telefon",
    },
    csv: {
      title: "Wgraj plik CSV",
      description: "Przeciągnij plik .csv tutaj albo wybierz go z dysku.",
      cta: "Wybierz plik CSV",
      rowLimit: "Do {{max}} wierszy w jednym pliku.",
    },
    wxr: {
      title: "Plik WXR (.xml)",
      description:
        "Przeciągnij plik eksportu WordPressa tutaj albo wybierz go z dysku.\nwp-admin: Narzędzia → Eksport → „Strony”. Media są ściągane automatycznie z adresów w treści (jeżeli są publicznie dostępne).",
      cta: "Wybierz plik XML",
      reading: "Czytanie pliku…",
    },
    font: {
      title: "Wgraj plik fontu",
      description: "Przeciągnij plik .woff2, .woff, .ttf lub .otf tutaj albo wybierz go z dysku.",
    },
    media: {
      title: "Wgraj pliki do biblioteki",
      description:
        "Przeciągnij obrazy, audio, wideo lub PDF tutaj albo wybierz je z dysku.\nTrafią do bieżącego folderu.",
    },
    image: {
      title: "Wgraj grafikę",
      description: "Przeciągnij obraz tutaj albo wybierz go z dysku.",
    },
  },
};

const en = {
  uploadArea: {
    badType: "This file has a disallowed type ({{name}}). Upload one of the allowed formats.",
    tooLarge: "The file {{name}} is too large - {{max}} MB at most.",
    uploadError: "The file could not be uploaded.",
    devices: {
      desktop: "Desktop",
      tablet: "Tablet",
      mobile: "Mobile",
    },
    csv: {
      title: "Upload a CSV file",
      description: "Drag a .csv file here, or pick one from your disk.",
      cta: "Choose a CSV file",
      rowLimit: "Up to {{max}} rows per file.",
    },
    wxr: {
      title: "WXR file (.xml)",
      description:
        'Drag the WordPress export file here, or pick it from your disk.\nwp-admin: Tools → Export → "Pages". Media is fetched automatically from URLs in the content (if publicly reachable).',
      cta: "Choose an XML file",
      reading: "Reading the file…",
    },
    font: {
      title: "Upload a font file",
      description: "Drag a .woff2, .woff, .ttf or .otf file here, or pick one from your disk.",
    },
    media: {
      title: "Upload files to the library",
      description:
        "Drag images, audio, video or PDFs here, or pick them from your disk.\nThey land in the current folder.",
    },
    image: {
      title: "Upload an image",
      description: "Drag an image here, or pick one from your disk.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
