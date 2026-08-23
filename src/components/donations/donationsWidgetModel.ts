// Warstwa DECYZJI widgetu darowizn (CMS) - zero Reacta, zero react-query.
//
// PO CO ISTNIEJE. `DonationsWidgetView.tsx` miał 467 linii, z których pierwsze
// 40 to była CAŁA logika: normalizacja propsów edytora (trzy różne konwencje
// boolean w jednym komponencie), wybór języka, waluty i trybu akcji, arytmetyka
// paska postępu oraz dwa formatery (kwota, czas relatywny). Ta logika decyduje
// o tym, JAKĄ KWOTĘ widzi darczyńca, a dojście do niej wymagało przejazdu przez
// sześć wariantów wizualnych - więc realnie nikt jej nie sprawdzał (79% linii,
// 65% gałęzi na całym pliku).
//
// EKSTRAKCJA NIE ZMIENIA ZACHOWANIA. Ciała `fmtMoney`, `fmtRelative` i wzór
// postępu przeniesione ZNAK W ZNAK, razem z wadami (utrata groszy w gałęzi
// `catch`, polskie i angielskie napisy wpisane w kod, pasek liczący
// darczyńców × 5 przy braku celu). Wady są opisane niżej i przypięte testami
// w `__tests__/donationsWidgetModel.test.ts` - naprawa to osobna praca.
import { uiLocale } from "@/lib/i18n/format";
import type { DonationCtaMode } from "./DonationCta";

export type DonationsVariant =
  "hero" | "progress" | "stats-strip" | "compact-card" | "inline-bar" | "thermometer";

export interface DonationsWidgetProps {
  variant?: DonationsVariant;
  title?: string;
  subtitle?: string;
  cta?: string;
  href?: string;
  goalCents?: number;
  currency?: string;
  showMonth?: boolean;
  showCount?: boolean;
  showRecent?: boolean;
  accent?: string;
  /** Zgodność wstecz: `quick` = dawna szybka płatność, dziś link do zbiórki. */
  quickDonate?: boolean;
  /** Tryb akcji: link na /support albo bezpośredni link do zewnętrznej zbiórki. */
  mode?: DonationCtaMode;
  lang?: "pl" | "en";
}

/** Jedna pozycja listy „ostatnie wpłaty" (server fn nie oddaje darczyńcy). */
export interface RecentDonation {
  amount_cents: number;
  currency: string;
  created_at: string;
}

export interface StatsShape {
  totalCents: number;
  monthCents: number;
  count: number;
  monthCount: number;
  currency: string;
  recent: RecentDonation[];
}

/**
 * Kształt podstawiany, gdy odczyt publicznych statystyk NIE DAŁ danych.
 *
 * UWAGA - to jest zera, a nie „brak danych": widok nie rozróżnia awarii odczytu
 * ani stanu wczytywania od zbiórki, której nikt nie wsparł. Skutek dla
 * użytkownika opisuje test „awaria odczytu statystyk renderuje 0 zł".
 */
export const FALLBACK: StatsShape = {
  totalCents: 0,
  monthCents: 0,
  count: 0,
  monthCount: 0,
  currency: "PLN",
  recent: [],
};

/**
 * Kwota z groszy na napis waluty. Przeniesione ZNAK W ZNAK z widoku.
 *
 * Dwie właściwości warte przypięcia testem:
 *   * `maximumFractionDigits` zależy od `cents % 100 === 0`, więc 100 gr
 *     pokazuje się BEZ groszy, a 150 gr Z groszami (niespójna szerokość kolumny
 *     kwot na jednej liście),
 *   * gałąź `catch` (niepoprawny kod waluty - `Intl` rzuca `RangeError`) używa
 *     `toFixed(0)`, czyli GUBI grosze i nie zaokrągla ich w górę.
 */
