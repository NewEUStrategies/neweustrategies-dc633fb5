/**
 * BI KPI tile: label + big value + delta chip vs previous period + sparkline
 * (+ opcjonalna skala przedziału), według systemu wykresów 2026-10:
 * zmiana jako ▲ ▼ ■ i procent w kolorze zależnym od KIERUNKU wskaźnika
 * (wzrost kosztu jest zły, więc ▲ przy koszcie ma kolor ujemny), iskra
 * 2 px w akcencie z kropką ostatniego punktu i pasmem optimum w tle.
 *
 * ISKRA JEST GLIFEM, NIE WYKRESEM, i dlatego nie idzie przez `<Chart>`.
 * Rysunek o wysokości czterdziestu pikseli nie ma osi, podziałek, legendy,
 * podpisu ani tabeli danych - a rama silnika dokłada je wszystkie, bo tak ma
 * wyglądać wykres. Iskra ma pokazać KSZTAŁT szeregu obok liczby, którą i tak
 * widać w kafelku; liczby są w tabeli panelu, do którego kafelek prowadzi.
 *
 * Geometrię i kolor bierze jednak Z SILNIKA: `pathFromPoints` daje tę samą
 * krzywą, co linia na dużym wykresie, a wypełnienie i obrys idą tokenem
 * palety. Iskra rysowana własną matematyką i własnym kolorem rozjechałaby się
 * z wykresem, który opisuje ten sam szereg.
 *
 * KAFEL Z REJESTRU WSKAŹNIKÓW (`metricId`, SPEC §5.5, §6.2). Każdy kafel huba
 * i BI niesie: ikonę objaśnienia przy etykiecie (`MetricExplainer`), ocenę
 * względem benchmarku albo JAWNY powód jej braku (`BenchmarkTierBadge`),
 * kwoty per waluta zamiast jednej liczby (`MoneyByCurrencyText`), odnośnik do
 * szczegółów (`drillHref`) i kafel zablokowany dla roli bez dostępu
 * (`LockedMetricTile`) - ta sama siatka, ta sama geometria.
 *
 * DELTA D9 (brief 04). Stary chip pisał „+∞” przy poprzednim okresie równym
 * zero i formatował procent `toFixed` w konwencji angielskiej także po
 * polsku. Kafle z `metricId` liczą deltę po nowemu: baza 0 = kreska z opisem
 * („brak porównania”), liczby przez `Intl` w języku kafla. Kafle bez
 * `metricId` zachowują dotychczasowy format do czasu Z-S6-01 (pięć asercji
 * `kpiTile.test.tsx` przypina stare zachowanie, a plik jest poza manifestem).
 */
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/Sparkline";
import { RangeScale } from "@/components/charts/RangeScale";
import {
  LockedMetricTile,
  type LockedReason,
} from "@/components/admin/revenue/atoms/LockedMetricTile";
import { MoneyByCurrencyText } from "@/components/admin/revenue/molecules/MoneyByCurrencyText";
import { BenchmarkTierBadge } from "@/components/admin/analytics/semantic/atoms/BenchmarkTierBadge";
import { MetricExplainer } from "@/components/admin/analytics/semantic/molecules/MetricExplainer";
import type { BenchmarkEvaluation } from "@/lib/analytics/semantic/benchmarks/evaluate";
import type { BenchContextSegment } from "@/lib/analytics/semantic/benchmarks/types";
import { metricHelp } from "@/lib/analytics/semantic/metricHelp";
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import { changeTone, changeToneColor } from "@/lib/charts/status";
import { formatSignedPercent, formatSignedValue, type ChartLang } from "@/lib/charts/format";
import { safeSourceUrl, type ChartSource } from "@/lib/charts/sources";
import { ROLE } from "@/lib/charts/roles";
import type { MoneyByCurrency } from "@/lib/revenue/money";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-charts";

