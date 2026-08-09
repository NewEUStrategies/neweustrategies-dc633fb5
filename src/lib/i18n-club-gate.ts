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
    benefitsLead: "Członkostwo to nie sam dostęp do treści - to udział w pracy klubu.",
    benefits: {
      threads: {
        title: "Pełne wątki i stanowiska",
        desc: "Czytasz i zabierasz głos w dyskusjach, pytaniach i głosowaniach klubu.",
      },
      library: {
        title: "Biblioteka pracy klubu",
        desc: "Analizy, dokumenty robocze i źródła zebrane przy każdym wątku.",
      },
      calendar: {
        title: "Kalendarz i harmonogram",
        desc: "Spotkania, terminy konsultacji i kolejne etapy prac w jednym miejscu.",
      },
      network: {
        title: "Dostęp do ekspertów",
        desc: "Bezpośredni kontakt z autorami analiz i uczestnikami procesu legislacyjnego.",
      },
      chatham: {
        title: "Reguła Chatham House",
        desc: "Rozmowa bez cytowania osób - dlatego mówi się tu wprost.",
      },
      briefs: {
        title: "Podsumowania i wnioski",
        desc: "Kluczowe wnioski z każdego wątku, gotowe do wykorzystania w Twojej pracy.",
      },
    },
    statsMembers: "{{count}} uczestników",
    statsThreads: "{{count}} wątków",
    upgradeCta: "Podnieś plan do {{plan}}",
    plansCta: "Porównaj plany",
    requestCta: "Poproś o dostęp",
    upgradeOnlyNote:
      "Dostęp do tego klubu daje wyłącznie plan {{plan}} - zgłoszenia bez planu nie są rozpatrywane.",
    expertLead:
      "Jako ekspert możesz poprosić o dostęp do tego klubu bez zmiany planu - prowadzący potwierdzi zgłoszenie.",
    expertBadge: "Ścieżka eksperta",
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
    benefitsLead: "Membership is not just access to content - it is a seat in the club's work.",
    benefits: {
      threads: {
        title: "Full threads and positions",
        desc: "Read and speak up in the club's discussions, questions and votes.",
      },
      library: {
        title: "The club's working library",
        desc: "Analyses, working documents and sources attached to every thread.",
      },
      calendar: {
        title: "Calendar and schedule",
        desc: "Meetings, consultation deadlines and the next stages of work in one place.",
      },
      network: {
        title: "Access to experts",
        desc: "Direct contact with the authors of analyses and participants of the process.",
      },
      chatham: {
        title: "Chatham House rule",
        desc: "No attribution - which is exactly why people speak plainly here.",
      },
      briefs: {
        title: "Briefs and takeaways",
        desc: "Key conclusions from every thread, ready to use in your own work.",
      },
    },
    statsMembers: "{{count}} participants",
    statsThreads: "{{count}} threads",
    upgradeCta: "Upgrade to {{plan}}",
    plansCta: "Compare plans",
    requestCta: "Request access",
    upgradeOnlyNote:
      "Access to this club comes with the {{plan}} plan only - requests without a plan are not reviewed.",
    expertLead:
      "As an expert you can request access to this club without changing your plan - the host will confirm it.",
    expertBadge: "Expert path",
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
