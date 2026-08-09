// i18n bramki dostępu do klubu dyskusyjnego (PL/EN).
//
// Osobny moduł zamiast dopisywania do `i18n-club.ts`: bramka jest powierzchnią
// SPRZEDAŻOWĄ (upsell do PRO / rejestracja), a nie słownikiem modułu klubów -
// treść zmienia się w rytmie oferty, nie w rytmie funkcji.
//
// Import side-effectowy: `import "@/lib/i18n-club-gate";`
import i18n from "./i18n";

export const clubGatePl = {
  clubGate: {
    eyebrow: "Klub dostępny w planie {{plan}}",
    lockedTitle: "Ten klub jest częścią członkostwa {{plan}}",
    upgradeLead:
      "Twoje konto jest aktywne, ale ten klub otwiera się dopiero na planie {{plan}}. Podnieś plan i dołącz do rozmowy jeszcze dziś.",
    joinLead:
      "Nie jesteś jeszcze w tym klubie. Poproś o dostęp - prowadzący potwierdzi zgłoszenie.",
    anonLead:
      "Załóż konto i wybierz plan {{plan}}, aby czytać dyskusje, materiały i kalendarz tego klubu.",
    benefitsTitle: "Co dostajesz w planie {{plan}}",
    benefits: {
      threads: "Pełny dostęp do wątków i wpisów klubu",
      library: "Biblioteka materiałów, analiz i dokumentów roboczych",
      calendar: "Kalendarz spotkań i harmonogram prac klubu",
      network: "Kontakt z ekspertami i uczestnikami procesu",
      chatham: "Rozmowy w regule Chatham House - bez cytowania osób",
    },
    statsMembers: "{{count}} uczestników",
    statsThreads: "{{count}} wątków",
    upgradeCta: "Podnieś plan do {{plan}}",
    plansCta: "Porównaj plany",
    requestCta: "Poproś o dostęp",
    joinCta: "Dołącz do klubu",
    signupTitle: "Załóż konto w minutę",
    signupLead: "Po rejestracji wybierzesz plan {{plan}} i od razu wejdziesz do klubu.",
    firstName: "Imię",
    lastName: "Nazwisko",
    email: "Adres e-mail",
    password: "Hasło (min. 8 znaków)",
    signupSubmit: "Załóż konto i wybierz {{plan}}",
    signupBusy: "Zakładam konto...",
    haveAccount: "Masz już konto?",
    signIn: "Zaloguj się",
    sentTitle: "Sprawdź skrzynkę",
    sentBody:
      "Wysłaliśmy link potwierdzający na {{email}}. Po potwierdzeniu wrócisz tutaj i wybierzesz plan.",
    errors: {
      email: "Podaj poprawny adres e-mail.",
      password: "Hasło musi mieć co najmniej 8 znaków.",
      generic: "Nie udało się założyć konta. Spróbuj ponownie.",
      rate: "Zbyt wiele prób - spróbuj ponownie za kilka minut.",
    },
    secure: "Bez zobowiązań - plan zmienisz lub anulujesz w profilu.",
  },
} as const;

export const clubGateEn = {
  clubGate: {
    eyebrow: "Club included in the {{plan}} plan",
    lockedTitle: "This club is part of {{plan}} membership",
    upgradeLead:
      "Your account is active, but this club opens on the {{plan}} plan. Upgrade and join the conversation today.",
    joinLead: "You are not in this club yet. Request access - the host will confirm it.",
    anonLead:
      "Create an account and pick the {{plan}} plan to read this club's discussions, materials and calendar.",
    benefitsTitle: "What {{plan}} gives you",
    benefits: {
      threads: "Full access to club threads and posts",
      library: "Library of materials, analyses and working documents",
      calendar: "Meeting calendar and the club's work schedule",
      network: "Direct contact with experts and process participants",
      chatham: "Chatham House rule conversations - no attribution",
    },
    statsMembers: "{{count}} participants",
    statsThreads: "{{count}} threads",
    upgradeCta: "Upgrade to {{plan}}",
    plansCta: "Compare plans",
    requestCta: "Request access",
    joinCta: "Join the club",
    signupTitle: "Create your account in a minute",
    signupLead: "After signing up you pick the {{plan}} plan and enter the club right away.",
    firstName: "First name",
    lastName: "Last name",
    email: "Email address",
    password: "Password (min. 8 characters)",
    signupSubmit: "Create account and pick {{plan}}",
    signupBusy: "Creating account...",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
    sentTitle: "Check your inbox",
    sentBody:
      "We sent a confirmation link to {{email}}. Once confirmed you come back here and choose a plan.",
    errors: {
      email: "Enter a valid email address.",
      password: "Password must be at least 8 characters.",
      generic: "We could not create the account. Please try again.",
      rate: "Too many attempts - please try again in a few minutes.",
    },
    secure: "No commitment - change or cancel the plan in your profile.",
  },
} as const;

i18n.addResourceBundle("pl", "translation", clubGatePl, true, true);
i18n.addResourceBundle("en", "translation", clubGateEn, true, true);
