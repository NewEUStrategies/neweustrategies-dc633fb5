// Nakładka i18n NAGŁÓWKA DOKUMENTU strony linków pomiaru otwarć i kliknięć
// (`/newsletter/measurement`, I9d-Y2).
//
// OSOBNY PLIK, NIE `i18n-newsletter-measurement`. `head()` trasy jedzie
// w chunku startowym każdej strony czytelnika (automatyczny podział kodu
// wydziela wyłącznie komponent) - tu stoją tylko dwa zdania nagłówka,
// a słownik strony ładuje się z jej chunku (precedens:
// `i18n-newsletter-keep-head`). Klucze leżą pod prefiksem strony
// (`newsletterMeasurement`), ale wyłącznie tutaj: słownik strony ich nie
// powtarza, więc nie ma kolizji. Język nagłówka wybiera `i18n.getFixedT(lang)`,
// nigdy globalne `i18n.language` (instancja serwera obsługuje równoległe
// żądania).
//
// UWAGA NA ARKUSZ CSS: plik skanuje generator arkusza publicznego - żadne
// angielskie słowo niżej nie jest nazwą klasy Tailwinda.
import i18n from "@/lib/i18n";

const pl = {
  newsletterMeasurement: {
    metaTitle: "Newsletter - pomiar otwarć i kliknięć",
    metaDescription:
      "Zdecyduj, czy mierzymy otwarcia i kliknięcia w wiadomościach New European Strategies.",
  },
};

const en: typeof pl = {
  newsletterMeasurement: {
    metaTitle: "Newsletter - measuring opens and clicks",
    metaDescription:
      "Decide whether we measure opens and clicks in emails from New European Strategies.",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
