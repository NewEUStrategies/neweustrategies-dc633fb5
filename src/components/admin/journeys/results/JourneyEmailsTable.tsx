// Tabela maili ścieżki (S8, SPEC §6.3 „Wyniki”) - wysyłki każdego kroku
// `send_email` w oknie: kolejka, wysłane, otwarcia ludzkie, kliknięcia, CTOR,
// wypisy, odbicia, skargi i wersja polska zamiast angielskiej.
//
// OCENY WYŁĄCZNIE Z REJESTRU S6. Wskaźnik maila (otwarcia, kliknięcia, CTOR,
// wypisy, odbicia, skargi) dostaje `BenchmarkTierBadge` z oceną liczoną
// `evaluateMetricValue` na wpisie wskazanym przez `journeyBenchmarkRefs` -
// panel nie zna żadnej liczby z badań. Brak oceny ma powód słowem (mała
// próba, brak danych), nie szare kropki.
//
// MPP (Z-S5-06). Otwarcia ludzkie i CTOR to GÓRNA GRANICA: Apple Mail Privacy
// Protection otwiera maile sam, a próg czasu odsiewa tylko część takich
// otwarć. Nagłówki tych kolumn niosą dymek z wyjaśnieniem, a CTOR - dopisek,
// że rejestr ma benchmark wyłącznie kampanii (ścieżki zwykle wypadają wyżej).
//
// KROK BEZ WYSYŁEK TO KRESKA, NIE ZERA. Mail bez wiersza statystyk w oknie
// dostaje jeden opis „brak wysyłek w oknie” zamiast rzędu zer, które
// czytałyby się jak wysłany mail bez otwarć.
//
// DOSTĘPNOŚĆ: `caption`, `scope` kolumn i wierszy, przewijany region
// z `tabIndex=0` i nazwą (wąski ekran bez poziomego paska strony), dymek MPP
// na przycisku 24 px dostępnym z klawiatury.
import { useCallback, useMemo } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";

import { BenchmarkTierBadge } from "@/components/admin/analytics/semantic/atoms/BenchmarkTierBadge";
import {
  evaluateMetricValue,
  useBenchmark,
} from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  journeyBenchmarkRefs,
  type JourneyEmailRow,
  type JourneyRateMetric,
} from "@/lib/admin/journeys/results";
import type { BenchmarkEvaluation } from "@/lib/analytics/semantic/benchmarks/evaluate";
import { chartLangFrom, formatPercent, type ChartLang } from "@/lib/charts/format";
import { formatNumber } from "@/lib/i18n/format";
import { ensureI18n as ensureJourneysI18n } from "@/lib/i18n-admin-journeys";
import { ensureI18n } from "@/lib/i18n-admin-journeys-results";

/** Ocena wskaźnika ścieżki; `null`, dopóki rejestr się wczytuje (bez mrugnięcia „brak benchmarku”). */
export type JourneyRateEvaluator = (
  metric: JourneyRateMetric,
  value: number | null,
  n: number,
) => BenchmarkEvaluation | null;

/**
 * Oceny wskaźników ścieżki z rejestru S6. Wszystkie wpisy leżą w grupie
 * `email`, więc siedem haków to JEDNO zapytanie (klucz per grupa i język).
 */
export function useJourneyBenchmarks(
  templateKey: string | null | undefined,
  lang: ChartLang,
  enabled = true,
): JourneyRateEvaluator {
  const refs = useMemo(() => journeyBenchmarkRefs(templateKey), [templateKey]);
  const open = useBenchmark({ benchKey: refs.openRate.benchKey, lang, enabled });
  const click = useBenchmark({ benchKey: refs.clickRate.benchKey, lang, enabled });
  const goal = useBenchmark({ benchKey: refs.goalRate.benchKey, lang, enabled });
  const ctor = useBenchmark({ benchKey: refs.ctor.benchKey, lang, enabled });
  const unsubscribe = useBenchmark({ benchKey: refs.unsubscribeRate.benchKey, lang, enabled });
  const bounce = useBenchmark({ benchKey: refs.bounceRate.benchKey, lang, enabled });
  const complaint = useBenchmark({ benchKey: refs.complaintRate.benchKey, lang, enabled });

  return useCallback(
    (metric, value, n) => {
      const result = {
        openRate: open,
        clickRate: click,
        goalRate: goal,
        ctor,
        unsubscribeRate: unsubscribe,
        bounceRate: bounce,
        complaintRate: complaint,
      }[metric];
      if (result.status !== "ready" && result.status !== "none") return null;
      const ref = refs[metric];
      return evaluateMetricValue(ref.metricId, value, result.bench, { n, ctxId: ref.ctxId });
    },
    [refs, open, click, goal, ctor, unsubscribe, bounce, complaint],
  );
}

/** Dymek „górna granica - Apple MPP” na przycisku 24 px (fokus z klawiatury). */
export function JourneyMppHint() {
  ensureI18n();
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t("adminJourneys.results.emails.mppLabel")}
          data-mpp-hint=""
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("adminJourneys.results.emails.mppBody")}</TooltipContent>
    </Tooltip>
  );
}

