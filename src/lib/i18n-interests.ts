import i18n from "./i18n";

// Overlay bundle for "Customize Interests" and "Join us" widgets/pages.
// Keeps the base i18n.ts untouched - registered via addResourceBundle.

const pl = {
  interests: {
    title: "Dopasuj swoje zainteresowania",
    subtitle:
      "Wybierz tematy i tagi, które Cię interesują. Rekomendacje, newslettery i kolejność wpisów zostaną dopasowane do Twoich preferencji.",
    sectionCategories: "Kategorie",
    sectionTags: "Tagi",
    empty: "Brak dostępnych pozycji.",
    selectedCount: "Wybrano: {{count}}",
    save: "Zapisz preferencje",
    saved: "Zapisano",
    saveError: "Nie udało się zapisać preferencji.",
    loading: "Wczytywanie...",
    loginRequired: "Aby zapisać zainteresowania, zaloguj się.",
    loginCta: "Zaloguj się",
    skip: "Pomiń",
    yourInterests: "Twoje zainteresowania",
    edit: "Edytuj",
    none: "Nie wybrałeś jeszcze żadnych tematów.",
    suggestedHeading: "Polecane na podstawie zainteresowań",
    refreshing: "Aktualizuję rekomendacje...",
    customize: "Dostosuj zainteresowania",
  },
  joinUs: {
    title: "Dołącz do nas",
    subtitle:
      "Otrzymuj najważniejsze analizy, briefy i zaproszenia na wydarzenia bezpośrednio na swoją skrzynkę.",
    name: "Imię",
    email: "Twój e-mail",
    interestsLabel: "Tematy, które Cię interesują (opcjonalnie)",
    submit: "Dołącz",
    submitting: "Wysyłam...",
    success: "Dziękujemy! Sprawdź skrzynkę i potwierdź zapis.",
    errorEmail: "Niepoprawny adres e-mail.",
    errorGeneric: "Coś poszło nie tak. Spróbuj ponownie.",
    duplicate: "Ten adres jest już zapisany.",
    consent:
      "Zapisując się akceptujesz politykę prywatności. W każdej chwili możesz się wypisać.",
    perksTitle: "Co zyskujesz",
    perk1: "Cotygodniowy briefing redakcyjny",
    perk2: "Wcześniejszy dostęp do raportów",
    perk3: "Spersonalizowane rekomendacje wpisów",
  },
};

const en: typeof pl = {
  interests: {
    title: "Customize your interests",
    subtitle:
      "Pick the topics and tags you care about. Recommendations, newsletters and post ordering will adapt to your preferences.",
    sectionCategories: "Categories",
    sectionTags: "Tags",
    empty: "Nothing to choose from yet.",
    selectedCount: "Selected: {{count}}",
    save: "Save preferences",
    saved: "Saved",
    saveError: "Could not save preferences.",
    loading: "Loading...",
    loginRequired: "Sign in to save your interests.",
    loginCta: "Sign in",
    skip: "Skip",
    yourInterests: "Your interests",
    edit: "Edit",
    none: "You haven't picked any topics yet.",
    suggestedHeading: "Recommended for your interests",
    refreshing: "Refreshing recommendations...",
    customize: "Customize interests",
  },
  joinUs: {
    title: "Join us",
    subtitle:
      "Get the most important analyses, briefings and event invitations straight to your inbox.",
    name: "Name",
    email: "Your email",
    interestsLabel: "Topics you're interested in (optional)",
    submit: "Join",
    submitting: "Sending...",
    success: "Thanks! Check your inbox to confirm your subscription.",
    errorEmail: "Invalid email address.",
    errorGeneric: "Something went wrong. Please try again.",
    duplicate: "This email is already subscribed.",
    consent:
      "By subscribing you accept the privacy policy. You can unsubscribe at any time.",
    perksTitle: "What you get",
    perk1: "Weekly editorial briefing",
    perk2: "Early access to reports",
    perk3: "Personalized post recommendations",
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);

export {};
