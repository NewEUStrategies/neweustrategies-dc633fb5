// i18n odnośników „moduł → hub" (SPEC §2.7, montaż I9) - PL/EN.
//
// PO CO OSOBNY, MAŁY SŁOWNIK. Studio wydarzenia i panel klubów pokazują
// odnośniki do huba „Przychód i lejek" (automatyzacja komunikacji, przychód
// wszystkich wydarzeń, aktywne ścieżki wydarzeń, potwierdzenia zgłoszeń).
// Słownik powłoki huba (`i18n-admin-revenue-shell.ts`, ~28 KB) i słowniki
// ścieżek jadą w chunkach huba - ekran modułu dla kilku zdań dostaje tylko
// ten plik. Klucze leżą pod `adminRevenue.moduleLinks` (twarda bramka
// parytetu prefiksu `adminRevenue`), a żaden inny słownik nie pisze tej
// gałęzi (`i18nOverlayIntegrity`).
//
// UWAGA NA ARKUSZ CSS: pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - żadne słowo nie jest nazwą klasy narzędziowej (test
// `src/components/admin/revenue/molecules/__tests__/revenueModuleLinks.test.tsx`).
//
// LICZEBNIKI: PL `_one/_few/_many/_other`, EN czyta tylko `_one/_other`
// (warianty `_few/_many` po stronie EN wymusza `en: typeof pl`).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminRevenue: {
    moduleLinks: {
      events: {
        automateLabel: "Automatyczna komunikacja",
        automateDescription:
          "Gotowa ścieżka prowadzi zapisanych od potwierdzenia przez przypomnienia do podziękowania po wydarzeniu - w hubie „Przychód i lejek”, wspólnie dla wszystkich wydarzeń.",
        automateAction: "Zautomatyzuj komunikację",
        revenueLabel: "Przychód ze wszystkich wydarzeń",
        revenueDescription:
          "Bilety, obecność i przychód wszystkich wydarzeń razem - w hubie „Przychód i lejek”.",
        revenueAction: "Otwórz w hubie",
        journeysLabel: "Aktywne ścieżki wydarzeń",
        journeysDescription:
          "Ścieżki komunikacji uruchamiane zapisem na wydarzenie albo obecnością - działają dla wszystkich wydarzeń, nie tylko dla tego.",
        journeysCount_one: "{{count}} aktywna ścieżka",
        journeysCount_few: "{{count}} aktywne ścieżki",
        journeysCount_many: "{{count}} aktywnych ścieżek",
        journeysCount_other: "{{count}} aktywnej ścieżki",
        journeysNone: "Żadna aktywna ścieżka nie reaguje na zapisy na wydarzenia.",
        journeysOpen: "Zobacz ścieżki",
      },
      clubs: {
        automateHint:
          "Gotowa ścieżka potwierdza przyjęcie zgłoszenia do klubu i przypomina o decyzji - w hubie „Przychód i lejek”.",
        automateAction: "Zautomatyzuj potwierdzenia zgłoszeń",
      },
    },
  },
};

const en: typeof pl = {
  adminRevenue: {
    moduleLinks: {
      events: {
        automateLabel: "Automated communication",
        automateDescription:
          "A ready-made journey takes registrants from the confirmation through reminders to a thank-you after the event - in the “Revenue and funnel” hub, shared by every event.",
        automateAction: "Automate communication",
        revenueLabel: "Revenue from every event",
        revenueDescription:
          "Tickets, attendance and revenue of every event together - in the “Revenue and funnel” hub.",
        revenueAction: "Open in the hub",
        journeysLabel: "Active event journeys",
        journeysDescription:
          "Communication journeys started by an event registration or attendance - they run for every event, not just this one.",
        journeysCount_one: "{{count}} active journey",
        journeysCount_few: "{{count}} active journeys",
        journeysCount_many: "{{count}} active journeys",
        journeysCount_other: "{{count}} active journeys",
        journeysNone: "No active journey reacts to event registrations.",
        journeysOpen: "View journeys",
      },
      clubs: {
        automateHint:
          "A ready-made journey confirms that a club application arrived and reminds about the decision - in the “Revenue and funnel” hub.",
        automateAction: "Automate application confirmations",
      },
    },
  },
};

// Rejestracja jawna (komponent woła `ensureI18n()`) ORAZ przy imporcie:
// bramki parytetu ładują nakładki globem i liczą na efekt importu.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
