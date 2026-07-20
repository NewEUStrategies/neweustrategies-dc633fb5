import i18n from "./i18n";

// Overlay dla pulpitu wyników quizu osobowości (Big Five).
// Klucze quizu (skala, osie, lowHigh) żyją w i18n-profile-extras2 - tutaj
// wyłącznie pulpit, interpretacje przedziałów i historia podejść.

const pl = {
  personality: {
    dashboardTitle: "Twój profil osobowości",
    dashboardSubtitle:
      "Wyniki modelu Wielkiej Piątki (Big Five). Wartości 0-100 opisują natężenie cechy - nie ma wyników dobrych ani złych.",
    lastTaken: "Ostatnie podejście: {{date}}",
    retakeCta: "Wypełnij ponownie",
    backToDashboard: "Wróć do wyników",
    historyTitle: "Historia podejść",
    historyEmpty: "To Twoje pierwsze podejście - historia pojawi się po kolejnych.",
    draftRestored: "Przywrócono zapisane odpowiedzi z poprzedniej sesji.",
    bands: {
      low: "Wynik niski",
      medium: "Wynik umiarkowany",
      high: "Wynik wysoki",
    },
    interpretations: {
      openness: {
        low: "Preferujesz sprawdzone rozwiązania i konkret. Praktyczność cenisz wyżej niż eksperymenty.",
        medium: "Łączysz otwartość na nowe idee z szacunkiem dla sprawdzonych metod.",
        high: "Ciekawość świata, wyobraźnia i chęć eksperymentowania to Twoje naturalne środowisko.",
      },
      conscientiousness: {
        low: "Działasz spontanicznie i elastycznie; struktury i plany bywają dla Ciebie ograniczeniem.",
        medium: "Potrafisz pracować systematycznie, zachowując przestrzeń na improwizację.",
        high: "Organizacja, wytrwałość i dowożenie zobowiązań to Twoja mocna strona.",
      },
      extraversion: {
        low: "Energię czerpiesz z pracy w skupieniu i mniejszych, głębszych relacji.",
        medium: "Swobodnie balansujesz między pracą zespołową a samodzielną.",
        high: "Kontakt z ludźmi Cię napędza - naturalnie zabierasz głos i budujesz relacje.",
      },
      agreeableness: {
        low: "Bezpośredniość i asertywność stawiasz ponad dyplomację; łatwo bronisz swojego zdania.",
        medium: "Współpracujesz chętnie, ale potrafisz postawić granice, gdy trzeba.",
        high: "Empatia i nastawienie na współpracę sprawiają, że ludzie dobrze czują się w Twoim towarzystwie.",
      },
      neuroticism: {
        low: "Zachowujesz spokój pod presją; stres rzadko wytrąca Cię z równowagi.",
        medium: "Reagujesz emocjonalnie w miarę sytuacji - zwykle szybko wracasz do równowagi.",
        high: "Silniej odczuwasz stres i emocje - zadbaj o regenerację i przewidywalne otoczenie.",
      },
    },
  },
};

const en: typeof pl = {
  personality: {
    dashboardTitle: "Your personality profile",
    dashboardSubtitle:
      "Big Five model results. Values 0-100 describe trait intensity - there are no good or bad scores.",
    lastTaken: "Last taken: {{date}}",
    retakeCta: "Retake the quiz",
    backToDashboard: "Back to results",
    historyTitle: "Attempt history",
    historyEmpty: "This is your first attempt - history will appear after the next ones.",
    draftRestored: "Restored answers saved from a previous session.",
    bands: {
      low: "Low score",
      medium: "Moderate score",
      high: "High score",
    },
    interpretations: {
      openness: {
        low: "You prefer proven solutions and concrete facts, valuing practicality over experiments.",
        medium: "You combine openness to new ideas with respect for proven methods.",
        high: "Curiosity, imagination and a taste for experimenting are your natural habitat.",
      },
      conscientiousness: {
        low: "You act spontaneously and flexibly; rigid plans can feel constraining.",
        medium: "You can work systematically while keeping room for improvisation.",
        high: "Organization, persistence and delivering on commitments are your strengths.",
      },
      extraversion: {
        low: "You recharge through focused work and smaller, deeper relationships.",
        medium: "You balance teamwork and independent work with ease.",
        high: "Being around people energizes you - you naturally speak up and build relationships.",
      },
      agreeableness: {
        low: "You value directness and assertiveness over diplomacy and defend your views easily.",
        medium: "You cooperate willingly but can set boundaries when needed.",
        high: "Empathy and a cooperative mindset make people feel at ease around you.",
      },
      neuroticism: {
        low: "You stay calm under pressure; stress rarely throws you off balance.",
        medium: "You respond emotionally in proportion to the situation and recover quickly.",
        high: "You feel stress and emotions more intensely - prioritize recovery and a predictable environment.",
      },
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