/** Liczba z udziałem i oceną - wspólna komórka tabeli i panelu kroku. */
export function JourneyRateValue({
  count,
  rate,
  evaluation,
  lang,
}: {
  count: number | null;
  rate: number | null;
  evaluation: BenchmarkEvaluation | null;
  lang: ChartLang;
}) {
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="tabular-nums">
        {count === null ? "—" : formatNumber(count, lang)}
        {rate === null ? null : (
          <span className="ml-1 text-muted-foreground">{formatPercent(rate, lang)}</span>
        )}
      </span>
      {evaluation ? <BenchmarkTierBadge evaluation={evaluation} lang={lang} /> : null}
    </span>
  );
}

export interface JourneyEmailsTableProps {
  rows: readonly JourneyEmailRow[];
  /** Szablon ścieżki - wybiera wpisy rejestru (porzucona kasa ma własne). */
  templateKey: string | null;
  /** Temat maila (wariant A) po identyfikatorze kroku. */
  subjects?: ReadonlyMap<string, string>;
  /** Nazwa kroku w wierszu („Krok 3: Wyślij e-mail”) - ta sama co w lejku. */
  stepLabel: (row: JourneyEmailRow) => string;
}

export function JourneyEmailsTable({
  rows,
  templateKey,
  subjects,
  stepLabel,
}: JourneyEmailsTableProps) {
  ensureJourneysI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const evaluate = useJourneyBenchmarks(templateKey, lang, rows.length > 0);

  if (rows.length === 0) {
    return (
      <p className="m-0 text-sm text-muted-foreground">{t("adminJourneys.results.emails.empty")}</p>
    );
  }

  const number = (value: number) => formatNumber(value, lang);

  return (
    <div
      role="region"
      aria-label={t("adminJourneys.results.emails.scrollRegion")}
      tabIndex={0}
      className="overflow-x-auto rounded-[6px] border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[1080px] text-left text-xs">
        <caption className="sr-only">{t("adminJourneys.results.emails.caption")}</caption>
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              {t("adminJourneys.results.emails.columns.step")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.queued")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.sent")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              <span className="inline-flex items-center gap-0.5">
                {t("adminJourneys.results.emails.columns.humanOpens")}
                <JourneyMppHint />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.clicks")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              <span className="inline-flex items-center gap-0.5">
                {t("adminJourneys.results.emails.columns.ctor")}
                <JourneyMppHint />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.unsubscribed")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.bounced")}
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              {t("adminJourneys.results.emails.columns.complained")}
            </th>
            <th
              scope="col"
              className="px-3 py-2 text-right font-medium"
              title={t("adminJourneys.results.emails.fallbackHint")}
            >
              {t("adminJourneys.results.emails.columns.fallbackLocale")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const subject = subjects?.get(row.nodeId) ?? null;
            const { email, rates } = row;
            return (
              <tr key={row.nodeId} data-node-id={row.nodeId} className="border-t border-border">
                <th scope="row" className="px-3 py-2 align-top font-normal">
                  <span className="block font-medium text-foreground">{stepLabel(row)}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {subject ?? t("adminJourneys.results.emails.subjectMissing")}
                  </span>
                </th>
                {email && rates ? (
                  <>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(email.queued)}
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(email.sent)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <JourneyRateValue
                        count={email.uniqueHumanOpens}
                        rate={rates.openRate}
                        evaluation={evaluate("openRate", rates.openRate, rates.delivered)}
                        lang={lang}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <JourneyRateValue
                        count={email.uniqueClicks}
                        rate={rates.clickRate}
                        evaluation={evaluate("clickRate", rates.clickRate, rates.delivered)}
                        lang={lang}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <span className="tabular-nums">
                          {rates.ctor === null ? "—" : formatPercent(rates.ctor, lang)}
                        </span>
                        <CtorBadge
                          evaluation={evaluate("ctor", rates.ctor, email.uniqueHumanOpens)}
                          lang={lang}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <JourneyRateValue
                        count={email.unsubscribed}
                        rate={rates.unsubscribeRate}
                        evaluation={evaluate(
                          "unsubscribeRate",
                          rates.unsubscribeRate,
                          rates.delivered,
                        )}
                        lang={lang}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <JourneyRateValue
                        count={email.bounced}
                        rate={rates.bounceRate}
                        evaluation={evaluate("bounceRate", rates.bounceRate, email.sent)}
                        lang={lang}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <JourneyRateValue
                        count={email.complained}
                        rate={rates.complaintRate}
                        evaluation={evaluate("complaintRate", rates.complaintRate, rates.delivered)}
                        lang={lang}
                      />
                    </td>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {number(email.fallbackLocale)}
                    </td>
                  </>
                ) : (
                  <td colSpan={9} className="px-3 py-2 align-top text-muted-foreground">
                    {t("adminJourneys.results.emails.noSends")}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Ocena CTOR z dopiskiem, że rejestr zna wyłącznie benchmark kampanii. */
export function CtorBadge({
  evaluation,
  lang,
}: {
  evaluation: BenchmarkEvaluation | null;
  lang: ChartLang;
}) {
  ensureI18n();
  const { t } = useTranslation();
  if (!evaluation) return null;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <BenchmarkTierBadge evaluation={evaluation} lang={lang} />
      <span className="max-w-[160px] text-[10px] leading-tight text-muted-foreground">
        {t("adminJourneys.results.emails.campaignBench")}
      </span>
    </span>
  );
}
