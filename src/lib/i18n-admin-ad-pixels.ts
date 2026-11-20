// i18n panelu „Piksele Ads" (/admin/analytics).
import i18n from "@/lib/i18n";

const pl = {
  adminAdPixels: {
    tab: "Piksele Ads",
    title: "Wizyty i konwersje z pikseli reklamowych",
    subtitle:
      "Liczone tylko po zgodzie na marketing w banerze cookies (i zgodzie na analitykę). Własny pomiar strony - raporty w Meta, Google Ads i LinkedIn mogą się różnić.",
    range: "Ostatnie {{days}} dni",
    loading: "Wczytywanie danych pikseli…",
    error: "Nie udało się wczytać danych pikseli.",
    empty: "Brak wizyt po zgodzie marketingowej w tym okresie.",
    capped: "Okres zawiera więcej zdarzeń niż limit próbki - liczby są zaniżone.",
    kpi: {
      visits: "Wizyty po zgodzie",
      conversions: "Konwersje",
      rate: "Współczynnik konwersji",
    },
    platform: { meta: "Meta Pixel", google_ads: "Google Ads", linkedin: "LinkedIn Insight" },
    platformLine: "{{visits}} wizyt · {{conversions}} konwersji · CR {{rate}}%",
    charts: {
      visits: "Wizyty dziennie wg platformy",
      visitsSub: "Wizyta = załadowanie pikseli po zgodzie marketingowej.",
      conversions: "Konwersje dziennie wg platformy",
      conversionsSub: "Formularz, rejestracja i kliknięcie w strategię.",
      kinds: "Rodzaje konwersji",
    },
    kind: { form_submit: "Formularz", registration: "Rejestracja", strategy_click: "Klik w strategię", other: "Inne" },
    cols: { day: "Dzień" },
  },
};

const en: typeof pl = {
  adminAdPixels: {
    tab: "Ad pixels",
    title: "Visits and conversions from ad pixels",
    subtitle:
      "Counted only after marketing consent in the cookie banner (and analytics consent). First-party measurement - Meta, Google Ads and LinkedIn reports may differ.",
    range: "Last {{days}} days",
    loading: "Loading pixel data…",
    error: "Could not load pixel data.",
    empty: "No visits with marketing consent in this period.",
    capped: "The period has more events than the sample limit - numbers are understated.",
    kpi: { visits: "Consented visits", conversions: "Conversions", rate: "Conversion rate" },
    platform: { meta: "Meta Pixel", google_ads: "Google Ads", linkedin: "LinkedIn Insight" },
    platformLine: "{{visits}} visits · {{conversions}} conversions · CR {{rate}}%",
    charts: {
      visits: "Daily visits by platform",
      visitsSub: "Visit = pixels loaded after marketing consent.",
      conversions: "Daily conversions by platform",
      conversionsSub: "Form, registration and strategy click.",
      kinds: "Conversion types",
    },
    kind: { form_submit: "Form", registration: "Registration", strategy_click: "Strategy click", other: "Other" },
    cols: { day: "Day" },
  },
};

let registered = false;
export function ensureI18n(): void {
  if (registered) return;
  registered = true;
  i18n.addResourceBundle("pl", "translation", pl, true, true);
  i18n.addResourceBundle("en", "translation", en, true, true);
}
ensureI18n();
