/**
 * Dashboard telemetrii błędów przeglądarki (client_errors).
 *
 * Domyka pętlę obserwowalności obok RUM: ta sama estetyka BI co Web Vitals
 * (KpiTile + ChartCard + TimeRangeFilter), dane z getClientErrorsReport
 * (server function; service role za bramką admina, tenant-scoped).
 *
 * Sekcje:
 *  1. KPI: błędy w oknie (ze sparkline'em dziennym), unikalne problemy,
 *     dotknięte ścieżki, ostatnie 24 h.
 *  2. Trend dzienny (bar) z eksportem CSV.
 *  3. Problemy wg częstości: grupy po znormalizowanym komunikacie,
 *     rozwijane do stacka, ścieżek i metadanych.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  FileWarning,
  Loader2,
  RefreshCw,
  Route as RouteIcon,
} from "lucide-react";
import type { EChartsCoreOption } from "echarts/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useCurrentTenantId } from "@/lib/tenant";
import { getClientErrorsReport } from "@/lib/observability/clientErrors.functions";
import type { ClientErrorGroup } from "@/lib/observability/clientErrorsAggregate";
import { ChartCard } from "./ChartCard";
import { KpiTile } from "./KpiTile";
import { TimeRangeFilter, buildPresetRange, type TimeRangeValue } from "./TimeRangeFilter";

/**
 * Wartość kafelka KPI, gdy POMIARU NIE MA. Zero na pulpicie błędów czyta się
 * jako twierdzenie „aplikacja nie sypie", a takiego twierdzenia nie wolno
 * postawić ani przed dojechaniem raportu, ani po odrzuceniu odczytu.
 */
const NO_VALUE = "-";

