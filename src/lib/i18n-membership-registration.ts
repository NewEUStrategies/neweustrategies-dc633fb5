// Słownik treści strony /membership-registration ("Załóż konto") - PL/EN.
//
// Formularz rejestracji renderuje wspólny `AuthPortal` (ten sam co /login);
// ten słownik niesie wyłącznie sekcję treści POD formularzem: czym jest
// serwis, co daje konto i dokąd prowadzą kolejne kroki. Obietnice są tymi
// samymi, które serwis składa już na /membership-join (konto bezpłatne bez
// karty, analizy otwarte, zapisy na wydarzenia, zakres planów płatnych) -
// strona rejestracji nie może obiecywać więcej niż strona członkostwa.
//
// Rejestracja przy ewaluacji modułu; `ensureI18n()` trzyma bundle w chunku
// trasy (ten sam wzorzec, co i18n-membership-join / i18n-careers).
import i18n from "@/lib/i18n";

const registrationPl = {
  membershipRegistration: {
    eyebrow: "Konto czytelnika",
    title: "Konto w New European Strategies",
    lead: "New European Strategies to niezależny think tank o bezpieczeństwie Europy i geopolityce. Konto bezpłatne zakładasz w minutę, bez karty płatniczej - od razu czytasz analizy otwarte i zapisujesz się na wydarzenia.",
    benefitsTitle: "Co zyskujesz po rejestracji",
    benefits: {
      analyses: {
        title: "Analizy i policy papers",
        body: "Analizy, raporty i wywiady o bezpieczeństwie, gospodarce i dyplomacji - z jasną tezą, danymi i rekomendacją.",
        analyses: "Przejdź do analiz",
      },
      events: {
        title: "Konferencje i spotkania",
        body: "Zapisy na konferencje, debaty i spotkania w formule Chatham House w jednym miejscu.",
        events: "Wydarzenia",
        conferences: "Konferencje",
        meetings: "Spotkania Chatham House",
      },
      newsletter: {
        title: "Newsletter",
        body: "Najważniejsze analizy i zaproszenia na wydarzenia prosto na Twoją skrzynkę.",
        newsletter: "Zapisz się do newslettera",
      },
      membership: {
        title: "Członkostwo i plany",
        body: "Rozszerz dostęp o kluby dyskusyjne, materiały premium i spotkania zamknięte. Plan zmienisz albo anulujesz w profilu.",
        join: "Poznaj członkostwo",
        pricing: "Zobacz cennik",
      },
    },
    signin: {
      prompt: "Masz już konto?",
      link: "Zaloguj się",
    },
    about: {
      prompt: "Chcesz wiedzieć więcej o think tanku?",
      about: "O nas",
      contact: "Kontakt",
    },
    legal: {
      title: "Dokumenty",
      terms: "Regulamin",
      privacy: "Polityka prywatności",
      subscriptions: "Subskrypcje i zakupy",
      gdpr: "RODO - Twoje prawa",
    },
  },
};

const registrationEn = {
  membershipRegistration: {
    eyebrow: "Reader account",
    title: "Your New European Strategies account",
    lead: "New European Strategies is an independent think tank on European security and geopolitics. A free account takes a minute and needs no payment card - you can read open analyses and register for events straight away.",
    benefitsTitle: "What you get after signing up",
    benefits: {
      analyses: {
        title: "Analyses and policy papers",
        body: "Analyses, reports and interviews on security, economy and diplomacy - a clear thesis, the data behind it and a recommendation.",
        analyses: "Go to analyses",
      },
      events: {
        title: "Conferences and meetings",
        body: "Register for conferences, debates and Chatham House-rule meetings in one place.",
        events: "Events",
        conferences: "Conferences",
        meetings: "Chatham House meetings",
      },
      newsletter: {
        title: "Our newsletter",
        body: "Key analyses and event invitations delivered to your inbox.",
        newsletter: "Subscribe to the newsletter",
      },
      membership: {
        title: "Membership and plans",
        body: "Extend access to discussion clubs, premium material and closed sessions. Change or cancel your plan any time in your profile.",
        join: "Explore membership",
        pricing: "See pricing",
      },
    },
    signin: {
      prompt: "Already have an account?",
      link: "Sign in",
    },
    about: {
      prompt: "Want to know more about the think tank?",
      about: "About us",
      contact: "Contact",
    },
    legal: {
      title: "Documents",
      terms: "Terms & conditions",
      privacy: "Privacy notice",
      subscriptions: "Subscriptions and purchases",
      gdpr: "GDPR - your rights",
    },
  },
};

/** No-op utrzymujący rejestrację słownika w chunku trasy. */
// Explicit registration must survive both Vite and Nitro tree shaking.
let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", registrationPl, true, true);
  i18n.addResourceBundle("en", "translation", registrationEn, true, true);
}
ensureI18n();

/** Kształt słownika - wykorzystywany przez test parzystości PL/EN. */
export const membershipRegistrationResources = { pl: registrationPl, en: registrationEn };
