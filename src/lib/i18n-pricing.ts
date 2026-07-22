// Zasoby i18n Cennika 2.0 (strona /pricing): segmenty odbiorców, karty warstw
// (framing cen, oszczędności), przepustki, cross-sell, pas kontaktowy i dialog
// "Porozmawiajmy". Uzupełnia bazowe klucze pricing.* z i18n-profile (tytuł,
// zaufanie, interwały) - addResourceBundle scala oba moduły w jedno drzewo.
import i18n from "@/lib/i18n";

const pricingPl = {
  pricing: {
    segmentsAria: "Wybierz typ oferty",
    intervalAria: "Cykl rozliczenia",
    saveUpTo: "do -{{pct}}%",
    savePct: "-{{pct}}%",
    billedYearly: "Rozliczane rocznie: {{amount}}",
    free: "Bezpłatnie",
    freeNote: "Bez karty płatniczej - na zawsze",
    onRequest: "Oferta na zapytanie",
    onRequestNote: "Zakres i wycenę dopasujemy do organizacji",
    currentTier: "Twój obecny poziom",
    signupCta: "Załóż bezpłatne konto",
    contactCta: "Porozmawiajmy",
    compareAll: "Porównaj wszystkie funkcje",
    passesTitle: "Przepustki i dostęp jednorazowy",
    passesSubtitle: "Bez zobowiązań: pojedynczy artykuł albo krótki dostęp na czas ważnej decyzji.",
    morePlansTitle: "Pozostałe plany",
    tiers: {
      heading: "Poziomy członkostwa",
      current: "Twoja subskrypcja",
      supporterCta: "Wesprzyj fundację",
    },
    supporterStrip: {
      body: "Jednorazowa lub cykliczna darowizna wspiera niezależne analizy - bez formalności.",
    },
    crossSell: {
      toBusiness:
        "Potrzebujesz licencji dla całej organizacji, zamkniętych briefingów albo partnerstwa strategicznego?",
      toBusinessCta: "Zobacz ofertę dla firm",
      toTeam: "Mniejszy zespół? Wspólny dostęp z panelem miejsc uruchomisz samoobsługowo.",
      toTeamCta: "Zobacz plan dla zespołów",
    },
    contactBand: {
      title: "Nie wiesz, który plan wybrać?",
      body: "Napisz do nas - podpowiemy najlepszy wariant dla Ciebie, Twojego zespołu albo organizacji.",
      cta: "Porozmawiajmy",
    },
    contactDialog: {
      title: "Porozmawiajmy o ofercie",
      subject: "Zapytanie o ofertę: {{tier}}",
      subjectGeneric: "Zapytanie o ofertę",
      name: "Imię i nazwisko",
      email: "E-mail",
      company: "Organizacja (opcjonalnie)",
      message: "Wiadomość",
      messagePlaceholder: "Napisz, czego potrzebuje Twój zespół - wielkość, terminy, zakres.",
      consent: "Wyrażam zgodę na przetwarzanie moich danych w celu obsługi tego zapytania.",
      cancel: "Anuluj",
      submit: "Wyślij",
      success: "Dziękujemy! Odezwiemy się szybko.",
      error: "Nie udało się wysłać. Spróbuj ponownie.",
    },
  },
};

const pricingEn: typeof pricingPl = {
  pricing: {
    segmentsAria: "Choose your offer type",
    intervalAria: "Billing cycle",
    saveUpTo: "up to -{{pct}}%",
    savePct: "-{{pct}}%",
    billedYearly: "Billed annually: {{amount}}",
    free: "Free",
    freeNote: "No card required - free forever",
    onRequest: "Pricing on request",
    onRequestNote: "Scope and pricing tailored to your organisation",
    currentTier: "Your current level",
    signupCta: "Create a free account",
    contactCta: "Talk to us",
    compareAll: "Compare all features",
    passesTitle: "Passes & one-time access",
    passesSubtitle: "No commitment: a single article or short access when a decision matters.",
    morePlansTitle: "More plans",
    tiers: {
      heading: "Membership tiers",
      current: "Your subscription",
      supporterCta: "Support the foundation",
    },
    supporterStrip: {
      body: "A one-off or recurring donation supports independent analysis - no strings attached.",
    },
    crossSell: {
      toBusiness:
        "Need an organisation-wide licence, closed-door briefings or a strategic partnership?",
      toBusinessCta: "See the business offer",
      toTeam: "Smaller team? Set up shared access with a seat panel in minutes.",
      toTeamCta: "See the team plan",
    },
    contactBand: {
      title: "Not sure which plan fits?",
      body: "Write to us - we will suggest the best option for you, your team or your organisation.",
      cta: "Talk to us",
    },
    contactDialog: {
      title: "Let's talk about the offer",
      subject: "Offer enquiry: {{tier}}",
      subjectGeneric: "Offer enquiry",
      name: "Full name",
      email: "E-mail",
      company: "Organisation (optional)",
      message: "Message",
      messagePlaceholder: "Tell us what your team needs - size, timeline, scope.",
      consent: "I consent to the processing of my data in order to handle this enquiry.",
      cancel: "Cancel",
      submit: "Send",
      success: "Thank you! We will get back to you shortly.",
      error: "Sending failed. Please try again.",
    },
  },
};

i18n.addResourceBundle("pl", "translation", pricingPl, true, true);
i18n.addResourceBundle("en", "translation", pricingEn, true, true);

/**
 * No-op wołany w komponencie trasy zamiast side-effectowego importu modułu.
 * Nazwane wiązanie pozwala splitterowi TanStacka przenieść cały bundle
 * tłumaczeń do chunka trasy - rejestracja dzieje się przy ewaluacji modułu.
 */
export function ensureI18n(): void {}