export interface KpiTileProps {
  /**
   * Etykieta - napis albo węzeł (np. skrót z dopiskiem). Z `metricId` kafel
   * sam dokłada przy niej ikonę objaśnienia.
   */
  label: ReactNode;
  value: string;
  /** Numeric current value for delta computation (optional). */
  current?: number;
  /** Numeric previous-period value for delta computation. */
  previous?: number;
  /** Series for the sparkline (chronological). */
  series?: number[];
  /** When true (default), higher = green. Set false for metrics like SERP position or CLS. */
  higherIsBetter?: boolean;
  /** Optional small icon shown next to the label. */
  icon?: React.ReactNode;
  /** Suffix appended to delta text (e.g. "pp" for percentage points). */
  deltaSuffix?: string;
  /** Force delta rendering to be absolute rather than percentage. */
  absoluteDelta?: boolean;
  /**
   * Pasmo optimum (przedział oceny ZE ŹRÓDŁEM) w jednostkach `current` - tło
   * iskry i skala przedziału pod nią.
   */
  band?: { min: number; max: number } | null;
  /** Pokaż skalę przedziału; bez pasma pokazuje „brak benchmarku". */
  showScale?: boolean;
  /** Jednostka do podpowiedzi skali („ms", „%"). */
  unit?: string;
  lang?: ChartLang;
  /** Źródło przedziału - bez niego pasmo nie powinno być podane. */
  bandSource?: ChartSource | null;
  /** Wskaźnik z rejestru - ikona objaśnienia, nowa delta (D9) i nazwa kafla zablokowanego. */
  metricId?: MetricId;
  /** Ocena względem benchmarku (`evaluateMetric`) - poziom albo jawny powód braku. */
  benchmark?: BenchmarkEvaluation;
  /**
   * Kwoty per waluta zamiast `value` (`null` = brak danych). Kwot różnych
   * walut nigdy nie sumujemy.
   */
  money?: readonly MoneyByCurrency[] | null;
  /** Waluta na wierzchu listy kwot (filtr `?cur=`). */
  preferredCurrency?: string;
  /** Szczegóły w hubie (`/admin/revenue/<zakładka>[?…]`). */
  drillHref?: string;
  /** Rola bez dostępu - kafel zablokowany zamiast liczby. */
  lockedReason?: LockedReason;
  /** Liczebność próby - do objaśnienia (ocena wstrzymana przy n < 50). */
  n?: number;
  /** Segment danych - wybiera domyślny kontekst benchmarku w objaśnieniu. */
  segment?: BenchContextSegment;
  /** „Więcej” w objaśnieniu oddaje pełny widok wołającemu (np. `?metric=` w BI). */
  onOpenFull?: () => void;
  /** Dopisek pod oceną (np. werdykt uzgodnienia przychodu) - w przepływie, bez nakładania. */
  annotation?: ReactNode;
}