export function ClientErrorsDashboard() {
  const { t, i18n } = useTranslation();
  const fetchReport = useServerFn(getClientErrorsReport);
  const tenantId = useCurrentTenantId();
  const [range, setRange] = useState<TimeRangeValue>(() => buildPresetRange("7d"));

  const reportQuery = useQuery({
    // NAJEMCA W KLUCZU, nie tylko granice okna. Bez niego izolację warsztatów
    // trzymał wyłącznie znacznik z `Date.now()` w `buildPresetRange`: dwa
    // panele policzone w tej samej chwili (przełączenie warsztatu w jednej
    // klatce, zamrożony zegar, dwa pulpity na to samo okno) dostawały ten sam
    // wpis cache, a przy `staleTime` react-query nie ponawiał zapytania -
    // administrator warsztatu B czytał komunikaty i stacki warsztatu A, i to
    // bez ani jednego żądania w sieci.
    queryKey: ["admin", "client-errors", tenantId ?? "", range.sinceIso, range.untilIso],
    queryFn: () => fetchReport({ data: { sinceIso: range.sinceIso, untilIso: range.untilIso } }),
    // Odczyt puszczony przed rozwiązaniem najemcy wpadłby do cache pod kluczem
    // z pustym warsztatem - czyli pod kluczem WSPÓLNYM dla wszystkich.
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const report = reportQuery.data;
  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";

  // TRZY STANY ROZDZIELONE NA WEJŚCIU, raz dla całego panelu.
  // „Pomiar w toku" to także nierozwiązany najemca: zapytanie jest wtedy
  // wstrzymane, więc `isLoading` z react-query jest fałszem, a panel nadal nie
  // ma CZEGO pokazać. Kolejność gałęzi niżej jest istotna: pomiar wyprzedza
  // awarię, bo `error` z poprzedniego okna przeżywa start nowego zapytania.
  const isMeasuring = !tenantId || reportQuery.isLoading;
  const readError = reportQuery.isError ? reportQuery.error : null;
  const readReason =
    readError instanceof Error && readError.message
      ? readError.message
      : t("adminAnalytics.common.unknownReason");
  /** Pomiar się ODBYŁ - dopiero teraz liczby na kafelkach są twierdzeniem o danych. */
  const measured = !isMeasuring && readError === null && report !== undefined;
  const kpi = (value: number | undefined): string =>
    measured ? (value ?? 0).toLocaleString(locale) : NO_VALUE;

  const trendOption = useMemo<EChartsCoreOption>(() => {
    const days = report?.daily ?? [];
    return {
      grid: { left: 44, right: 16, top: 24, bottom: 28, containLabel: true },
      xAxis: {
        type: "category",
        data: days.map((d) => d.day.slice(5)),
      },
      yAxis: { type: "value", minInterval: 1 },
      series: [
        {
          name: t("adminAnalytics.clientErrors.trendSeries"),
          type: "bar",
          barMaxWidth: 26,
          itemStyle: { borderRadius: [4, 4, 0, 0], color: "#dc2626" },
          data: days.map((d) => d.count),
        },
      ],
    };
  }, [report, t]);

  const kpiSeries = useMemo(() => (report?.daily ?? []).map((d) => d.count), [report]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TimeRangeFilter value={range} onChange={setRange} />
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void reportQuery.refetch()}
          disabled={reportQuery.isFetching}
        >
          {reportQuery.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {t("adminAnalytics.common.refresh")}
        </Button>
      </div>

      {report?.capped && (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t("adminAnalytics.clientErrors.cappedNote", {
            cap: report.total.toLocaleString(locale),
            total: report.windowTotal.toLocaleString(locale),
          })}
        </div>
      )}

      {/* TRZY STANY, TRZY KOMUNIKATY - nie jeden na wszystko. „Brak błędów w
          wybranym oknie. To dobrze (...)" jest TWIERDZENIEM O POMIARZE i wolno
          je postawić dopiero wtedy, gdy pomiar się odbył. Bramka roli w server
          function RZUCA (`Forbidden: admin role required`), więc bez tej
          gałęzi odmowa dostępu meldowała się jako dobra wiadomość: panel
          zapewniał, że telemetria działa, w chwili gdy nie miał do niej
          dostępu. Awaria niesie PRZYCZYNĘ i `role="alert"`, bo to jedyna
          informacja, z którą operator może cokolwiek zrobić. */}
      {isMeasuring ? (
        <Card className="space-y-1 p-4 text-sm text-muted-foreground">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("adminAnalytics.common.measuring")}
          </div>
          <p className="text-xs">{t("adminAnalytics.common.measuringHint")}</p>
        </Card>
      ) : readError !== null ? (
        <Card role="alert" className="space-y-1 border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", { reason: readReason })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiTotal")}
          value={kpi(report?.windowTotal)}
          series={kpiSeries}
          higherIsBetter={false}
          icon={<Bug className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiGroups")}
          value={kpi(report?.uniqueGroups)}
          higherIsBetter={false}
          icon={<FileWarning className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiPaths")}
          value={kpi(report?.affectedPaths)}
          higherIsBetter={false}
          icon={<RouteIcon className="h-3.5 w-3.5" aria-hidden />}
        />
        <KpiTile
          label={t("adminAnalytics.clientErrors.kpiLast24h")}
          value={kpi(report?.last24h)}
          higherIsBetter={false}
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
        />
      </div>

      <ChartCard
        title={t("adminAnalytics.clientErrors.trendTitle")}
        subtitle={t("adminAnalytics.clientErrors.trendSubtitle")}
        option={trendOption}
        height={240}
        csv={{
          filename: "client-errors-daily",
          headers: ["day", "count"],
          rows: (report?.daily ?? []).map((d) => [d.day, d.count]),
        }}
      />

      <Card className="p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">{t("adminAnalytics.clientErrors.groupsTitle")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.clientErrors.groupsSubtitle")}
          </p>
        </div>
        {/* Stan panelu jest zameldowany RAZ, kartą wyżej - lista grup nie
            dopisuje do niego drugiego komunikatu i nie maluje pustki jako
            wyniku. Zmierzone zero zostaje tutaj, bo dotyczy właśnie tej listy. */}
        {isMeasuring || readError !== null ? null : !report || report.groups.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            {t("adminAnalytics.clientErrors.empty")}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {report.groups.map((group) => (
              <ErrorGroupRow
                key={group.fingerprint}
                group={group}
                sampleTotal={Math.max(1, report.total)}
                locale={locale}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function ErrorGroupRow({
  group,
  sampleTotal,
  locale,
}: {
  group: ClientErrorGroup;
  /** Mianownik udziału: liczba PRÓBEK po cap-ie (`report.total`), nie `windowTotal`. */
  sampleTotal: number;
  locale: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const share = Math.round((group.count / sampleTotal) * 100);
  const count = group.count.toLocaleString(locale);
  const sources = group.sources.map((source) => ({
    source,
    // Nieznane źródło zostaje surowe - surowa ścieżka klucza i18n na ekranie
    // administratora nie mówi nic, a nazwa techniczna kanału już tak.
    label: t(`adminAnalytics.clientErrors.sourceLabels.${source}`, { defaultValue: source }),
  }));
  const lastSeen = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(group.lastSeen));
  const firstSeen = new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(group.firstSeen));

  return (
    <li className="py-2.5">
      {/* WIERSZ TO PARY NAZWA-WARTOŚĆ, nie płaska siatka `span`-ów. Relacja
          nazwa-wartość była tu wcześniej obecna WYŁĄCZNIE wizualnie (kolumny
          siatki, wyrównanie, znak procentu), a programowo nie istniała: ani
          jednego `role`, ani jednej pary `<dt>`/`<dd>`, zero `aria-label` -
          czytnik ekranu ogłaszał „trzy" i „pięćdziesiąt procent" bez
          informacji, CZEGO te liczby są (WCAG 2.2 SC 1.3.1). Nazwy pól idą ze
          słownika (`colMessage`/`colCount`/`colShare`/`colSources`) i są
          `sr-only`, bo w wierszu jednej listy nagłówek kolumny nie ma gdzie
          stanąć wizualnie - a `sr-only` jest pozycjonowane absolutnie, więc nie
          zajmuje komórek siatki.
          WYZWALACZ JEST OSOBNYM ELEMENTEM rozciągniętym na cały wiersz
          (`absolute inset-0`), a nie opakowaniem danych: drzewo dostępności
          spłaszcza wnętrze przycisku do jednego napisu, więc pary nazwa-wartość
          schowane w jego wnętrzu nie dotarłyby do czytnika ekranu. Klikalny
          pozostaje cały wiersz. */}
      <div className="relative">
        <dl className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 pr-6 text-left sm:grid-cols-[minmax(0,1fr)_90px_120px_auto]">
          <dt className="sr-only">{t("adminAnalytics.clientErrors.colMessage")}</dt>
          <dd className="min-w-0 truncate font-mono text-xs" title={group.message}>
            {group.message}
          </dd>

          <dt className="sr-only">{t("adminAnalytics.clientErrors.colCount")}</dt>
          <dd className="justify-self-end text-sm font-semibold tabular-nums">{count}</dd>

          <dt className="sr-only">{t("adminAnalytics.clientErrors.colShare")}</dt>
          <dd className="col-span-2 flex items-center gap-2 sm:col-span-1">
            {/* Pasek POWTARZA procent obok - jest ilustracją, nie treścią. */}
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span
                className="block h-full rounded-full bg-destructive/70"
                style={{ width: `${Math.max(2, share)}%` }}
              />
            </span>
            <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
              {share}%
            </span>
          </dd>

          {sources.length > 0 && (
            <>
              <dt className="sr-only">{t("adminAnalytics.clientErrors.colSources")}</dt>
              {/* ŹRÓDŁA ZAWIJAJĄ SIĘ, a nie gasną. Wcześniej stały w
                  kontenerze `hidden ... sm:flex`, czyli poniżej 640 px
                  wypadały z układu I z drzewa dostępności - na telefonie nie
                  było ŻADNEJ drogi do informacji, czy błąd przyszedł z
                  `onerror`, czy z odrzuconej obietnicy, a to ona rozstrzyga,
                  gdzie szukać przyczyny (WCAG 2.2 SC 1.4.10 Reflow: przy
                  320 px treść nie może zniknąć bez zamiennika). */}
              <dd className="col-span-2 flex flex-wrap items-center gap-1 sm:col-span-1">
                {sources.map(({ source, label }) => (
                  <Badge
                    key={source}
                    variant="outline"
                    className="px-1.5 py-0 text-[10px] font-normal"
                  >
                    {label}
                  </Badge>
                ))}
              </dd>
            </>
          )}
        </dl>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          // Nazwa wyzwalacza IDENTYFIKUJE WIERSZ, którego szczegóły otwiera -
          // bez niej trzy przyciski na liście nazywałyby się tak samo. Liczby
          // zostają w parach `<dt>`/`<dd>` powyżej, więc nie są ogłaszane
          // dwukrotnie.
          aria-label={group.message}
          title={
            open
              ? t("adminAnalytics.clientErrors.collapse")
              : t("adminAnalytics.clientErrors.expand")
          }
          className="absolute inset-0 flex items-center justify-end rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2 rounded-md bg-muted/40 p-3 text-xs">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            <span>
              {t("adminAnalytics.clientErrors.firstSeen")}:{" "}
              <span className="tabular-nums text-foreground">{firstSeen}</span>
            </span>
            <span>
              {t("adminAnalytics.clientErrors.colLastSeen")}:{" "}
              <span className="tabular-nums text-foreground">{lastSeen}</span>
            </span>
          </div>
          {group.topPaths.length > 0 && (
            <div>
              <div className="mb-1 font-medium">{t("adminAnalytics.clientErrors.topPaths")}</div>
              <ul className="space-y-0.5">
                {group.topPaths.map((p) => (
                  <li key={p.path} className="flex items-center gap-2">
                    <code className="min-w-0 truncate font-mono text-[11px]">{p.path}</code>
                    <span className="tabular-nums text-muted-foreground">×{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="mb-1 font-medium">{t("adminAnalytics.clientErrors.stack")}</div>
            {group.sampleStack ? (
              <pre className="max-h-56 overflow-auto rounded bg-background p-2 font-mono text-[11px] leading-relaxed">
                {group.sampleStack}
              </pre>
            ) : (
              <p className="text-muted-foreground">{t("adminAnalytics.clientErrors.noStack")}</p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
