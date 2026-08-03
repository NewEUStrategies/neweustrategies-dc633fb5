// Nakładka i18n kanonicznego lektora AI (TTS) - PL/EN.
//
// Ciągi żyją TUTAJ, a nie w `locale/{pl,en}.ts`, świadomie: rdzenne słowniki są
// pobierane przez KAŻDEGO czytelnika (chunki `pl.js` / `en.js` liczą się do
// budżetu publicznego), a te klucze widzi wyłącznie redakcja - panel Ustawienia
// -> Czytanie i sekcja Audio edytora wpisu. Ten sam wzorzec co
// `i18n-admin-semantic` (bramka bundla klasyfikuje oba chunki jako admin-only).
//
// Ładowane efektem ubocznym importu przez powierzchnie, które tych kluczy
// używają: trasę admin.settings.reading, atom TtsVoiceSelect i molekułę
// TtsVoiceCard.
import i18n from "./i18n";

const pl = {
  admin: {
    reading: {
      ttsTitle: "Lektor AI (audio artykułu)",
      ttsHint:
        "Głos i model są kanoniczne: czytelnik ich nie wybiera, a na wpis i język powstaje dokładnie jedno nagranie w prywatnym cache. Zmiana poniżej dotyczy wpisów bez własnego głosu i wywołuje jedną ponowną syntezę przy następnym odsłuchaniu.",
      ttsVoicePl: "Głos - wersja polska",
      ttsVoicePlHint: "Domyślny lektor polskich artykułów tego najemcy.",
      ttsVoiceEn: "Głos - wersja angielska",
      ttsVoiceEnHint: "Domyślny lektor angielskich artykułów tego najemcy.",
      ttsModel: "Model syntezy",
      ttsModelHint:
        "Wymiar kosztowy - jeden model dla całego najemcy ({{tier}}). Nie ma nadpisania per wpis, żeby jeden artykuł nie mnożył wariantów cenowych.",
      ttsModelTier: {
        quality: "Jakość referencyjna (multilingual v2)",
        turbo: "Szybki i tańszy (turbo v2.5)",
      },
      ttsTimbre: {
        warmBaritone: "ciepły baryton",
        softAlto: "miękki alt",
        newsAnchor: "prezenterski, wyrazisty",
        brightYouthful: "jasny, młodzieńczy",
        energeticUpbeat: "energiczny, dynamiczny",
        calmFriendly: "spokojny, przyjazny",
      },
    },
  },
};

const en = {
  admin: {
    reading: {
      ttsTitle: "AI narrator (article audio)",
      ttsHint:
        "The voice and model are canonical: readers never pick them, and every (post, language) pair gets exactly one cached recording. Changing them below affects posts without their own voice and triggers a single re-synthesis on the next listen.",
      ttsVoicePl: "Voice - Polish edition",
      ttsVoicePlHint: "Default narrator for this tenant's Polish articles.",
      ttsVoiceEn: "Voice - English edition",
      ttsVoiceEnHint: "Default narrator for this tenant's English articles.",
      ttsModel: "Synthesis model",
      ttsModelHint:
        "A cost dimension - one model per tenant ({{tier}}). There is no per-post override, so a single article can never multiply price variants.",
      ttsModelTier: {
        quality: "Reference quality (multilingual v2)",
        turbo: "Fast and cheaper (turbo v2.5)",
      },
      ttsTimbre: {
        warmBaritone: "warm baritone",
        softAlto: "soft alto",
        newsAnchor: "news anchor, crisp",
        brightYouthful: "bright, youthful",
        energeticUpbeat: "energetic, upbeat",
        calmFriendly: "calm, friendly",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
