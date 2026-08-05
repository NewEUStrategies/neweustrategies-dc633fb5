// Konfiguracja badge „Preferowane źródło w Google".
//
// Jedno źródło prawdy dla: włącznika, docelowych adresów PL/EN, logotypu
// (warianty jasny/ciemny) oraz zachowania na desktopie i mobile (wariant,
// wyrównanie, marginesy). Zapis w site_settings[key="google_source_badge"],
// odczyt przez współdzielony bulk query useSiteSetting().
import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { resolveSetting, siteSettingsQueryOptions } from "@/lib/useSiteSetting";

/** Domena serwisu użyta jako parametr `q` panelu preferowanych źródeł. */
export const GOOGLE_PREFERRED_SOURCE_DOMAIN = "neweuropeanstrategies.com";

export const GOOGLE_SOURCE_BADGE_SETTINGS_KEY = "google_source_badge";

export const googlePreferredSourceUrl = (domain = GOOGLE_PREFERRED_SOURCE_DOMAIN) =>
  `https://google.com/preferences/source?q=${encodeURIComponent(domain)}`;

export type GoogleSourceBadgeVariant = "default" | "compact" | "icon";
export type GoogleSourceBadgeAlign = "start" | "center" | "end";

/** Zachowanie badge na jednym breakpoincie (desktop albo mobile). */
export type GoogleSourceBadgePlacement = {
  /** Wyłączenie ukrywa badge tylko na tym breakpoincie. */
  enabled: boolean;
  variant: GoogleSourceBadgeVariant;
  align: GoogleSourceBadgeAlign;
  /** Marginesy zewnętrzne w px (0-48). */
  marginTop: number;
  marginBottom: number;
  marginX: number;
};

export type GoogleSourceBadgeLogo = {
  /** Puste = wbudowany sygnet Google. */
  light: string;
  dark: string;
  /** Rozmiar sygnetu w px (10-32). */
  size: number;
};

export type GoogleSourceBadgeConfig = {
  enabled: boolean;
  /** Docelowe adresy panelu Google - osobno dla wersji PL i EN. */
  url_pl: string;
  url_en: string;
  logo: GoogleSourceBadgeLogo;
  desktop: GoogleSourceBadgePlacement;
  mobile: GoogleSourceBadgePlacement;
};

const DEFAULT_URL = googlePreferredSourceUrl();

export const GOOGLE_SOURCE_BADGE_DEFAULTS: GoogleSourceBadgeConfig = {
  enabled: true,
  url_pl: DEFAULT_URL,
  url_en: DEFAULT_URL,
  logo: { light: "", dark: "", size: 14 },
  desktop: {
    enabled: true,
    variant: "default",
    align: "end",
    marginTop: 0,
    marginBottom: 0,
    marginX: 0,
  },
  mobile: {
    enabled: true,
    variant: "compact",
    align: "start",
    marginTop: 0,
    marginBottom: 0,
    marginX: 0,
  },
};

export type GoogleSourceBadgeDevice = "desktop" | "mobile";

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** Normalizuje margines wpisany w adminie do bezpiecznego zakresu 0-48 px. */
export const clampMargin = (value: unknown): number => clampNumber(value, 0, 48, 0);

/** Normalizuje rozmiar sygnetu do zakresu 10-32 px. */
export const clampLogoSize = (value: unknown): number => clampNumber(value, 10, 32, 14);

/** Adres docelowy dla aktualnego języka; puste pole spada do wartości domyślnej. */
export function resolveBadgeHref(config: GoogleSourceBadgeConfig, lang: string): string {
  const raw = (lang?.toLowerCase().startsWith("en") ? config.url_en : config.url_pl) ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_URL;
}

/** Logotyp dla danej powierzchni; brak wariantu ciemnego spada do jasnego. */
export function resolveBadgeLogo(
  logo: GoogleSourceBadgeLogo,
  theme: "light" | "dark",
): string | null {
  const dark = logo.dark?.trim() ?? "";
  const light = logo.light?.trim() ?? "";
  const preferred = theme === "dark" ? dark || light : light || dark;
  return preferred.length > 0 ? preferred : null;
}

const ALIGN_CLASS: Record<GoogleSourceBadgeAlign, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
};

/** Klasa flexbox opisująca wyrównanie badge w jego wierszu. */
export const alignClass = (align: GoogleSourceBadgeAlign): string =>
  ALIGN_CLASS[align] ?? ALIGN_CLASS.start;

/** Styl marginesów badge (inline - wartości pochodzą od redakcji). */
export function placementStyle(placement: GoogleSourceBadgePlacement): React.CSSProperties {
  return {
    marginTop: clampMargin(placement.marginTop),
    marginBottom: clampMargin(placement.marginBottom),
    marginLeft: clampMargin(placement.marginX),
    marginRight: clampMargin(placement.marginX),
  };
}

/** Czy badge ma się w ogóle renderować na danym breakpoincie. */
export const isBadgeVisible = (
  config: GoogleSourceBadgeConfig,
  device: GoogleSourceBadgeDevice,
): boolean => config.enabled && config[device].enabled;

let fallbackClient: QueryClient | null = null;

/**
 * Konfiguracja badge ze współdzielonego bulk query site_settings.
 *
 * Poza drzewem QueryClientProvider (podglądy, testy jednostkowe komponentu)
 * zwraca wartości domyślne zamiast rzucać - badge ma wtedy działać „jak z
 * pudełka", a nie wywracać renderu.
 */
export function useGoogleSourceBadgeConfig(): GoogleSourceBadgeConfig {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  const { data } = useQuery({ ...siteSettingsQueryOptions, enabled: ctxClient != null }, client);
  if (!ctxClient) return GOOGLE_SOURCE_BADGE_DEFAULTS;
  return resolveSetting(data, GOOGLE_SOURCE_BADGE_SETTINGS_KEY, GOOGLE_SOURCE_BADGE_DEFAULTS);
}
