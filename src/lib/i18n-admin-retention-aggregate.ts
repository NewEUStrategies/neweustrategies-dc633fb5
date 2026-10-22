// i18n notki „starsze dni z agregatu dobowego" (I9d-Y1, Z-I9c-07) - PL/EN.
//
// PO CO OSOBNY, MAŁY SŁOWNIK. Notkę pokazują zakładka Lejek huba, mini lejek
// Kokpitu i pulpit monetyzacji - chunki, które nie ładują karty „Retencja
// danych". Klucze leżą pod `adminDataRetention.aggregateNote` (twarda
// bramka parytetu tego prefiksu), ale w osobnym pliku, żeby lejek nie
// ciągnął całego słownika karty (podstawy prawne trzynastu kategorii) dla
// jednego dymka.
//
// TREŚĆ = DECYZJA WYKONAWCZA I9d (dziennik §21.22): odczyty licznika żyją
// krócej (domyślnie 3 mies.) niż uderzenia w paywall, więc granica odczytu
// lejka i pulpitu przesuwa się do okresu odczytów; dni sprzed niej liczy
// anonimowy agregat dobowy - konto raz na dzień, nie raz na całe okno.
//
// UWAGA NA ARKUSZ CSS: pliki `src/lib/i18n-*.ts` skanuje generator arkusza
// PUBLICZNEGO - żadne słowo nie jest nazwą klasy narzędziowej (test
// `src/components/admin/settings/dataRetention/__tests__/i18nDataRetention.test.ts`).
//
// IMPORT WYŁĄCZNIE Z KOMPONENTÓW (`ensureI18n()`), nie z pliku trasy.
import i18n from "@/lib/i18n";

const pl = {
  adminDataRetention: {
    aggregateNote: {
      short: "Starsze dni z agregatu dobowego",
      label: "Skąd liczby starszych dni?",
      window:
        "Dni starsze niż okres przechowywania odczytów licznika (Ustawienia → Prywatność i retencja danych; domyślnie {{months}} mies.) liczone są z anonimowego agregatu dobowego: konto czytające albo z uderzeniem w paywall liczy się raz na dzień, nie raz na całe okno.",
      before:
        "Dni przed {{date}} liczone są z anonimowego agregatu dobowego (okres przechowywania odczytów licznika): sumy odczytów członków i gości oraz wyniki licznika bez zmian, bez wskazania osób i artykułów.",
    },
  },
};

const en: typeof pl = {
  adminDataRetention: {
    aggregateNote: {
      short: "Older days from the daily aggregate",
      label: "Where do the numbers for older days come from?",
      window:
        "Days older than the retention period of article meter reads (Settings → Privacy and data retention; {{months}} months by default) are counted from the anonymous daily aggregate: an account that read or hit the paywall counts once per day, not once per whole period.",
      before:
        "Days before {{date}} are counted from the anonymous daily aggregate (retention period of article meter reads): member and guest read totals and meter outcomes are unchanged, with no reference to people or articles.",
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
