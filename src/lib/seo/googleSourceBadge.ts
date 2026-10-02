// Konfiguracja badge „Preferowane źródło w Google".
//
// Jedno źródło prawdy dla: włącznika, docelowych adresów PL/EN, logotypu
// (warianty jasny/ciemny) oraz zachowania na desktopie i mobile (wariant,
// wyrównanie, marginesy). Zapis w site_settings[key="google_source_badge"],
// odczyt przez współdzielony bulk query useSiteSetting().
//
// BRAMKA ODCZYTU: wartość jest JSON-em edytowanym z panelu (i migracjami), a
// badge stoi w stopce KAŻDEJ strony - więc nic, co leży w tym wierszu, nie
// może wywrócić renderu. `normalizeGoogleSourceBadgeConfig` waliduje KAŻDE
// pole osobno (`.catch` per pole): jedno uszkodzone pole spada na SWOJĄ
// wartość domyślną, a reszta zapisu redakcji zostaje.
import { useContext, useMemo } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";

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
  logo: { light: "", dark: "", size: 18 },
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

/** Napis obcięty z białych znaków; wszystko, co nie jest napisem, to "". */
const trimmedString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Adres docelowy dla aktualnego języka; puste pole spada do wartości domyślnej.
 * Strażnik `typeof` zostaje także za bramką odczytu - helper jest publiczny
 * (podgląd w adminie podaje niezwalidowany szkic), więc liczba albo `null` w
 * miejscu adresu dają adres domyślny, a nie `TypeError`.
 */
export function resolveBadgeHref(config: GoogleSourceBadgeConfig, lang: string): string {
  const raw = lang?.toLowerCase().startsWith("en") ? config.url_en : config.url_pl;
  const trimmed = trimmedString(raw);
  return trimmed.length > 0 ? trimmed : DEFAULT_URL;
}

