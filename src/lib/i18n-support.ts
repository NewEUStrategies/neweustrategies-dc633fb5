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
      "New European Strategies utrzymuje się z subskrypcji i mecenatu obywatelskiego. Darowizna finansuje pracę analityczną - analizy polityki europejskiej, raporty, wywiady i debaty publiczne - i nie nadaje żadnych uprawnień: to wsparcie, nie zakup.",
    backToPricing: "Wróć do cennika",
    ctaLead: "Zbiórkę prowadzimy w serwisie zrzutka.pl - wybierz tam kwotę i metodę płatności.",
    cta: "Przekaż darowiznę przez zrzutka.pl",
    ctaNote:
      "Link otwiera zbiórkę w nowej karcie. Wpłaty obsługuje zrzutka.pl - nie przechowujemy danych płatniczych.",
    whyTitle: "Na co idą środki",
    whyItems: [
      "Analizy polityki europejskiej i procesów decyzyjnych UE",
      "Raporty i analizy dostępne bez paywalla tam, gdzie to możliwe",
      "Debaty, briefingi i sesje Q&A ze społecznością",
    ],
  },
};

export const supportEn = {
  support: {
    title: "Support independent analysis",
    intro:
      "New European Strategies is funded by subscriptions and citizen patronage. A donation funds analytical work - European policy analysis, reports, interviews and public debates - and grants no entitlements: it is support, not a purchase.",
    backToPricing: "Back to pricing",
    ctaLead: "Our fundraiser runs on zrzutka.pl - choose the amount and payment method there.",
    cta: "Donate via zrzutka.pl",
    ctaNote:
      "The link opens the fundraiser in a new tab. Payments are handled by zrzutka.pl - we never store payment details.",
    whyTitle: "Where the money goes",
    whyItems: [
      "Analysis of European policy and EU decision-making processes",
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
