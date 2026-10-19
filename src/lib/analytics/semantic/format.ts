/**
 * Formatowanie wartości metryk kanonicznych - jedna implementacja dla całego
 * panelu, sterowana JEDNOSTKĄ ze słownika, nie zgadywaniem po nazwie metryki.
 *
 * Dotąd każdy dashboard formatował po swojemu: CLS bywał pokazywany z sufiksem
 * „ms” (jest bezwymiarowy), a wskaźniki raz jako ułamek, raz jako procent. Skoro
 * słownik metryk zna jednostkę, formatowanie może z niej wynikać.
 *
 * Kluczowa reguła: brak wartości (`null`) NIGDY nie renderuje się jako „0”.
 * „0 %” w raporcie zarządczym czyta się jako „nikt nie kliknął”, a nie jako
 * „nie mamy podstawy do wyliczenia” - to dwie różne informacje.
 */
import { type ChartLang, formatChartValue } from "@/lib/charts/format";
import type { MetricUnit } from "./metrics";

/**
 * Locale `Intl` dla języka wykresów. Mapa, nie warunek: o tym, jak wygląda
 * liczba, waluta i jednostka czasu w danym języku, decyduje ICU (odmiana
 * „1 miesiąc / 5 miesięcy”, symbol waluty, separator), a nie gałęzie w kodzie.
 * Konwencja domu: EN po europejsku (`en-GB`), jak `@/lib/charts/format`.
 */
const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

/** Wymagany kształt kodu waluty - ten sam, który waliduje `parseMoneyByCurrency`. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Liczba miejsc dziesiętnych waluty wg ISO 4217 - z `Intl`, nie z tabeli
 * w kodzie (JPY 0, PLN 2, BHD 3). Kwoty jadą w jednostkach DROBNYCH, więc
 * pomyłka wykładnika to błąd rzędu wielkości: 1000 jenów pokazane jako 10 ¥.
 * Kod niepoprawny składniowo daje 2 - domyślny wykładnik ISO - bo funkcja
 * służy formatowaniu i nie może wywrócić renderu tabeli.
 */
export function currencyExponent(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/**
 * Kwota w jednostkach drobnych jako napis waluty języka (`1234,56 zł`,
 * `PLN 1,234.56`). Brak liczby albo zły kod waluty → „-”: kwota bez waluty
 * nie jest kwotą, a „0 zł” w miejscu braku wysyła admina w pościg za spadkiem,
 * którego nie było.
 */
export function formatMoneyMinor(amountMinor: number, currency: string, lang: ChartLang): string {
  if (!Number.isFinite(amountMinor) || !CURRENCY_CODE.test(currency)) return "-";
  const amount = amountMinor / 10 ** currencyExponent(currency);
  return new Intl.NumberFormat(LOCALE[lang], { style: "currency", currency }).format(amount);
}

/** Czas w jednostce `Intl` (`unit`) z odmianą przez ICU - „5 miesięcy”, „1 day”. */
function formatDuration(value: number, unit: "month" | "day" | "hour" | "minute", lang: ChartLang) {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "unit",
    unit,
    unitDisplay: "long",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Wartość metryki w formacie właściwym dla jej jednostki.
 *
 * `opts.currency` jest WYMAGANE dla `money_minor`: liczba kanoniczna metryki
 * pieniężnej to kwota w walucie wiodącej, a sama liczba waluty nie niesie.
 * Bez waluty zwracamy `fallback`, nie kwotę w „domyślnej” walucie - zgadnięta
 * waluta to fałszywa kwota.
 */
export function formatMetricValue(
  value: number | null,
  unit: MetricUnit,
  lang: ChartLang,
  fallback = "-",
  opts?: { currency?: string },
): string {
  if (value === null || !Number.isFinite(value)) return fallback;
  const locale = LOCALE[lang];
  switch (unit) {
    case "ratio":
      // Wskaźniki trzymamy jako ułamek [0,1] i pokazujemy jako procent.
      return `${formatChartValue(value * 100, lang)} %`;
    case "milliseconds":
      return `${Math.round(value).toLocaleString(locale)} ms`;
    case "score":
      // CLS jest bezwymiarowy - trzy miejsca po przecinku, bez sufiksu.
      return value.toLocaleString(locale, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      });
    case "money_minor": {
      const currency = opts?.currency;
      if (!currency || !CURRENCY_CODE.test(currency)) return fallback;
      return formatMoneyMinor(value, currency, lang);
    }
    case "months":
      return formatDuration(value, "month", lang);
    case "days":
      return formatDuration(value, "day", lang);
    case "hours": {
      // Poniżej godziny czytelnik myśli w minutach („45 minut”, nie „0,8 godziny”) -
      // tak mierzy się czas reakcji na lead w benchmarkach. Próg po ZAOKRĄGLENIU:
      // 0,999 h to „1 godzina”, a nie „60 minut”.
      const minutes = Math.round(value * 60);
      return Math.abs(minutes) < 60
        ? formatDuration(minutes, "minute", lang)
        : formatDuration(value, "hour", lang);
    }
    case "multiple":
      // Krotność (Quick Ratio, LTV/CAC): liczba ze znakiem „×”, bez procentu -
      // „3,2×” czyta się jako „trzy razy więcej”, „320 %” jako przyrost.
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}×`;
    case "count":
    default:
      return Math.round(value).toLocaleString(locale);
  }
}

/** Rozjazd między strumieniami jako procent ze znakiem (ułamek na wejściu). */
export function formatSpread(spread: number | null, lang: ChartLang, fallback = "-"): string {
  if (spread === null || !Number.isFinite(spread)) return fallback;
  return `${formatChartValue(Math.abs(spread) * 100, lang)} %`;
}

/** Odchylenie ze znakiem (ułamek na wejściu) - „+18,4 %” / „-3,1 %”. */
export function formatSignedPct(fraction: number | null, lang: ChartLang, fallback = "-"): string {
  if (fraction === null || !Number.isFinite(fraction)) return fallback;
  const sign = fraction > 0 ? "+" : fraction < 0 ? "-" : "";
  return `${sign}${formatChartValue(Math.abs(fraction) * 100, lang)} %`;
}

/** Zmiana wobec okna poprzedniego - wejście już w punktach procentowych. */
export function formatDeltaPct(deltaPct: number | null, lang: ChartLang, fallback = "-"): string {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return fallback;
  return formatSignedPct(deltaPct / 100, lang, fallback);
}

/** Data z instantu ISO w formacie krótkim (`2026-07-14`) - bez strefy lokalnej. */
export function isoDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

/** Język wykresów/formatowania z kodu i18n (`pl-PL`, `en`, `en-GB`...). */
export function chartLangOf(language: string | undefined): ChartLang {
  return language?.toLowerCase().startsWith("en") ? "en" : "pl";
}
