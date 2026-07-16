// Admin-configurable cookie banner overrides.
// Stored in site_settings[key="cookie_banner_config"]. Empty string values
// inherit from the current theme, so a fresh install works with zero setup.

import { useSiteSetting } from "@/lib/useSiteSetting";

export type CookieBannerColors = {
  surface: string;
  foreground: string;
  muted: string;
  border: string;
  accent: string;
  accentForeground: string;
};

export type CookieBannerCopy = {
  title: string;
  intro: string;
  policyLabel: string;
  compactMessage: string;
  acceptAll: string;
  rejectAll: string;
  saveSelection: string;
  showDetails: string;
  hideDetails: string;
  showVendors: string;
  hideVendors: string;
  categoryNecessary: string;
  categoryFunctional: string;
  categoryAnalytics: string;
  categoryMarketing: string;
  descNecessary: string;
  descFunctional: string;
  descAnalytics: string;
  descMarketing: string;
};

export type CookieBannerConfig = {
  enabled: boolean;
  languageSwitcher: boolean;
  colors: CookieBannerColors;
  copy: {
    pl: CookieBannerCopy;
    en: CookieBannerCopy;
  };
};

export const COOKIE_BANNER_COLOR_DEFAULTS: CookieBannerColors = {
  surface: "",
  foreground: "",
  muted: "",
  border: "",
  accent: "",
  accentForeground: "",
};

const COPY_PL: CookieBannerCopy = {
  title: "Zarządzaj swoją prywatnością",
  intro:
    "Nasza platforma wykorzystuje pliki cookie i podobne technologie w celu zapewnienia bezpieczeństwa, personalizacji oraz analizy ruchu. Poniżej znajdziesz szczegółowe informacje o każdej kategorii i podmiotach przetwarzających dane. Pełne informacje zawiera nasza",
  policyLabel: "Polityka Prywatności",
  compactMessage: "Używamy plików cookie. Dowiedz się więcej w",
  acceptAll: "Akceptuj wszystkie",
  rejectAll: "Tylko niezbędne",
  saveSelection: "Zapisz wybrane",
  showDetails: "Szczegóły i podmioty",
  hideDetails: "Ukryj szczegóły",
  showVendors: "Pokaż podmioty",
  hideVendors: "Ukryj podmioty",
  categoryNecessary: "Niezbędne",
  categoryFunctional: "Funkcjonalne",
  categoryAnalytics: "Analityczne",
  categoryMarketing: "Marketingowe",
  descNecessary:
    "Pliki cookie wymagane do prawidłowego działania platformy - uwierzytelnianie sesji, ochrona CSRF i podstawowe funkcje bezpieczeństwa. Nie można ich wyłączyć zgodnie z art. 5 ust. 3 dyrektywy ePrivacy.",
  descFunctional:
    "Zapamiętują Twoje preferencje (motyw kolorystyczny, układ interfejsu). Dane przechowywane lokalnie w przeglądarce (localStorage), bez transmisji do podmiotów trzecich.",
  descAnalytics:
    "Zbierają zanonimizowane dane o sposobie korzystania z platformy (odwiedzane strony, czas sesji, źródła ruchu). Służą optymalizacji treści i funkcjonalności. Żadne dane analityczne nie są zbierane przed wyrażeniem zgody.",
  descMarketing:
    "Umożliwiają prowadzenie kampanii e-mailowych, śledzenie konwersji i personalizację komunikacji marketingowej. Dane mogą być przekazywane do podmiotów trzecich wymienionych poniżej.",
};

const COPY_EN: CookieBannerCopy = {
  title: "Manage your privacy",
  intro:
    "Our platform uses cookies and similar technologies to ensure security, personalisation and traffic analysis. Below you will find detailed information about each category and the entities processing the data. Full information is available in our",
  policyLabel: "Privacy Policy",
  compactMessage: "We use cookies. Learn more in our",
  acceptAll: "Accept all",
  rejectAll: "Only necessary",
  saveSelection: "Save selection",
  showDetails: "Details and vendors",
  hideDetails: "Hide details",
  showVendors: "Show vendors",
  hideVendors: "Hide vendors",
  categoryNecessary: "Necessary",
  categoryFunctional: "Functional",
  categoryAnalytics: "Analytics",
  categoryMarketing: "Marketing",
  descNecessary:
    "Cookies required for the platform to function - session authentication, CSRF protection and core security features. Cannot be disabled under Article 5(3) of the ePrivacy Directive.",
  descFunctional:
    "Remember your preferences (color theme, interface layout). Stored locally in the browser (localStorage), never sent to third parties.",
  descAnalytics:
    "Collect anonymised information on how the platform is used (pages visited, session duration, traffic sources). Used to improve content and features. No analytics is collected before consent is granted.",
  descMarketing:
    "Enable email campaigns, conversion tracking and personalised marketing communication. Data may be shared with the third parties listed below.",
};

export const COOKIE_BANNER_DEFAULTS: CookieBannerConfig = {
  enabled: true,
  languageSwitcher: true,
  colors: COOKIE_BANNER_COLOR_DEFAULTS,
  copy: { pl: COPY_PL, en: COPY_EN },
};

export const COOKIE_BANNER_SETTINGS_KEY = "cookie_banner_config";

export function useCookieBannerConfig(): CookieBannerConfig {
  return useSiteSetting<CookieBannerConfig>(
    COOKIE_BANNER_SETTINGS_KEY,
    COOKIE_BANNER_DEFAULTS,
  );
}

/** Inline CSS custom properties for banner overrides; empty strings skipped. */
export function bannerStyleVars(colors: CookieBannerColors): React.CSSProperties {
  const style: Record<string, string> = {};
  if (colors.surface) style["--cb-surface"] = colors.surface;
  if (colors.foreground) style["--cb-fg"] = colors.foreground;
  if (colors.muted) style["--cb-muted"] = colors.muted;
  if (colors.border) style["--cb-border"] = colors.border;
  if (colors.accent) style["--cb-accent"] = colors.accent;
  if (colors.accentForeground) style["--cb-accent-fg"] = colors.accentForeground;
  return style as React.CSSProperties;
}
