// Dashboard "Audytorium / retencja" - segmentacja zalogowani vs anonimowi.
// Reużywa ChartCard, InsightSection, Card, Select z projektu.
//
// STANY, KTÓRE NIE SĄ POMIAREM. Panel rozdziela „trwa pomiar", „odczyt padł"
// i „okno zostało odczytane i jest w nim pusto". Do 2026-09-02 wszystkie trzy
// kończyły się TYM SAMYM obrazem - czterema kafelkami z zerem i zieloną kartą
// „nie znaleziono krytycznych zagadnień" - więc awaria odczytu tabeli
// `post_views` meldowała się jako dobra wiadomość o treści, a administrator
// szukał problemu w ruchu. Dziś na miejsce liczby wchodzi napis o stanie
// (`common.measuringShort` / `common.readFailedShort`), nad siatką staje karta
// stanu (`role="status"` w pomiarze, `role="alert"` z przyczyną po awarii),
// a lista wniosków NIGDY nie jest pusta z powodu braku danych - inaczej
// `InsightSection` zaliczyłby audyt przed audytem. Zmierzone zero ma własny
// wniosek (`insights.empty`), a listy „Top ..." dobierają napis pustej listy do
// STANU: `common.noDataWindow` znaczy zmierzone zero i wolno go postawić dopiero
// po udanym odczycie - prowadzi do innej decyzji („popraw dystrybucję") niż
// awaria („sprawdź źródło").
//
// IZOLACJA WARSZTATÓW. Klucz react-query niesie identyfikator najemcy, a
// zapytanie jest wstrzymane do jego rozwiązania. Bez tego dwa montowania z tym
// samym oknem trafiały w JEDEN wpis cache i przy `staleTime: 60_000` warsztat B
// czytał tytuły wpisów warsztatu A - bez ani jednego żądania w sieci.
//
// LICZBY IDĄ PRZEZ LOCALE INTERFEJSU, nie przez zaszyte `pl-PL` (tak samo jak
// w `ClientErrorsDashboard` i `FooterAnalyticsPanel`) - angielski administrator
// ma widzieć "12,345" tam, gdzie polski widzi "12 345".
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "@/lib/i18n-admin-analytics";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, UserCheck, UserX, Eye, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EChartsCoreOption } from "echarts/core";
import { useCurrentTenantId } from "@/lib/tenant";
import { ChartCard } from "./ChartCard";
import { InsightSection, type Insight } from "./InsightSection";
import {
  getAudienceSegments,
  type AudienceSegmentsResult,
} from "@/lib/analytics/audience.functions";

const RANGES: ReadonlyArray<{ v: number; lKey: string }> = [
  { v: 7, lKey: "adminAnalytics.timeRange.preset7d" },
  { v: 30, lKey: "adminAnalytics.timeRange.preset30d" },
  { v: 90, lKey: "adminAnalytics.timeRange.preset90d" },
];

interface KpiCardProps {
  label: string;
  /**
   * GOTOWY NAPIS, nie liczba. W stanach bez pomiaru na miejsce wartości wchodzi
   * komunikat o stanie, bo zero na pulpicie audytorium czyta się jako
   * twierdzenie o ruchu - a takiego twierdzenia nie wolno postawić przed
   * odczytem ani po jego awarii.
   */
  value: string;
  hint?: string;
  Icon: typeof Users;
  tone: "brand" | "logged" | "anon";
}