export function fmtMoney(cents: number, currency: string, lang: "pl" | "en"): string {
  try {
    return new Intl.NumberFormat(uiLocale(lang), {
      style: "currency",
      currency,
      maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(0)} ${currency}`;
  }
}

/**
 * „5 min temu" / „3 godz. temu" / „2 dni temu". Przeniesione ZNAK W ZNAK.
 *
 * DŁUG i18n: napisy są wpisane w kod (dwa języki na `if`), nie idą przez `t()`,
 * więc słownik `i18n-donations-widget.ts` nie ma nawet klucza, którym można by
 * je poprawić. Poza tym funkcja czyta `Date.now()`, więc jest testowalna
 * wyłącznie przy zamrożonym zegarze, a data z PRZYSZŁOŚCI daje „0 min temu"
 * (`Math.max(0, ...)`), nie napis o przyszłości.
 */
export function fmtRelative(iso: string, lang: "pl" | "en"): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 60) return lang === "pl" ? `${mins} min temu` : `${mins} min ago`;
  if (hours < 24) return lang === "pl" ? `${hours} godz. temu` : `${hours}h ago`;
  return lang === "pl" ? `${days} dni temu` : `${days}d ago`;
}

/**
 * Procent realizacji celu. Przeniesione ZNAK W ZNAK z `useMemo` widoku:
 * brak celu daje 0, przekroczenie celu jest przycinane do 100.
 */
export function computeProgressPct(goalCents: number, totalCents: number): number {
  if (goalCents <= 0) return 0;
  return Math.min(100, Math.round((totalCents / goalCents) * 100));
}

/**
 * Wypełnienie PASKA (wariant `progress` i `thermometer`) - wyrażenie z linii
 * 274 i 318 starego widoku, przeniesione ZNAK W ZNAK.
 *
 * UWAGA, to nie to samo co `computeProgressPct`: przy braku celu pasek pokazuje
 * LICZBĘ DARCZYŃCÓW × 5 jako procent, więc 20 wpłat maluje pasek na 100% bez
 * żadnego celu zbiórki.
 */
export function resolveBarPct(goalCents: number, progressPct: number, count: number): number {
  return goalCents > 0 ? progressPct : Math.min(100, count * 5);
}

/** Minimum z instancji i18next, jakiego potrzebuje rozstrzygnięcie propsów. */
export interface WidgetI18n {
  /** Surowe `i18n.language` - porównywane DOKŁADNIE z "en" (nie `startsWith`). */
  language?: string;
  t: (key: string) => string;
}

export interface ResolvedWidgetProps {
  lang: "pl" | "en";
  variant: DonationsVariant;
  href: string;
  cta: string;
  title: string;
  subtitle: string;
  goalCents: number;
  showMonth: boolean;
  showCount: boolean;
  showRecent: boolean;
  accent: string;
  currency: string;
  actionMode: DonationCtaMode;
  progressPct: number;
}

/**
 * Jedno rozstrzygnięcie konfiguracji widgetu z edytora CMS + statystyk.
 * Przeniesione ZNAK W ZNAK z linii 84-121 widoku.
 *
 * CO TU JEST NIEOCZYWISTE (i dlatego ma test):
 *   * trzy konwencje boolean naraz - `showMonth`/`showCount` to `!== false`
 *     (domyślnie WŁĄCZONE), a `showRecent` to `=== true` (domyślnie WYŁĄCZONE),
 *   * `props.currency` bije `stats.currency`, czyli waluta wpisana w edytorze
 *     przemianowuje kwoty ZEBRANE w innej walucie, nie przelicza ich,
 *   * domyślny tytuł to literał („Mecenat obywatelski" / „Citizen patronage")
 *     mimo zaimportowanego słownika - drugi dług i18n obok `fmtRelative`,
 *   * język bierze się z `i18n.language === "en"`, więc `"en-US"` daje POLSKI.
 */
export function resolveWidgetProps(
  props: DonationsWidgetProps,
  stats: StatsShape,
  i18n: WidgetI18n,
): ResolvedWidgetProps {
  const lang: "pl" | "en" = props.lang ?? (i18n.language === "en" ? "en" : "pl");
  const variant: DonationsVariant = props.variant ?? "hero";
  const href = props.href?.trim() || "/support";
  const cta = props.cta?.trim() || i18n.t("donationsWidget.cta");
  const title =
    props.title?.trim() || (lang === "pl" ? "Mecenat obywatelski" : "Citizen patronage");
  const subtitle = props.subtitle?.trim() ?? "";
  const goalCents = Math.max(0, Number(props.goalCents ?? 0) || 0);
  const showMonth = props.showMonth !== false;
  const showCount = props.showCount !== false;
  const showRecent = props.showRecent === true;
  const accent = props.accent?.trim() || "";
  const currency = props.currency?.trim() || stats.currency || "PLN";
  // Wspólna konfiguracja akcji darowizny - jeden tryb dla każdego wariantu
  // wizualnego, żeby CTA nie rozjechało się między nimi.
  const actionMode = (props.mode ??
    (props.quickDonate === true ? "quick" : "link")) as DonationCtaMode;

  return {
    lang,
    variant,
    href,
    cta,
    title,
    subtitle,
    goalCents,
    showMonth,
    showCount,
    showRecent,
    accent,
    currency,
    actionMode,
    progressPct: computeProgressPct(goalCents, stats.totalCents),
  };
}
