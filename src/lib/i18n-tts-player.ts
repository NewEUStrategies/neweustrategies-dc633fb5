// Słownik odtwarzacza lektora AI (PL/EN) - komunikaty widoczne dla czytelnika.
// Import jako efekt uboczny w komponentach, które go czytają.
//
// Trzy komunikaty błędu szły wcześniej przez `isPl ? "..." : "..."`, więc nie
// istniały w żadnym słowniku - a to jedyne zdania, jakie czytelnik dostaje,
// gdy audio się nie wczyta.
//
// POZOSTAŁE SEKCJE przyszły z map `COPY = { pl, en }` wpisanych wprost
// w trzy komponenty odsłuchu. Żadna bramka ich nie widziała: to nie ternary po
// języku (którego szuka `check:i18n-hardcoded`) ani klucz (którego szuka
// `check:i18n-parity`), tylko obiekt - czyli tekst istniał wyłącznie w kodzie
// i nikt nie wiedział, że istnieje. Przy okazji wyszło, że SŁOWNIK ETAPÓW
// SYNTEZY stał w DWÓCH kopiach (dolny pasek i karta w sidebarze), a jedna
// z nich mogła się rozejść z drugą bez żadnego sygnału.
//
// JĘZYK: te komunikaty idą w języku ARTYKUŁU, nie interfejsu - audio jest
// w języku treści, więc etykieta przycisku odsłuchu musi się z nim zgadzać.
// Wywołania podają więc jawne `{ lng: lang }`.
import i18n from "./i18n";

const pl = {
  ttsPlayer: {
    stage: {
      preparing: "Przygotowuję tekst",
      synthesizing: "ElevenLabs syntezuje głos",
      streaming: "Pobieram audio",
      ready: "Gotowe",
      cached: "Z pamięci podręcznej",
    },
    listen: {
      listen: "Odsłuchaj artykuł",
      pause: "Pauza",
      resume: "Wznów",
      loading: "Generuję audio…",
      error: "Nie udało się wygenerować audio",
    },
    bar: {
      region: "Odtwarzacz audio",
      play: "Odtwórz",
      pause: "Pauza",
      loading: "Generuję audio…",
      download: "Pobierz MP3",
      downloading: "Pobieram audio…",
      downloadFailed: "Nie udało się pobrać audio",
      share: "Udostępnij link do artykułu",
      copied: "Skopiowano link do artykułu",
      close: "Zamknij odtwarzacz",
      seek: "Przewiń materiał",
      back15: "Cofnij 15 sekund",
      fwd15: "Do przodu 15 sekund",
      speed: "Tempo odtwarzania",
      error: "Nie udało się wygenerować audio",
    },
    card: {
      label: "Posłuchaj artykułu",
      play: "Odtwórz",
      pause: "Pauza",
      loading: "Generuję audio…",
      download: "Pobierz MP3",
      downloading: "Pobieram audio…",
      downloadFailed: "Nie udało się pobrać audio",
      retry: "Spróbuj ponownie",
      error: "Nie udało się wygenerować audio",
      aiNarration: "Narracja generowana automatycznie (AI) na podstawie treści artykułu.",
      seek: "Przewiń materiał",
      approx: "ok. {{min}} min",
    },
    errors: {
      noText: "Brak tekstu do odczytania",
      signInRequired: "Zaloguj się, aby odsłuchać wersję audio.",
      loadFailed: "Nie udało się wczytać wersji audio. Spróbuj ponownie.",
    },
  },
};

const en = {
  ttsPlayer: {
    stage: {
      preparing: "Preparing text",
      synthesizing: "ElevenLabs synthesizing voice",
      streaming: "Streaming audio",
      ready: "Ready",
      cached: "From cache",
    },
    listen: {
      listen: "Listen to article",
      pause: "Pause",
      resume: "Resume",
      loading: "Generating audio…",
      error: "Could not generate audio",
    },
    bar: {
      region: "Audio player",
      play: "Play",
      pause: "Pause",
      loading: "Generating audio…",
      download: "Download MP3",
      downloading: "Downloading audio…",
      downloadFailed: "Download failed",
      share: "Share article link",
      copied: "Article link copied",
      close: "Close player",
      seek: "Seek audio",
      back15: "Back 15 seconds",
      fwd15: "Forward 15 seconds",
      speed: "Playback speed",
      error: "Could not generate audio",
    },
    card: {
      label: "Listen to this article",
      play: "Play",
      pause: "Pause",
      loading: "Generating audio…",
      download: "Download MP3",
      downloading: "Downloading audio…",
      downloadFailed: "Download failed",
      retry: "Try again",
      error: "Could not generate audio",
      aiNarration: "Narration is generated automatically (AI) from the article text.",
      seek: "Seek audio",
      approx: "~{{min}} min",
    },
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
