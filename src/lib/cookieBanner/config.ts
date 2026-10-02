import { readableForeground } from "@/lib/a11y/contrast";
// Admin-configurable cookie banner overrides.
// Stored in site_settings[key="cookie_banner_config"]. Empty string values
// inherit from the current theme, so a fresh install works with zero setup.

import { useSiteSetting } from "@/lib/useSiteSetting";
import { localizedPath, type AppLang } from "@/lib/i18n/localePath";

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
  /** Rozwija panel kategorii wewnątrz kompaktowego banera. */
  customize: string;
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

/** Logo banera - osobne warianty dla trybu jasnego i ciemnego. */
export type CookieBannerLogo = {
  /** Puste = sygnet marki z ustawień motywu. */
  light: string;
  dark: string;
  /** Rozmiar kafla w px (24-72). */
  size: number;
};

/** Schematy, które odnośnik z panelu może nieść wprost - wszystko inne odpada. */
const BANNER_LINK_SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto", "tel"]);

/**
 * Adres dodatkowego odnośnika banera DLA JĘZYKA, w którym baner się wyświetla,
 * albo `null`, gdy adresu nie wolno pokazać.
 *
 * DLACZEGO. Odnośnik z panelu szedł do `href` dosłownie, więc gość czytający
 * baner po angielsku (`/en/...`) klikał „/cookies" i lądował na POLSKIEJ
 * wersji strony - mimo że wszystkie pozostałe odnośniki banera (polityka
 * prywatności, zasady przetwarzania) idą przez `localizedPath`. Adres nie był
 * też w żaden sposób sprawdzany: `javascript:` wpisane w panelu trafiało do
 * banera wyświetlanego KAŻDEMU odwiedzającemu.
 *
 * REGUŁY:
 *   * ścieżka wewnętrzna (`/cookies`, także bez wiodącego `/`) dostaje prefiks
 *     języka według `localizedPath` - ta sama reguła co reszta serwisu, łącznie
 *     z powierzchniami, które prefiksu nie dostają nigdy (`/admin`, `/api`, ...);
 *     zapytanie i kotwica jadą za ścieżką bez zmian;
 *   * ścieżka JUŻ z prefiksem (`/en/cookies`) jest sprowadzana do języka banera,
 *     więc wersja polska nie prowadzi na stronę angielską;
 *   * adres zewnętrzny `http(s)://`, `mailto:`, `tel:` i adres bez schematu
 *     (`//host`) - bez zmian;
 *   * sama kotwica / samo zapytanie (`#sekcja`, `?a=b`) - bez zmian;
 *   * każdy inny schemat (`javascript:`, `data:`, `vbscript:`, ...) i pusty
 *     adres - `null`: baner pomija taki odnośnik.
 */
export function bannerLinkHref(url: string | null | undefined, lang: AppLang): string | null {
  const value = (url ?? "").trim();
  if (value === "") return null;
  if (value.startsWith("//") || value.startsWith("#") || value.startsWith("?")) return value;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme) return BANNER_LINK_SCHEMES.has(scheme[1].toLowerCase()) ? value : null;
  const cut = value.search(/[?#]/);
  const path = cut === -1 ? value : value.slice(0, cut);
  const rest = cut === -1 ? "" : value.slice(cut);
  return `${localizedPath(path, lang)}${rest}`;
}

/** Dodatkowy odnośnik prawny pokazywany pod treścią banera. */
export type CookieBannerLink = {
  id: string;
  url: string;
  label_pl: string;
  label_en: string;
};

export type CookieBannerConfig = {
  enabled: boolean;
  languageSwitcher: boolean;
  /** Pokaż w szczegółach elementy wykryte automatycznie przez skaner. */
  autoInventory: boolean;
  logo: CookieBannerLogo;
  links: CookieBannerLink[];
  colors: CookieBannerColors;
  copy: {
    pl: CookieBannerCopy;
    en: CookieBannerCopy;
  };
};

export const COOKIE_BANNER_LOGO_DEFAULTS: CookieBannerLogo = {
  light: "",
  dark: "",
  size: 36,
};

export const COOKIE_BANNER_LOGO_SIZE_MIN = 24;
export const COOKIE_BANNER_LOGO_SIZE_MAX = 72;

/**
 * Rozmiar kafla logo w zakresie 24-72 px, który panel obiecuje w podpowiedzi.
 *
 * Do tej poprawki zakres był wyłącznie atrybutem `min`/`max` pola liczbowego -
 * czyli NIE był egzekwowany ani przy zapisie, ani przy renderze: wpisane
 * „500" zapisywało się i baner na KAŻDEJ stronie rysował kafel 500 px.
 * Wartość spoza liczb (pusta, `NaN`) wraca do domyślnych 36 px.
 */
export function clampCookieBannerLogoSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return COOKIE_BANNER_LOGO_DEFAULTS.size;
  return Math.min(
    COOKIE_BANNER_LOGO_SIZE_MAX,
    Math.max(COOKIE_BANNER_LOGO_SIZE_MIN, Math.round(parsed)),
  );
}

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
  compactMessage:
    "Używamy plików cookie, aby serwis działał poprawnie i by lepiej dopasować treści. Szczegóły znajdziesz w dokumentach:",
  acceptAll: "Akceptuj wszystkie",
  rejectAll: "Tylko niezbędne",
  saveSelection: "Zapisz wybrane",
  customize: "Dostosuj",
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
  compactMessage:
    "We use cookies to keep the site working and to tailor content. You will find the details in:",
  acceptAll: "Accept all",
  rejectAll: "Only necessary",
  saveSelection: "Save selection",
  customize: "Customize",
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
  autoInventory: true,
  logo: COOKIE_BANNER_LOGO_DEFAULTS,
  links: [],
  colors: COOKIE_BANNER_COLOR_DEFAULTS,
  copy: { pl: COPY_PL, en: COPY_EN },
};

export const COOKIE_BANNER_SETTINGS_KEY = "cookie_banner_config";

export function useCookieBannerConfig(): CookieBannerConfig {
  return useSiteSetting<CookieBannerConfig>(COOKIE_BANNER_SETTINGS_KEY, COOKIE_BANNER_DEFAULTS);
}

/** Inline CSS custom properties for banner overrides; empty strings skipped. */
export function bannerStyleVars(colors: CookieBannerColors): React.CSSProperties {
  const style: Record<string, string> = {};
  if (colors.surface) style["--cb-surface"] = colors.surface;
  if (colors.foreground) style["--cb-fg"] = colors.foreground;
  if (colors.muted) style["--cb-muted"] = colors.muted;
  if (colors.border) style["--cb-border"] = colors.border;
  // The global primary palette is editable independently of its foreground.
  // Use the contrast-tested brand pair for unset banner colors.
  style["--cb-accent"] = colors.accent || "var(--brand)";
  style["--cb-accent-fg"] = colors.accent
    ? readableForeground(colors.accent, colors.accentForeground || "var(--brand-foreground)")
    : "var(--brand-foreground)";
  if (colors.surface && colors.foreground) {
    style["--cb-fg"] = readableForeground(colors.surface, colors.foreground);
  }
  return style as React.CSSProperties;
}
