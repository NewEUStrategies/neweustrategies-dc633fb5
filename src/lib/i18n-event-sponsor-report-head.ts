// Nakładka i18n NAGŁÓWKA DOKUMENTU strony raportu dla sponsora
// (`/events/$slug/sponsor-report`).
//
// OSOBNY PLIK, NIE `i18n-event-sponsor-report`. `head()` trasy jedzie w chunku
// startowym (nie dzieli go automatyczny podział kodu) - tu stoją wyłącznie dwa
// zdania nagłówka, a słownik całej strony raportu ładuje się z jej chunka.
// Język nagłówka wybiera `i18n.getFixedT(lang)`, nigdy globalne
// `i18n.language` (instancja serwera obsługuje równoległe żądania).
import i18n from "@/lib/i18n";

export const eventSponsorReportHeadPl = {
  eventSponsorReportHead: {
    title: "Raport dla sponsora",
    description: "Wyświetlenia, kliknięcia i zebrane kontakty partnera wydarzenia.",
  },
} as const;

export const eventSponsorReportHeadEn = {
  eventSponsorReportHead: {
    title: "Sponsor report",
    description: "Impressions, clicks and collected contacts of an event partner.",
  },
} as const;

i18n.addResourceBundle("pl", "translation", eventSponsorReportHeadPl, true, true);
i18n.addResourceBundle("en", "translation", eventSponsorReportHeadEn, true, true);
