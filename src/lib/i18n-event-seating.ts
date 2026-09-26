// Słownik MIEJSCA NA SALI widzianego przez uczestnika, PL/EN.
//
// OSOBNY PLIK OD PANELU. Ten bundle ląduje w publicznym chunku (zakładka
// „Moje” i strona biletu), więc nie może wciągać kilkuset zdań edytora planu
// z `i18n-admin-event-seating.ts`. Panel importuje stąd wyłącznie wspólną
// etykietę miejsca (`eventSeating.label.*`), żeby miejsce brzmiało tak samo na
// ekranie organizatora, na bilecie i na liście przy drzwiach.
import i18n from "@/lib/i18n";

export const eventSeatingPl = {
  eventSeating: {
    label: {
      rows: "Sektor {{section}}, rząd {{row}}, miejsce {{seat}}",
      table: "Stół {{section}}, miejsce {{seat}}",
    },
    card: {
      title: "Twoje miejsce na sali",
      loading: "Sprawdzamy Twoje miejsce…",
      error: "Nie udało się wczytać Twojego miejsca. Spróbuj ponownie za chwilę.",
      retry: "Spróbuj ponownie",
      none: "Organizator nie przydzielił Ci jeszcze miejsca na sali. Pojawi się tutaj po publikacji planu.",
      plan: "Plan: {{name}}",
      room: "Sala: {{name}}",
      floor: "Piętro: {{floor}}",
      session: "Dotyczy: {{title}}",
      category: "Kategoria: {{name}}",
      accessible: "Miejsce dostosowane dla osoby na wózku",
    },
    map: {
      label: "Mini-mapa sali: {{seat}}",
      stage: "Scena",
      yours: "Twoje miejsce",
      others: "Pozostałe miejsca w Twojej sekcji",
    },
  },
} as const;

export const eventSeatingEn = {
  eventSeating: {
    label: {
      rows: "Section {{section}}, row {{row}}, seat {{seat}}",
      table: "Table {{section}}, seat {{seat}}",
    },
    card: {
      title: "Your seat",
      loading: "Checking your seat…",
      error: "Your seat could not be loaded. Try again in a moment.",
      retry: "Try again",
      none: "The organiser has not assigned you a seat yet. It will appear here once the seating plan is published.",
      plan: "Plan: {{name}}",
      room: "Room: {{name}}",
      floor: "Floor: {{floor}}",
      session: "For: {{title}}",
      category: "Category: {{name}}",
      accessible: "Wheelchair-accessible seat",
    },
    map: {
      label: "Room mini-map: {{seat}}",
      stage: "Stage",
      yours: "Your seat",
      others: "Other seats in your section",
    },
  },
};

i18n.addResourceBundle("pl", "translation", eventSeatingPl, true, true);
i18n.addResourceBundle("en", "translation", eventSeatingEn, true, true);

/** Jawne zaznaczenie zależności przed pierwszym renderem; sam import już rejestruje. */
export function ensureEventSeatingI18n(): void {}
