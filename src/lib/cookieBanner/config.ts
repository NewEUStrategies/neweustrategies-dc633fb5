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
  if (value.startsWith("#") || value.startsWith("?")) return value;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (scheme) return BANNER_LINK_SCHEMES.has(scheme[1].toLowerCase()) ? value : null;
  // Ścieżkę rozwiązujemy TAK, JAK ZROBI TO PRZEGLĄDARKA, zanim dołożymy prefiks
  // języka. Przeglądarka traktuje `\` jak `/` i skleja `..`, więc bez tego
  // `/\evil.example` było w wersji PL adresem ZEWNĘTRZNYM (`//evil.example`),
  // a w EN wewnętrznym (`/en/\evil.example`), a `/en/../cookies` w wersji EN
  // prowadziło na `/cookies`, czyli na stronę polską. Adres, który po
  // rozwiązaniu wychodzi poza serwis (`//host`), zostaje bez zmian - jak każdy
  // adres zewnętrzny - więc obie wersje banera prowadzą w to samo miejsce.
  const base = "https://banner-link.invalid";
  let resolved: URL;
  try {
    // `\cookies` przeglądarka czyta jak `/cookies`, więc wiodący ukośnik
    // dokładamy tylko adresowi, który nie zaczyna się od żadnego z nich.
    resolved = new URL(/^[/\\]/.test(value) ? value : `/${value}`, base);
  } catch {
    return null;
  }
  if (resolved.origin !== base) return value;
  // Pusty człon ścieżki (`/en//cookies`, `..//x`, `/.//x`) zostaje w `pathname`
  // jako `//`. Po zdjęciu prefiksu `/en` wersja PL dostawała `//cookies` -
  // adres BEZ SCHEMATU, czyli wyjście z serwisu - a EN zostawała wewnątrz.
  // Sklejone ukośniki: ścieżka zawsze wewnętrzna, w obu wersjach ta sama.
  const pathname = resolved.pathname.replace(/\/{2,}/g, "/");
  return `${localizedPath(pathname, lang)}${resolved.search}${resolved.hash}`;
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
  links: CookieBannerLink[];
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
    "Nasza platforma wykorzystuje pliki cookie i podobne technologie w celu zapewnienia bezpieczeństwa, zapamiętania ustawień, analizy ruchu oraz pomiaru reklam. Poniżej znajdziesz szczegółowe informacje o każdej kategorii i podmiotach przetwarzających dane. Pełne informacje zawiera nasza",
  policyLabel: "Polityka Prywatności",
  compactMessage:
    "Używamy plików cookie, aby serwis działał poprawnie, a za Twoją zgodą także do statystyk i pomiaru reklam. Szczegóły:",
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
    "Pomagają zrozumieć, jak korzystasz z serwisu: odwiedzane strony, źródła wejść, czas wizyty, kliknięcia, mapy przewijania i nagrania sesji (wpisywane treści są maskowane). Służą poprawie treści i nawigacji. Bez tej zgody liczymy wyłącznie odsłony, czas na stronie, szybkość i błędy - bez plików cookie i bez rozpoznawania odwiedzających.",
  descMarketing:
    "Pozwalają mierzyć skuteczność naszych reklam w wyszukiwarce i serwisach społecznościowych oraz pokazywać je osobom, które odwiedziły serwis. Podmioty wymienione poniżej otrzymują wtedy identyfikatory z plików cookie, odwiedzane adresy i wykonane działania (np. zapis, zakup z kwotą). Zgodę możesz wycofać w każdej chwili w polityce cookies.",
};

const COPY_EN: CookieBannerCopy = {
  title: "Manage your privacy",
  intro:
    "Our platform uses cookies and similar technologies for security, remembering your settings, traffic analysis and ad measurement. Below you will find detailed information about each category and the entities processing the data. Full information is available in our",
  policyLabel: "Privacy Policy",
  compactMessage: "We use cookies to keep the site working and, with your consent, for statistics and ad measurement. Details:",
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
    "Help us understand how you use the site: pages visited, traffic sources, visit duration, clicks, scroll maps and session recordings (typed input is masked). Used to improve content and navigation. Without this consent we only count page views, time on page, page speed and errors - without cookies and without recognising visitors.",
  descMarketing:
    "Let us measure how our ads in search and on social networks perform and show them to people who have visited the site. The entities listed below then receive cookie identifiers, the addresses you visit and the actions you take (e.g. a sign-up, a purchase with its value). You can withdraw consent at any time in the cookie policy.",
};

export const COOKIE_BANNER_DEFAULTS: CookieBannerConfig = {
  enabled: true,
  languageSwitcher: true,
  autoInventory: true,
  links: [],
  colors: COOKIE_BANNER_COLOR_DEFAULTS,
  copy: { pl: COPY_PL, en: COPY_EN },
};

export const COOKIE_BANNER_SETTINGS_KEY = "cookie_banner_config";

/**
 * Treść banera w danym języku z powrotem do brzmień DOMYŚLNYCH dla pól pustych.
 *
 * Panel pokazuje brzmienia domyślne jako podpowiedzi w polach treści. Bez tej
 * reguły podpowiedź kłamała: wyczyszczone pole zapisywało się jako `""`,
 * a baner rysował przycisk bez nazwy (niedostępny dla czytnika ekranu) albo
 * pusty nagłówek. Pole z samych spacji też jest puste.
 */
export function resolveBannerCopy(
  copy: Partial<CookieBannerCopy> | null | undefined,
  lang: AppLang,
): CookieBannerCopy {
  const defaults = COOKIE_BANNER_DEFAULTS.copy[lang];
  const out = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof CookieBannerCopy)[]) {
    const value = copy?.[key];
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

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