/** Logotyp dla danej powierzchni; brak wariantu ciemnego spada do jasnego. */
export function resolveBadgeLogo(
  logo: GoogleSourceBadgeLogo | null | undefined,
  theme: "light" | "dark",
): string | null {
  const dark = trimmedString(logo?.dark);
  const light = trimmedString(logo?.light);
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

const VARIANTS = [
  "default",
  "compact",
  "icon",
] as const satisfies readonly GoogleSourceBadgeVariant[];
const ALIGNS = ["start", "center", "end"] as const satisfies readonly GoogleSourceBadgeAlign[];

/**
 * Pole liczbowe: liczba (także w napisie) przechodzi przez klamrę zakresu,
 * BRAK klucza daje wartość domyślną. Klamra jest ta sama, której używa render
 * (`clampMargin`/`clampLogoSize`), więc render po bramce daje DOKŁADNIE te
 * same piksele co przed nią - bramka tylko czyni typ `number` prawdziwym.
 */
const clampedField = (clamp: (value: unknown) => number, fallback: number) =>
  z.unknown().transform((value) => (value === undefined ? fallback : clamp(value)));

const TRUE_LIKE: ReadonlySet<unknown> = new Set([true, 1, "true", "1"]);
const FALSE_LIKE: ReadonlySet<unknown> = new Set([false, 0, "false", "0", null]);

/**
 * Włącznik: boolean przechodzi bez zmian; jednoznaczne zapisy nie-booleanowe
 * (np. z migracji albo ręcznej edycji JSON-a) są czytane zgodnie z intencją -
 * `0`, `"false"`, `"0"` i jawny `null` WYŁĄCZAJĄ (fail-closed, jak przed bramką,
 * gdy surowe `null`/`0` gasiło badge), `1`, `"true"`, `"1"` włączają. BRAK
 * klucza i wartości niejednoznaczne (np. `"nie"`, obiekt) dają domyślkę.
 * Napisy są porównywane po `trim` i małych literach.
 */
const switchField = (fallback: boolean) =>
  z.unknown().transform((value): boolean => {
    const v = typeof value === "string" ? value.trim().toLowerCase() : value;
    if (TRUE_LIKE.has(v)) return true;
    if (FALSE_LIKE.has(v)) return false;
    return fallback;
  });

const placementSchema = (d: GoogleSourceBadgePlacement) =>
  z
    .object({
      enabled: switchField(d.enabled),
      // Wariant/wyrównanie spoza zbioru (np. "neon", "middle") spadają na
      // wartość domyślną TEGO breakpointu - świadoma decyzja: `data-variant`
      // i zdarzenie analityczne nie mogą nieść wartości, której nie da się
      // ustawić w panelu.
      variant: z.enum(VARIANTS).catch(d.variant),
      align: z.enum(ALIGNS).catch(d.align),
      marginTop: clampedField(clampMargin, d.marginTop),
      marginBottom: clampedField(clampMargin, d.marginBottom),
      marginX: clampedField(clampMargin, d.marginX),
    })
    // `null`, tablica albo napis w miejscu całej sekcji = sekcja domyślna.
    .catch(d);

const D = GOOGLE_SOURCE_BADGE_DEFAULTS;

const googleSourceBadgeSchema = z
  .object({
    enabled: switchField(D.enabled),
    url_pl: z.string().catch(D.url_pl),
    url_en: z.string().catch(D.url_en),
    logo: z
      .object({
        light: z.string().catch(D.logo.light),
        dark: z.string().catch(D.logo.dark),
        size: clampedField(clampLogoSize, D.logo.size),
      })
      .catch(D.logo),
    desktop: placementSchema(D.desktop),
    mobile: placementSchema(D.mobile),
  })
  .catch(D);

/**
 * Bramka odczytu konfiguracji badge - dowolny `unknown` z bazy na poprawny
 * `GoogleSourceBadgeConfig`, BEZ wyjątku.
 *
 * Dlaczego nie `resolveSetting(..., schema)`: tamten kontrakt (a) przy
 * nieudanym parsowaniu oddaje CAŁE domyślki - jedno złe pole kasowałoby cały
 * zapis redakcji - oraz (b) przyjmuje `ZodType<T>` z wejściem równym wyjściu,
 * co wyklucza `.catch` per pole. Ten schemat sam uzupełnia braki (deep-merge
 * z domyślkami nie jest potrzebny) i nie przepuszcza kluczy spoza kształtu.
 */
export function normalizeGoogleSourceBadgeConfig(raw: unknown): GoogleSourceBadgeConfig {
  return googleSourceBadgeSchema.parse(raw);
}

/**
 * Konfiguracja badge z mapy bulk query site_settings. BRAK wiersza (albo
 * wartość niebędąca obiektem) oddaje TĘ SAMĄ referencję
 * `GOOGLE_SOURCE_BADGE_DEFAULTS` - stabilna tożsamość dla konsumentów.
 */
export function resolveGoogleSourceBadgeConfig(
  map: SettingsMap | undefined,
): GoogleSourceBadgeConfig {
  const raw = map?.[GOOGLE_SOURCE_BADGE_SETTINGS_KEY];
  if (raw === null || typeof raw !== "object") return GOOGLE_SOURCE_BADGE_DEFAULTS;
  return normalizeGoogleSourceBadgeConfig(raw);
}

let fallbackClient: QueryClient | null = null;

/**
 * Konfiguracja badge ze współdzielonego bulk query site_settings.
 *
 * Poza drzewem QueryClientProvider (podglądy, testy jednostkowe komponentu)
 * zwraca wartości domyślne zamiast rzucać - badge ma wtedy działać „jak z
 * pudełka", a nie wywracać renderu.
 *
 * Walidacja liczy się RAZ na zmianę mapy ustawień (`useMemo`), a nie na każdy
 * render stopki - i oddaje stabilną referencję między renderami.
 */
export function useGoogleSourceBadgeConfig(): GoogleSourceBadgeConfig {
  const ctxClient = useContext(QueryClientContext);
  const client = ctxClient ?? (fallbackClient ??= new QueryClient());
  const { data } = useQuery({ ...siteSettingsQueryOptions, enabled: ctxClient != null }, client);
  const resolved = useMemo(() => resolveGoogleSourceBadgeConfig(data), [data]);
  if (!ctxClient) return GOOGLE_SOURCE_BADGE_DEFAULTS;
  return resolved;
}
