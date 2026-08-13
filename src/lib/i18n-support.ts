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
    // Wariant „nasza kasa" - domyślny tryb modułu darowizn.
    ctaLead: "Wpłać bezpośrednio na naszej stronie - wybierz kwotę jednorazową lub miesięczną.",
    cta: "Przejdź do wpłaty",
    ctaNote:
      "Płatność obsługuje operator kartowy - nie przechowujemy danych karty. Darowizna nie nadaje uprawnień w serwisie.",
    // Wariant awaryjny - zbiórka w serwisie zewnętrznym.
    externalLead:
      "Zbiórkę prowadzimy w serwisie zewnętrznym - wybierz tam kwotę i metodę płatności.",
    externalCta: "Przejdź do zbiórki",
    externalNote:
      "Link otwiera zbiórkę w nowej karcie. Wpłaty obsługuje operator zbiórki - nie przechowujemy danych płatniczych.",
    closed: "Zbiórka jest chwilowo wyłączona. Zajrzyj do nas ponownie wkrótce.",
    whyTitle: "Na co idą środki",
    // Punkty jako nazwane liście, nie tablica pod `returnObjects`: bramka
    // rozjazdu kod <-> słownik uznaje za wpis wyłącznie liść tekstowy, więc
    // tablica pod kluczem uchodziła za klucz nieistniejący w obu językach
    // (ten sam wzorzec co nagłówki CSV w GscBiDashboard).
    whyItems: {
      policy: "Analizy polityki europejskiej i procesów decyzyjnych UE",
      openAccess: "Raporty i analizy dostępne bez paywalla tam, gdzie to możliwe",
      community: "Debaty, briefingi i sesje Q&A ze społecznością",
    },
  },
};

export const supportEn = {
  support: {
    title: "Support independent analysis",
    intro:
      "New European Strategies is funded by subscriptions and citizen patronage. A donation funds analytical work - European policy analysis, reports, interviews and public debates - and grants no entitlements: it is support, not a purchase.",
    backToPricing: "Back to pricing",
    // "Our own checkout" variant - the module's default mode.
    ctaLead: "Give directly on our site - choose a one-off or a monthly amount.",
    cta: "Continue to your gift",
    ctaNote:
      "Payments are processed by our card provider - we never store card data. A donation grants no entitlements on the site.",
    // Fallback variant - fundraiser hosted by an external service.
    externalLead:
      "Our fundraiser runs on an external service - choose the amount and payment method there.",
    externalCta: "Go to the fundraiser",
    externalNote:
      "The link opens the fundraiser in a new tab. Payments are handled by the fundraiser platform - we never store payment details.",
    closed: "Donations are temporarily closed. Please check back soon.",
    whyTitle: "Where the money goes",
    whyItems: {
      policy: "Analysis of European policy and EU decision-making processes",
      openAccess: "Reports and analyses kept outside the paywall where possible",
      community: "Debates, briefings and community Q&A sessions",
    },
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
