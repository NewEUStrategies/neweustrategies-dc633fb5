// Nakładka i18n NAGŁÓWKÓW DOKUMENTU zakładek wydarzenia (Program, Prelegenci).
//
// OSOBNY PLIK, NIE `i18n-event-front`. `head()` trasy nie jest dzielone przez
// automatyczny podział kodu - jedzie w drzewie tras, czyli w chunku startowym
// każdej strony. Import `i18n-event-front` stąd wciągał do tego chunka CAŁY
// słownik frontu wydarzenia (programu, zapisów, partnerów) i przekraczał budżet
// `check:bundle` na największym chunku. Tu stoi wyłącznie to, czego potrzebuje
// `buildEventTabHead` - kilka zdań.
//
// Import efektem ubocznym:
//   import "@/lib/i18n-event-head";
import i18n from "./i18n";

export const eventHeadPl = {
  eventHead: {
    agendaTitle: "Program - {{event}}",
    agendaDescription: "Program wydarzenia {{event}}: dni, ścieżki, debaty i sesje z obsadą.",
    speakersTitle: "Prelegenci i moderatorzy - {{event}}",
    speakersDescription: "Prelegenci, moderatorzy i eksperci wydarzenia {{event}}.",
    eventFallback: "Wydarzenie",
  },
} as const;

export const eventHeadEn = {
  eventHead: {
    agendaTitle: "Programme - {{event}}",
    agendaDescription:
      "The {{event}} programme: days, tracks, debates and sessions with their line-up.",
    speakersTitle: "Speakers and moderators - {{event}}",
    speakersDescription: "Speakers, moderators and experts of {{event}}.",
    eventFallback: "Event",
  },
} as const;

i18n.addResourceBundle("pl", "translation", eventHeadPl, true, true);
i18n.addResourceBundle("en", "translation", eventHeadEn, true, true);
