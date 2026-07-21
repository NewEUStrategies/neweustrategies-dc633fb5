// Paywall i18n bundle (PL/EN). Loaded once on import by the Paywall component.
// Terminology deliberately mirrors the pricing/checkout namespace (i18n-profile)
// so the in-article paywall and /pricing read as ONE funnel - previously the
// paywall carried its own hardcoded dictionary that drifted from pricing copy.
// Kept as a separate small bundle (not i18n-profile) so the article route does
// not pay for the full profile dictionary.
import i18n from "./i18n";

const pl = {
  paywall: {
    membersOnly: "Treść tylko dla zalogowanych",
    membersDesc: "Zaloguj się lub załóż darmowe konto, aby kontynuować czytanie.",
    paidOnly: "Treść premium",
    paidDesc: "Wykup dostęp jednorazowy lub subskrypcję, aby przeczytać cały materiał.",
    passwordOnly: "Treść zabezpieczona hasłem",
    passwordDesc: "Wpisz hasło otrzymane od autora, aby odblokować pełny materiał.",
    passwordPlaceholder: "Wprowadź hasło",
    passwordSubmit: "Odblokuj",
    passwordChecking: "Sprawdzanie...",
    passwordWrong: "Nieprawidłowe hasło.",
    passwordAttemptsLeft: "Pozostało prób: {{count}}",
    passwordLocked: "Zbyt wiele prób. Spróbuj ponownie za {{seconds}} s.",
    passwordHintLabel: "Podpowiedź:",
    signin: "Zaloguj się",
    signup: "Załóż konto",
    buy: "Kup dostęp",
    subscribe: "Subskrybuj",
    perMonth: "/ mies.",
    perYear: "/ rok",
    oneTime: "jednorazowo",
    processing: "Przekierowanie do płatności...",
    secureNote: "Bezpieczna płatność. Dostęp odblokuje się automatycznie po opłaceniu.",
    checkoutFail: "Nie udało się rozpocząć płatności - spróbuj ponownie.",
    seeAllPlans: "Zobacz wszystkie plany",
    trialBadge: "{{days}} dni za darmo",
    meter: {
      counter: "Darmowy artykuł {{used}} z {{limit}} w tym miesiącu",
      remaining_one: "Pozostał Ci jeszcze {{count}} darmowy artykuł.",
      remaining_few: "Pozostały Ci jeszcze {{count}} darmowe artykuły.",
      remaining_many: "Pozostało Ci jeszcze {{count}} darmowych artykułów.",
      remaining_other: "Pozostało Ci jeszcze {{count}} darmowego artykułu.",
      lastOne: "To Twój ostatni darmowy artykuł w tym miesiącu.",
      createAccount: "Załóż konto",
      seePlans: "Zobacz plany",
      registerTitle: "Czytaj dalej za darmo",
      registerDesc_one:
        "Załóż bezpłatne konto i czytaj {{count}} artykuł premium miesięcznie bez opłat.",
      registerDesc_few:
        "Załóż bezpłatne konto i czytaj {{count}} artykuły premium miesięcznie bez opłat.",
      registerDesc_many:
        "Załóż bezpłatne konto i czytaj {{count}} artykułów premium miesięcznie bez opłat.",
      registerDesc_other:
        "Załóż bezpłatne konto i czytaj {{count}} artykułu premium miesięcznie bez opłat.",
      registerNote: "Rejestracja jest darmowa i zajmuje mniej niż minutę.",
      exhaustedTitle: "Wykorzystano darmowy limit",
      exhaustedDesc:
        "Przeczytano {{used}} z {{limit}} darmowych artykułów w tym miesiącu. Wybierz plan, aby czytać bez ograniczeń - limit odnowi się z początkiem kolejnego miesiąca.",
    },
  },
};

const en: typeof pl = {
  paywall: {
    membersOnly: "Members-only content",
    membersDesc: "Sign in or create a free account to continue reading.",
    paidOnly: "Premium content",
    paidDesc: "Purchase one-time access or subscribe to read the full piece.",
    passwordOnly: "Password-protected content",
    passwordDesc: "Enter the password provided by the author to unlock the full piece.",
    passwordPlaceholder: "Enter password",
    passwordSubmit: "Unlock",
    passwordChecking: "Checking...",
    passwordWrong: "Wrong password.",
    passwordAttemptsLeft: "Attempts left: {{count}}",
    passwordLocked: "Too many attempts. Try again in {{seconds}}s.",
    passwordHintLabel: "Hint:",
    signin: "Sign in",
    signup: "Create account",
    buy: "Buy access",
    subscribe: "Subscribe",
    perMonth: "/ mo",
    perYear: "/ yr",
    oneTime: "one-time",
    processing: "Redirecting to payment...",
    secureNote: "Secure payment. Access unlocks automatically once paid.",
    checkoutFail: "Could not start checkout - please try again.",
    seeAllPlans: "See all plans",
    trialBadge: "{{days}} days free",
    meter: {
      counter: "Free article {{used}} of {{limit}} this month",
      remaining_one: "You have {{count}} free article left.",
      remaining_few: "You have {{count}} free articles left.",
      remaining_many: "You have {{count}} free articles left.",
      remaining_other: "You have {{count}} free articles left.",
      lastOne: "This is your last free article this month.",
      createAccount: "Create account",
      seePlans: "See plans",
      registerTitle: "Keep reading for free",
      registerDesc_one:
        "Create a free account and read {{count}} premium article a month at no cost.",
      registerDesc_few:
        "Create a free account and read {{count}} premium articles a month at no cost.",
      registerDesc_many:
        "Create a free account and read {{count}} premium articles a month at no cost.",
      registerDesc_other:
        "Create a free account and read {{count}} premium articles a month at no cost.",
      registerNote: "Signing up is free and takes less than a minute.",
      exhaustedTitle: "Free limit reached",
      exhaustedDesc:
        "You have read {{used}} of {{limit}} free articles this month. Choose a plan to read without limits - the counter resets at the start of next month.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