function KpiCard({ label, value, hint, Icon, tone }: KpiCardProps) {
  const toneClass =
    tone === "logged"
      ? "bg-cat-finance/10 text-cat-finance border-cat-finance/30"
      : tone === "anon"
        ? "bg-cat-transport/10 text-cat-transport border-cat-transport/30"
        : "bg-brand-ink/10 text-brand-ink border-brand-ink/30";
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-2 text-2xl font-display">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function AudienceSegmentsDashboard() {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const fetchAudience = useServerFn(getAudienceSegments);
  const tenantId = useCurrentTenantId();
  // Locale liczb bierze się z JĘZYKA INTERFEJSU. Zaszyte "pl-PL" dawało
  // angielskiemu administratorowi polskie grupowanie tysięcy.
  const locale = i18n.language === "en" ? "en-GB" : "pl-PL";

  const q = useQuery<AudienceSegmentsResult>({
    // NAJEMCA W KLUCZU. Bez niego dwa montowania z domyślnym oknem 30 dni
    // trafiały w ten sam wpis cache, a `staleTime` blokował ponowienie -
    // warsztat B dostawał tytuły wpisów warsztatu A i to bez ani jednego
    // żądania sieciowego, więc wyciek był niewidoczny w ruchu.
    queryKey: ["admin", "audience-segments", tenantId ?? "", days],
    queryFn: () => fetchAudience({ data: { days } }),
    // Odczyt puszczony przed rozwiązaniem najemcy wpadłby do cache pod kluczem
    // z pustym warsztatem i stamtąd przeciekał dalej.
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const report = q.data;
  // POMIAR W TOKU to także nierozwiązany najemca: zapytanie jest wtedy
  // wstrzymane, więc `isLoading` z react-query jest fałszywe, a panel nadal nie
  // ma CZEGO pokazać.
  const isMeasuring = !tenantId || q.isLoading;
  const readError = q.error;
  const readReason =
    readError instanceof Error && readError.message.trim()
      ? readError.message
      : t("adminAnalytics.common.unknownReason");

  /**
   * Napis, który staje NA MIEJSCU liczby, kiedy pomiaru nie ma.
   *
   * `null` znaczy „mamy pomiar" - tylko wtedy kafelek dostaje liczbę.
   * Kolejność gałęzi jest istotna: pomiar w toku wyprzedza awarię, bo `error`
   * z poprzedniego okna przeżywa start nowego zapytania.
   */
  const kpiPlaceholder: string | null = isMeasuring
    ? t("adminAnalytics.common.measuringShort")
    : readError
      ? t("adminAnalytics.common.readFailedShort")
      : null;

  /** Liczba z raportu albo napis o stanie - nigdy zero „na wszelki wypadek". */
  const kpiText = (value: number | undefined): string =>
    kpiPlaceholder ??
    (value === undefined
      ? t("adminAnalytics.common.measuringShort")
      : value.toLocaleString(locale));

  /**
   * Napis pustej listy „Top ...". `common.noDataWindow` znaczy ZMIERZONE ZERO
   * (patrz nagłówek słownika), więc wypisany przed odczytem albo po jego awarii
   * twierdzi o oknie pomiarowym coś, czego nikt nie sprawdził - i to tuż obok
   * kafelków, które o tym samym stanie mówią już uczciwie.
   */
  const listEmptyLabel = isMeasuring
    ? t("adminAnalytics.common.measuring")
    : readError
      ? t("adminAnalytics.common.readFailed")
      : t("adminAnalytics.common.noDataWindow");

  const uniqueHint = (value: number | undefined): string | undefined =>
    value === undefined || kpiPlaceholder !== null
      ? undefined
      : t("adminAnalytics.audience.uniqueHint", { count: value });

  const chartOption = useMemo<EChartsCoreOption>(() => {
    const series = report?.series ?? [];
    const dates = series.map((s) => s.day);
    const logged = series.map((s) => s.logged);
    const anon = series.map((s) => s.anon);
    return {
      tooltip: { trigger: "axis" },
      legend: {
        data: [t("adminAnalytics.audience.logged"), t("adminAnalytics.audience.anon")],
        top: 0,
      },
      grid: { top: 32, left: 40, right: 16, bottom: 32 },
      xAxis: { type: "category", data: dates, axisLabel: { fontSize: 10 } },
      yAxis: { type: "value" },
      series: [
        {
          name: t("adminAnalytics.audience.logged"),
          type: "bar",
          stack: "views",
          data: logged,
          itemStyle: { color: "oklch(0.7 0.18 145)" },
        },
        {
          name: t("adminAnalytics.audience.anon"),
          type: "bar",
          stack: "views",
          data: anon,
          itemStyle: { color: "oklch(0.8 0.15 75)" },
        },
      ],
    };
  }, [report, t]);

  const dailyTitle = t("adminAnalytics.audience.dailyViews");

  /**
   * ALTERNATYWA TEKSTOWA WYKRESU: te same dane, co na kanwie.
   *
   * Bez `csv` `ChartCard` oddaje czytnikowi ekranu prostokąt z samą nazwą;
   * z `csv` dokłada tabelę (`ChartDataTable`) i wiąże ją z regionem wykresu
   * przez `aria-describedby` - a przy okazji odsłania eksport CSV.
   */
  const dailyCsv = useMemo(
    () => ({
      filename: "audience-daily-views",
      headers: [
        t("adminAnalytics.gsc.csvHeaders.date"),
        t("adminAnalytics.audience.logged"),
        t("adminAnalytics.audience.anon"),
      ],
      rows: (report?.series ?? []).map((s) => [s.day, s.logged, s.anon]),
    }),
    [report, t],
  );

  const insights: Insight[] = useMemo(() => {
    const out: Insight[] = [];
    const arr = (key: string): string[] => t(key, { returnObjects: true }) as string[];
    // BRAK POMIARU TO TEŻ WNIOSEK. Pusta lista każe `InsightSection` namalować
    // zieloną kartę „nie znaleziono krytycznych zagadnień", więc odczyt, który
    // się jeszcze nie odbył albo padł, wychodził z panelu jako dobra wiadomość
    // o treści. Kolejność gałęzi jak w `kpiPlaceholder`.
    if (isMeasuring) {
      out.push({
        id: "measuring",
        element: t("adminAnalytics.common.measuringShort"),
        severity: "info",
        title: t("adminAnalytics.common.measuring"),
        detail: t("adminAnalytics.common.measuringHint"),
        fixes: [],
      });
      return out;
    }
    if (readError) {
      out.push({
        id: "read-failed",
        element: t("adminAnalytics.common.readFailedShort"),
        severity: "critical",
        title: t("adminAnalytics.common.readFailedReason", { reason: readReason }),
        detail: t("adminAnalytics.common.readFailedHint"),
        fixes: [],
      });
      return out;
    }
    if (!report) return out;
    const { kpi } = report;
    const total = kpi.views_total;
    if (total === 0) {
      out.push({
        id: "empty",
        element: t("adminAnalytics.audience.insights.empty.element"),
        severity: "info",
        title: t("adminAnalytics.audience.insights.empty.title"),
        detail: t("adminAnalytics.audience.insights.empty.detail"),
        fixes: arr("adminAnalytics.audience.insights.empty.fixes"),
      });
      return out;
    }
    const loggedShare = kpi.views_logged / total;
    if (loggedShare < 0.05) {
      out.push({
        id: "low-logged",
        element: t("adminAnalytics.audience.insights.lowLogged.element"),
        severity: "warn",
        title: t("adminAnalytics.audience.insights.lowLogged.title", {
          pct: (loggedShare * 100).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.lowLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.lowLogged.fixes"),
      });
    } else if (loggedShare > 0.6) {
      out.push({
        id: "high-logged",
        element: t("adminAnalytics.audience.insights.highLogged.element"),
        severity: "good",
        title: t("adminAnalytics.audience.insights.highLogged.title", {
          pct: (loggedShare * 100).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.highLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.highLogged.fixes"),
      });
    }
    if (kpi.unique_logged > 0 && kpi.views_logged / kpi.unique_logged > 4) {
      out.push({
        id: "loyal-logged",
        element: t("adminAnalytics.audience.insights.loyalLogged.element"),
        severity: "good",
        title: t("adminAnalytics.audience.insights.loyalLogged.title", {
          count: (kpi.views_logged / kpi.unique_logged).toFixed(1),
        }),
        detail: t("adminAnalytics.audience.insights.loyalLogged.detail"),
        fixes: arr("adminAnalytics.audience.insights.loyalLogged.fixes"),
      });
    }
    if (report.truncated) {
      out.push({
        id: "trunc",
        element: t("adminAnalytics.audience.insights.trunc.element"),
        severity: "warn",
        title: t("adminAnalytics.audience.insights.trunc.title"),
        detail: t("adminAnalytics.audience.insights.trunc.detail"),
        fixes: arr("adminAnalytics.audience.insights.trunc.fixes"),
      });
    }
    return out;
  }, [report, isMeasuring, readError, readReason, t]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-display text-lg">{t("adminAnalytics.audience.title")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("adminAnalytics.audience.descPre")}
            <code>post_views</code>
            {t("adminAnalytics.audience.descPost")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            {/* `SelectTrigger` renderuje `<button role="combobox">`, a etykiety
                wizualnej ten pasek nie ma wcale - bez `aria-label` czytnik
                ekranu ogłaszał samo „combobox", czyli kontrolkę bez ani jednego
                słowa o tym, czym ona jest. */}
            <SelectTrigger
              className="w-[120px]"
              aria-label={t("adminAnalytics.common.windowSelector")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.v} value={String(r.v)}>
                  {t(r.lKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* DWIE KARTY NA DWA STANY BEZ POMIARU. Trzeci stan - zmierzone zero -
          ma własny wniosek i własny komunikat w listach top, więc nie dubluje
          się kartą. Karty stoją NAD siatką, a siatka się nie zwija: operator
          musi nadal móc zmienić okno i ponowić odczyt. `aria-busy` na karcie
          pomiaru jest jedynym niezależnym od języka sygnałem „panel jeszcze
          liczy" - testy bramkują się na nim, a nie na napisie. */}
      {isMeasuring ? (
        <Card
          role="status"
          aria-busy="true"
          className="p-3 text-sm text-muted-foreground space-y-0.5"
        >
          <div className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("adminAnalytics.common.measuring")}
          </div>
          <p className="text-xs">{t("adminAnalytics.common.measuringHint")}</p>
        </Card>
      ) : readError ? (
        <Card
          role="alert"
          className="p-3 text-sm space-y-0.5 border-destructive/40 bg-destructive/5"
        >
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", { reason: readReason })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={t("adminAnalytics.audience.kpi.viewsTotal")}
          value={kpiText(report?.kpi.views_total)}
          Icon={Eye}
          tone="brand"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.logged")}
          value={kpiText(report?.kpi.views_logged)}
          hint={uniqueHint(report?.kpi.unique_logged)}
          Icon={UserCheck}
          tone="logged"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.anon")}
          value={kpiText(report?.kpi.views_anon)}
          hint={uniqueHint(report?.kpi.unique_anon)}
          Icon={UserX}
          tone="anon"
        />
        <KpiCard
          label={t("adminAnalytics.audience.kpi.uniqueReaders")}
          value={kpiText(report?.kpi.unique_readers)}
          Icon={Users}
          tone="brand"
        />
      </div>

      <ChartCard
        title={dailyTitle}
        option={chartOption}
        height={280}
        csv={dailyCsv}
        badge={
          report?.truncated ? (
            <Badge variant="outline" className="text-xs">
              {t("adminAnalytics.audience.sampleTruncated")}
            </Badge>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopPosts
          title={t("adminAnalytics.audience.topLogged")}
          rows={report?.top_logged ?? []}
          tone="logged"
          locale={locale}
          emptyLabel={listEmptyLabel}
        />
        <TopPosts
          title={t("adminAnalytics.audience.topAnon")}
          rows={report?.top_anon ?? []}
          tone="anon"
          locale={locale}
          emptyLabel={listEmptyLabel}
        />
      </div>

      <InsightSection insights={insights} />
    </div>
  );
}

function TopPosts({
  title,
  rows,
  tone,
  locale,
  emptyLabel,
}: {
  title: string;
  rows: ReadonlyArray<{
    post_id: string;
    title: string;
    slug: string | null;
    views: number;
    uniques: number;
  }>;
  tone: "logged" | "anon";
  /** Locale liczb - ten sam, który wybrał panel z języka interfejsu. */
  locale: string;
  /** Napis pustej listy - zależy od STANU POMIARU, nie tylko od liczby wierszy. */
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  const dot = tone === "logged" ? "bg-cat-finance" : "bg-cat-transport";
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <h4 className="font-display text-base">{title}</h4>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">{emptyLabel}</p>
      ) : (
        <ol className="divide-y divide-border">
          {rows.map((r, i) => (
            <li key={r.post_id} className="flex items-center gap-3 py-2">
              <span className="w-5 text-xs font-mono text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{r.title}</div>
                {r.slug && <div className="truncate text-xs text-muted-foreground">/{r.slug}</div>}
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium">{r.views.toLocaleString(locale)}</div>
                <div className="text-xs text-muted-foreground">
                  {r.uniques.toLocaleString(locale)} {t("adminAnalytics.audience.uniqShort")}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