/** Dotychczasowy format delty (kafle bez `metricId`, przypięty w `kpiTile.test.tsx`). */
function formatDeltaLegacy(
  current: number,
  previous: number,
  absolute: boolean,
  suffix?: string,
): string {
  if (absolute) {
    const d = current - previous;
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}${suffix ?? ""}`;
  }
  if (previous === 0) return current === 0 ? "0%" : "+∞";
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/**
 * Delta D9: `null` przy bazie 0 (procent od zera nie istnieje - ani „+∞”, ani
 * „0%” nie jest prawdą), liczby przez `Intl` w języku kafla.
 */
export function formatDelta(
  current: number,
  previous: number,
  absolute: boolean,
  lang: ChartLang,
  suffix?: string,
): string | null {
  if (absolute) return `${formatSignedValue(current - previous, lang)}${suffix ?? ""}`;
  if (previous === 0) return null;
  return formatSignedPercent(((current - previous) / Math.abs(previous)) * 100, lang);
}

/** `drillHref` z zapytaniem rozbite na ścieżkę i `search` routera (bez sklejania adresu). */
function drillTarget(href: string): { to: string; search?: Record<string, string> } {
  const [to, query] = href.split("?", 2);
  if (!query) return { to };
  return { to, search: Object.fromEntries(new URLSearchParams(query)) };
}

export function KpiTile({
  label,
  value,
  current,
  previous,
  series,
  higherIsBetter = true,
  icon,
  deltaSuffix,
  absoluteDelta,
  band = null,
  showScale = false,
  unit = "",
  lang = "pl",
  bandSource = null,
  metricId,
  benchmark,
  money,
  preferredCurrency,
  drillHref,
  lockedReason,
  n,
  segment,
  onOpenFull,
  annotation,
}: KpiTileProps) {
  ensureShellI18n();
  // JEDEN hak bez `keyPrefix`, pełne klucze. Bramka `i18nKeyDrift.gate` wiąże
  // `t()` z NAJBLIŻSZYM poprzedzającym hakiem, więc dwa haki (z prefiksem
  // `charts` i bez) dawały fałszywy brak klucza, a `t()` nie byłby
  // w ogóle skanowany - klucz z literówką przeszedłby bramkę.
  const { t } = useTranslation();
  // Nazwa kafla jako napis - dla kafla zablokowanego i odnośnika szczegółów.
  // Etykieta-węzeł nie ma tekstu, więc bierzemy rozwinięcie z rejestru.
  const labelText =
    typeof label === "string" ? label : metricId ? metricHelp(metricId, lang).expansion : "";

  if (lockedReason) return <LockedMetricTile label={labelText} reason={lockedReason} />;

  const sourceUrl = bandSource ? safeSourceUrl(bandSource.url) : null;
  const hasDelta =
    typeof current === "number" &&
    typeof previous === "number" &&
    Number.isFinite(current) &&
    Number.isFinite(previous);
  const dir = hasDelta ? Math.sign(current - previous) : 0;
  // Strzałka koduje KIERUNEK (znak delty), kolor koduje OCENĘ. Rozdzielenie
  // kanałów jest konieczne przy `higherIsBetter: false` (pozycja w SERP-ach,
  // CLS, LCP): tam wzrost jest zły, ale nadal jest wzrostem.
  const tone = changeTone(dir === 0 ? 0 : dir, higherIsBetter ? "higher" : "lower");
  const arrow = dir === 0 ? "■" : dir > 0 ? "▲" : "▼";
  const delta = hasDelta
    ? metricId
      ? formatDelta(current, previous, Boolean(absoluteDelta), lang, deltaSuffix)
      : formatDeltaLegacy(current, previous, Boolean(absoluteDelta), deltaSuffix)
    : null;
  const drill = drillHref ? drillTarget(drillHref) : null;

  return (
    <Card className="p-3 relative overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        {/* PARA ETYKIETA-WARTOŚĆ, nie dwa luźne napisy. `role="term"` i
            `role="definition"` wiążą je w drzewie dostępności (WCAG 1.3.1):
            na pulpicie z sześcioma kafelkami czytnik ekranu ogłasza sześć par,
            a nie dwanaście niepowiązanych węzłów tekstowych. Role są dołożone
            OBOK istniejących `<div>`-ów i klas układu (`min-w-0` plus kolejność
            dzieci), bo na nich wisi kilkadziesiąt asercji KPI w pulpitach. */}
        <div className="min-w-0">
          <div
            role="term"
            className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"
          >
            {icon}
            <span className="truncate">{label}</span>
            {metricId ? (
              <MetricExplainer
                metricId={metricId}
                lang={lang}
                mode="short"
                value={typeof current === "number" ? current : undefined}
                n={n}
                segment={segment}
                currency={preferredCurrency ?? money?.[0]?.currency}
                onOpenFull={onOpenFull}
                className="normal-case tracking-normal"
              />
            ) : null}
          </div>
          <div role="definition" className="text-xl font-semibold tabular-nums mt-1 leading-tight">
            {money !== undefined ? (
              <MoneyByCurrencyText amounts={money} preferred={preferredCurrency} lang={lang} />
            ) : (
              value
            )}
          </div>
        </div>
        {hasDelta ? (
          delta === null ? (
            // Baza 0: kreska z opisem - procent od zera nie istnieje (D9).
            <div
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-muted/60 tabular-nums"
              style={{ color: changeToneColor("neutral") }}
              data-tone="neutral"
              data-delta="no-baseline"
              title={t("adminRevenue.benchmark.kpi.noBaseline", { lng: lang })}
            >
              <span data-role="delta-value" aria-hidden="true">
                -
              </span>
              <span className="sr-only">
                {t("adminRevenue.benchmark.kpi.noBaseline", { lng: lang })}
              </span>
            </div>
          ) : (
            <div
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-muted/60 tabular-nums"
              style={{ color: changeToneColor(tone) }}
              data-tone={tone}
            >
              <span aria-hidden data-arrow={arrow}>
                {arrow}
              </span>
              <span data-role="delta-value">{delta}</span>
            </div>
          )
        ) : null}
      </div>
      {benchmark ? (
        <div className="mt-1.5">
          <BenchmarkTierBadge evaluation={benchmark} lang={lang} />
        </div>
      ) : null}
      {annotation ? <div className="mt-1.5">{annotation}</div> : null}
      {series && series.length >= 2 ? (
        <div className="mt-2">
          <Sparkline values={series} band={band} />
        </div>
      ) : null}
      {showScale ? (
        <RangeScale
          value={typeof current === "number" && Number.isFinite(current) ? current : null}
          band={band}
          direction={higherIsBetter ? "higher" : "lower"}
          unit={unit}
          lang={lang}
        />
      ) : null}
      {showScale && band && bandSource ? (
        <p className="mt-1.5 mb-0 text-[11px] leading-snug" style={{ color: ROLE.ink3 }}>
          {t("charts.kpi.bandSource", { lng: lang })}:{" "}
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {bandSource.title}
            </a>
          ) : (
            bandSource.title
          )}
          {bandSource.container ? `, ${bandSource.container}` : ""}
          {bandSource.reliability ? ` (${bandSource.reliability})` : ""}
        </p>
      ) : null}
      {drill ? (
        <Link
          to={drill.to}
          search={drill.search}
          aria-label={t("adminRevenue.benchmark.kpi.drill", { name: labelText, lng: lang })}
          className="absolute right-1.5 bottom-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-drill={drillHref}
        >
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </Card>
  );
}
