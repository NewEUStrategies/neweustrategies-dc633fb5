// Zasoby i18n biblioteki materiałów członkowskich (/library) + admin.library.
import i18n from "@/lib/i18n";

export const libraryPl = {
  library: {
    title: "Biblioteka materiałów",
    subtitle:
      "Raporty, briefingi, transkrypcje i dane dla członków. Dostęp zależy od poziomu członkostwa.",
    empty: "Nie ma jeszcze żadnych materiałów.",
    loading: "Wczytywanie...",
    loadError: "Nie udało się wczytać biblioteki.",
    download: "Pobierz",
    preparing: "Przygotowywanie...",
    downloads_one: "{{count}} pobranie",
    downloads_few: "{{count}} pobrania",
    downloads_many: "{{count}} pobrań",
    downloads_other: "{{count}} pobrań",
    locked: "Materiał dla członków",
    lockedTier: "Wymaga poziomu: {{tier}}",
    signInHint: "Zaloguj się, aby pobierać materiały.",
    upgradeCta: "Zobacz poziomy członkostwa",
    tierErrorToast: "Twój poziom członkostwa nie obejmuje tego materiału.",
    downloadErrorToast: "Nie udało się przygotować pliku. Spróbuj ponownie.",
    categoryLabel: "Rodzaj",
    categories: {
      report: "Raport",
      brief: "Briefing",
      transcript: "Transkrypcja",
      slides: "Slajdy",
      data: "Dane",
      other: "Inne",
    },
  },
};

export const libraryEn: typeof libraryPl = {
  library: {
    title: "Members' library",
    subtitle:
      "Reports, briefings, transcripts and data for members. Access depends on your membership level.",
    empty: "No materials yet.",
    loading: "Loading...",
    loadError: "Could not load the library.",
    download: "Download",
    preparing: "Preparing...",
    downloads_one: "{{count}} download",
    downloads_few: "{{count}} downloads",
    downloads_many: "{{count}} downloads",
    downloads_other: "{{count}} downloads",
    locked: "Members-only material",
    lockedTier: "Requires level: {{tier}}",
    signInHint: "Sign in to download materials.",
    upgradeCta: "See membership levels",
    tierErrorToast: "Your membership level does not cover this material.",
    downloadErrorToast: "Could not prepare the file. Please try again.",
    categoryLabel: "Type",
    categories: {
      report: "Report",
      brief: "Briefing",
      transcript: "Transcript",
      slides: "Slides",
      data: "Data",
      other: "Other",
    },
  },
};

i18n.addResourceBundle("pl", "translation", libraryPl, true, true);
i18n.addResourceBundle("en", "translation", libraryEn, true, true);
