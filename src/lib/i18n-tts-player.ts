// Słownik odtwarzacza lektora AI (PL/EN) - komunikaty widoczne dla czytelnika.
// Import jako efekt uboczny w `components/TtsPlayer.tsx`.
//
// Trzy komunikaty błędu szły wcześniej przez `isPl ? "..." : "..."`, więc nie
// istniały w żadnym słowniku - a to jedyne zdania, jakie czytelnik dostaje,
// gdy audio się nie wczyta.
import i18n from "./i18n";

const pl = {
  ttsPlayer: {
    errors: {
      noText: "Brak tekstu do odczytania",
      signInRequired: "Zaloguj się, aby odsłuchać wersję audio.",
      loadFailed: "Nie udało się wczytać wersji audio. Spróbuj ponownie.",
    },
  },
};

const en = {
  ttsPlayer: {
    errors: {
      noText: "No text to read aloud",
      signInRequired: "Sign in to listen to the audio version.",
      loadFailed: "Could not load the audio version. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
