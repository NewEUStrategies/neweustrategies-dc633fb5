// Nakładka i18n NAGŁÓWKA DOKUMENTU strony „Chcę dalej otrzymywać"
// (`/newsletter/keep`, I9d-Y1 - wygaszanie nieaktywnych subskrybentów).
//
// OSOBNY PLIK, NIE `i18n-newsletter-keep`. `head()` trasy jedzie w chunku
// startowym każdej strony czytelnika (automatyczny podział kodu wydziela
// wyłącznie komponent) - tu stoją tylko dwa zdania nagłówka, a słownik
// strony ładuje się z jej chunku. Precedens: `i18n-event-sponsor-report-head`.
// Klucze leżą pod prefiksem strony (`newsletterKeep` - bramka parytetu), ale
// wyłącznie tutaj: słownik strony ich nie powtarza, więc nie ma kolizji.
// Język nagłówka wybiera `i18n.getFixedT(lang)`, nigdy globalne
// `i18n.language` (instancja serwera obsługuje równoległe żądania).
//
// UWAGA NA ARKUSZ CSS: plik skanuje generator arkusza publicznego - żadne
// angielskie słowo niżej nie jest nazwą klasy Tailwinda.
import i18n from "@/lib/i18n";

const pl = {
  newsletterKeep: {
    metaTitle: "Newsletter - potwierdzenie subskrypcji",
    metaDescription: "Potwierdź, że chcesz dalej otrzymywać newsletter New European Strategies.",
  },
};

const en: typeof pl = {
  newsletterKeep: {
    metaTitle: "Newsletter - subscription confirmation",
    metaDescription:
      "Confirm that you want to keep receiving the New European Strategies newsletter.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
