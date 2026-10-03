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
// TRZY Z NICH NIE MAJĄ JESZCZE CZYTELNIKA - CELOWO. Z czterech czytany jest
// dziś tylko `meTitle` (`events.$slug.me.tsx`); trasy przekazania biletu (tor B),
// weryfikacji certyfikatu i „Po wydarzeniu" (tor C) jeszcze nie istnieją.
// Foundation zasiewa ich tytuły tutaj, żeby tory nie edytowały wspólnej
// nakładki chunku startowego (konflikt przy scalaniu trzech gałęzi) - kontrakt
// przypina `__tests__/participantOverlays.test.ts` (pkt 5). Każdy INNY klucz
// bez czytelnika oblewa `__tests__/overlayReaders.test.ts`; tor porzucony
// zabiera swój tytuł ze sobą.
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
