// Nakładka i18n NAGŁÓWKÓW DOKUMENTU zakładek wydarzenia (Program, Prelegenci,
// Nabór prelegentów) i tytułów kart stron prywatnych naboru.
//
// OSOBNY PLIK, NIE `i18n-event-front`. `head()` trasy nie jest dzielone przez
// automatyczny podział kodu - jedzie w drzewie tras, czyli w chunku startowym
// każdej strony. Import `i18n-event-front` stąd wciągał do tego chunka CAŁY
// słownik frontu wydarzenia (programu, zapisów, partnerów) i przekraczał budżet
// `check:bundle` na największym chunku. Tu stoi wyłącznie to, czego potrzebuje
// `buildEventTabHead` - kilka zdań.
//
// TYTUŁY TRAS F1-F5 (`meTitle`, `transferTitle`, `certificateTitle`,
// `followUpTitle`) są KRÓTKIE i bez interpolacji: `head()` tych tras nie ma
// loadera z nazwą wydarzenia (S38), a każdy bajt tego pliku jedzie w chunku
// startowym każdej strony.
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
    cfpTitle: "Nabór prelegentów - {{event}}",
    cfpDescription:
      "Zgłoś wystąpienie na {{event}}: zasady naboru, formy wystąpień, ścieżki i termin zgłoszeń.",
    cfpSubmitTitle: "Zgłoszenie wystąpienia",
    speakerPanelTitle: "Panel prelegenta",
    reviewPanelTitle: "Panel recenzenta",
    eventFallback: "Wydarzenie",
    meTitle: "Mój panel wydarzenia",
    transferTitle: "Przekazanie biletu",
    certificateTitle: "Weryfikacja certyfikatu",
    followUpTitle: "Po wydarzeniu",
  },
} as const;

export const eventHeadEn = {
  eventHead: {
    agendaTitle: "Programme - {{event}}",
    agendaDescription:
      "The {{event}} programme: days, tracks, debates and sessions with their line-up.",
    speakersTitle: "Speakers and moderators - {{event}}",
    speakersDescription: "Speakers, moderators and experts of {{event}}.",
    cfpTitle: "Call for speakers - {{event}}",
    cfpDescription:
      "Submit a talk to {{event}}: call rules, talk formats, tracks and the submission deadline.",
    cfpSubmitTitle: "Talk submission",
    speakerPanelTitle: "Speaker panel",
    reviewPanelTitle: "Reviewer panel",
    eventFallback: "Event",
    meTitle: "My event panel",
    transferTitle: "Ticket transfer",
    certificateTitle: "Certificate check",
    followUpTitle: "After the event",
  },
} as const;

i18n.addResourceBundle("pl", "translation", eventHeadPl, true, true);
i18n.addResourceBundle("en", "translation", eventHeadEn, true, true);
