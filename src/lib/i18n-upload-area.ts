// Wspólny słownik GLOBALNEGO OBSZARU WGRYWANIA (`@/components/ui/upload-area`).
//
// Obszary wgrywania stoją na kilkunastu powierzchniach (media, CRM, newsletter,
// wydarzenia, kariera, wygląd, wykresy) i przed ujednoliceniem każda miała
// własne mikro-teksty: raz „Wgraj", raz „Kliknij aby wybrac plik", raz sam
// przycisk bez zdania o dozwolonych formatach. Tu stoi WSPÓLNY rdzeń tej
// kopii - czasowniki, stan wysyłki i zdania o formatach, które powtarzają się
// między powierzchniami. Kopia charakterystyczna dla jednej powierzchni
// zostaje w jej własnym słowniku.
//
// Nakładka rejestruje się side-effectem importu; plik, który używa kluczy
// `uploadArea.*`, MUSI zaimportować `@/lib/i18n-upload-area` (bramka
// src/lib/ci/__tests__/i18nOverlayImports.test.ts).
import i18n from "./i18n";

const pl = {
  uploadArea: {
    cta: "Wybierz plik",
    ctaMultiple: "Wybierz pliki",
    change: "Zmień plik",
    uploading: "Wgrywanie…",
    processing: "Przetwarzanie…",
    remove: "Usuń",
    dropOrPick: "Przeciągnij plik tutaj albo wybierz go z dysku.",
    dropOrPickMultiple: "Przeciągnij pliki tutaj albo wybierz je z dysku.",
    maxSize: "Maksymalny rozmiar: {{size}}.",
    badType: "Ten plik ma niedozwolony typ ({{name}}). Wgraj plik z listy dozwolonych formatów.",
    tooLarge: "Plik {{name}} jest za duży - maksymalnie {{max}} MB.",
    csv: {
      title: "Wgraj plik CSV",
      description: "Przeciągnij plik .csv tutaj albo wybierz go z dysku.",
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
    audio: {
      title: "Wgraj nagranie",
      description: "Przeciągnij plik audio tutaj albo wybierz go z dysku.",
    },
    data: {
      title: "Wgraj dane",
      description: "Przeciągnij plik CSV lub XLSX tutaj albo wybierz go z dysku.",
    },
    document: {
      title: "Wgraj dokument",
      description: "Przeciągnij plik tutaj albo wybierz go z dysku.",
    },
  },
};

const en = {
  uploadArea: {
    cta: "Choose file",
    ctaMultiple: "Choose files",
    change: "Replace file",
    uploading: "Uploading…",
    processing: "Processing…",
    remove: "Remove",
    dropOrPick: "Drag a file here, or pick one from your disk.",
    dropOrPickMultiple: "Drag files here, or pick them from your disk.",
    maxSize: "Maximum size: {{size}}.",
    badType: "This file has a disallowed type ({{name}}). Upload one of the allowed formats.",
    tooLarge: "The file {{name}} is too large - {{max}} MB at most.",
    csv: {
      title: "Upload a CSV file",
      description: "Drag a .csv file here, or pick one from your disk.",
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
    audio: {
      title: "Upload a recording",
      description: "Drag an audio file here, or pick one from your disk.",
    },
    data: {
      title: "Upload data",
      description: "Drag a CSV or XLSX file here, or pick one from your disk.",
    },
    document: {
      title: "Upload a document",
      description: "Drag a file here, or pick one from your disk.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
