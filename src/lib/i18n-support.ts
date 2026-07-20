// Supplementary i18n bundle for the donations / patronage page (PL/EN).
// Side-effect import this module wherever the feature mounts:
//   import "@/lib/i18n-support";
// The pl/en objects are exported so a parity test can verify both trees stay
// structurally identical (same rule as the core locale files).
import i18n from "./i18n";

export const supportPl = {
  support: {
    title: "Wesprzyj niezależną analizę",
    intro:
      "New European Strategies utrzymuje się z subskrypcji i mecenatu obywatelskiego. Darowizna finansuje pracę analityczną - tracker legislacyjny UE, raporty i debaty - i nie nadaje żadnych uprawnień: to wsparcie, nie zakup.",
    presetsLabel: "Wybierz kwotę",
    customLabel: "Inna kwota (zł)",
    customPlaceholder: "np. 75",
    messageLabel: "Wiadomość dla redakcji (opcjonalnie)",
    messagePlaceholder: "Co powinniśmy analizować częściej?",
    submit: "Przekaż darowiznę",
    submitting: "Przekierowujemy do płatności...",
    secureNote: "Płatność obsługuje Stripe. Nie przechowujemy danych karty.",
    amountError: "Kwota musi mieścić się między 5 zł a 50 000 zł.",
    rateLimited: "Zbyt wiele prób. Spróbuj ponownie za kilka minut.",
    genericError: "Nie udało się rozpocząć płatności. Spróbuj ponownie.",
    successTitle: "Dziękujemy za wsparcie!",
    successBody:
      "Twoja darowizna realnie finansuje niezależną analizę. Potwierdzenie płatności wysłał Stripe na podany adres e-mail.",
    cancelledTitle: "Płatność przerwana",
    cancelledBody: "Nic nie zostało pobrane. Możesz spróbować ponownie w dowolnym momencie.",
    backHome: "Wróć na stronę główną",
    another: "Przekaż kolejną darowiznę",
    whyTitle: "Na co idą środki",
    whyItems: [
      "Tracker legislacyjny UE - monitoring dossier i stanowisk państw",
      "Raporty i analizy dostępne bez paywalla tam, gdzie to możliwe",
      "Debaty, briefingi i sesje Q&A ze społecznością",
    ],
  },
};

export const supportEn = {
  support: {
    title: "Support independent analysis",
    intro:
      "New European Strategies is funded by subscriptions and citizen patronage. A donation funds analytical work - the EU legislative tracker, reports and debates - and grants no entitlements: it is support, not a purchase.",
    presetsLabel: "Choose an amount",
    customLabel: "Custom amount (PLN)",
    customPlaceholder: "e.g. 75",
    messageLabel: "Message to the editors (optional)",
    messagePlaceholder: "What should we analyse more often?",
    submit: "Donate",
    submitting: "Redirecting to payment...",
    secureNote: "Payments are processed by Stripe. We never store card details.",
    amountError: "The amount must be between 5 PLN and 50,000 PLN.",
    rateLimited: "Too many attempts. Please try again in a few minutes.",
    genericError: "Could not start the payment. Please try again.",
    successTitle: "Thank you for your support!",
    successBody:
      "Your donation directly funds independent analysis. Stripe has emailed a payment confirmation to the address you provided.",
    cancelledTitle: "Payment cancelled",
    cancelledBody: "Nothing was charged. You can try again at any time.",
    backHome: "Back to the homepage",
    another: "Make another donation",
    whyTitle: "Where the money goes",
    whyItems: [
      "The EU legislative tracker - monitoring files and member state positions",
      "Reports and analyses kept outside the paywall where possible",
      "Debates, briefings and community Q&A sessions",
    ],
  },
};

i18n.addResourceBundle("pl", "translation", supportPl, true, true);
i18n.addResourceBundle("en", "translation", supportEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - side-effectowy import w pliku trasy lądował
 * w eager-owym grafie wejściowym każdej strony. Rejestracja dzieje się przy
 * ewaluacji modułu (przed renderem komponentu), dokładnie jak wcześniej.
 */
export function ensureI18n(): void {}
