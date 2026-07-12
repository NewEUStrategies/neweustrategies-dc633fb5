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
  },
};

i18n.addResourceBundle("pl", "translation", pl, true, true);
i18n.addResourceBundle("en", "translation", en, true, true);
