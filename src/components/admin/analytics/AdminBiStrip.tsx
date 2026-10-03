/**
 * Kompaktowy pasek analityki modułu 17 do osadzania POZA /admin/analytics.
 *
 * Po co osobny komponent zamiast wstawiania pełnych dashboardów: strona
 * startowa panelu i ekrany modułowe mają pokazać SYGNAŁ (czy coś się psuje,
 * czy strona jest szybka), a nie cały warsztat BI. Pasek czyta DOKŁADNIE te
 * same funkcje serwerowe co pełne dashboardy (`getVitalsSummary`,
 * `getClientErrorsReport`), więc liczby nigdy nie rozjadą się z /admin/analytics.
 *
 * Rysuje przez `ChartCard`, czyli przez ten sam silnik, co wykres we wpisie -
 * paleta, geometria i interakcja są więc jedne dla całej platformy.
 *
 * TRZY STANY KAFELKA, nie jeden. Liczba (także „0") stoi WYŁĄCZNIE po udanym
 * odczycie; w trakcie pomiaru kafelek mówi „Pomiar", a po awarii „Awaria
 * odczytu", z jedną kartą `role="alert"` nad kafelkami, która podaje przyczynę.
 * Do 2026-10 pasek nie czytał `isError` wcale i `?? 0` malowało „Próbki RUM: 0"
 * zarówno przed odpowiedzią serwera, jak i po każdej awarii - zero tam, gdzie
 * pomiaru nie było. Źródła są niezależne: awaria RUM nie gasi liczb błędów
 * przeglądarki i odwrotnie.
 *
 * PASEK WIDZI TYLKO ADMIN NAJEMCY. Obie funkcje stoją za `requireAnalyticsAdmin`
 * (`has_role(uid, 'admin')`), a RLS `web_vitals`/`client_errors` jest
 * administracyjne - tymczasem /admin i /admin/community otwiera każdy członek
 * redakcji. Do 2026-10 redaktor dostawał na obu ekranach kartę „Awaria odczytu:
 * Forbidden: admin role required" i cztery kafelki awarii: rzetelny opis
 * odmowy, tyle że odmowy, która jest stanem stałym, a nie awarią. Dla
 * nie-admina pasek nie pyta serwera i nie renderuje niczego.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import "@/lib/i18n-admin-analytics";
import { Card } from "@/components/ui/card";
import { ChartCard } from "./ChartCard";
import { biChart } from "./biChart";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";
import { getClientErrorsReport } from "@/lib/observability/clientErrors.functions";
import { analyticsBiStripKey } from "@/lib/analytics/queryKeys";
import { useCurrentTenantId } from "@/lib/tenant";
import { useAuth } from "@/hooks/useAuth";

export interface AdminBiStripProps {
  /** Okno analityczne w dniach (domyślnie 14). */
  days?: number;
  /** Czy pokazać link do pełnego panelu BI (domyślnie tak). */
  showLink?: boolean;
  className?: string;
}

function KpiTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold font-display leading-tight mt-0.5">{value}</div>
      {hint ? <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div> : null}
    </Card>
  );
}

export function AdminBiStrip({ days = 14, showLink = true, className }: AdminBiStripProps) {
  const { t } = useTranslation();
  const fetchVitals = useServerFn(getVitalsSummary);
  const fetchErrors = useServerFn(getClientErrorsReport);
  // Tenant w kluczu (`@/lib/analytics/queryKeys`): serwer liczy dane najemcy
  // z profilu, ale bez najemcy w kluczu pasek po przełączeniu obszaru
  // roboczego pokazywałby z cache'u liczby poprzedniego. Do czasu ustalenia
  // najemcy nic się nie pobiera - kafelki mówią wtedy „Pomiar", bo bez
  // raportu i bez awarii `placeholder` daje właśnie ten stan.
  const tenantId = useCurrentTenantId();
  // SYGNAŁ ROLI TO DOKŁADNIE WARUNEK BRAMKI SERWERA, a nie `isAdmin` z `useAuth`.
  // `isAdmin` liczy też `super_admin`, którego `requireAnalyticsAdmin` bez
  // wiersza `admin` NIE wpuszcza - pasek wróciłby wtedy do karty „Forbidden".
  // `roles` czyta `user_roles` pod RLS `tenant_id = current_tenant_id()`, czyli
  // w tym samym zakresie najemcy, w którym sprawdza `has_role()`. Dopóki role
  // się ładują, `roles` jest puste (`useAuth` zeruje je przy zmianie
  // tożsamości), a `!loading` mówi to wprost: niewiadoma rola to brak paska,
  // nigdy zapytanie na próbę i nigdy karta awarii.
  const { roles, loading: authLoading } = useAuth();
  const canRead = !authLoading && roles.includes("admin");
  const enabled = canRead && Boolean(tenantId);

  const vitalsQ = useQuery({
    queryKey: analyticsBiStripKey(tenantId ?? "", "vitals", days),
    queryFn: () => fetchVitals({ data: { days } }),
    enabled,
    staleTime: 120_000,
  });
  const errorsQ = useQuery({
    queryKey: analyticsBiStripKey(tenantId ?? "", "errors", days),
    queryFn: () => fetchErrors({ data: { days } }),
    enabled,
    staleTime: 120_000,
  });

  // RAPORT JEST TWIERDZENIEM O DANYCH TYLKO PO UDANYM ODCZYCIE. Przy
  // nieudanym ODŚWIEŻENIU react-query trzyma poprzednie `data` obok `error` -
  // stara liczba obok świeżej awarii byłaby nieaktualnym pomiarem podanym
  // jako bieżący.
  const vitalsReport = vitalsQ.isError ? undefined : vitalsQ.data;
  const errorsReport = errorsQ.isError ? undefined : errorsQ.data;
  /** Napis NA MIEJSCU liczby, gdy pomiaru nie ma (wzór: `kpiPlaceholder` w GscBiDashboard). */
  const placeholder = (failed: boolean): string =>
    failed ? t("adminAnalytics.common.readFailedShort") : t("adminAnalytics.common.measuringShort");
  // Jedna karta awarii na pasek: przyczyna pierwszego źródła, które padło.
  // Kafelki i tak mówią, KTÓRE źródło nie ma pomiaru.
  const failure = vitalsQ.isError ? vitalsQ.error : errorsQ.isError ? errorsQ.error : null;
  const failureReason =
    failure instanceof Error && failure.message.trim()
      ? failure.message
      : t("adminAnalytics.common.unknownReason");

  const lcp = vitalsReport?.metrics.find((m) => m.metric === "LCP");
  const trend = useMemo(
    () =>
      (vitalsReport?.trends ?? [])
        .map((p) => ({ day: p.day, value: p.p75.LCP }))
        .filter((p): p is { day: string; value: number } => typeof p.value === "number"),
    [vitalsReport],
  );

  // LCP: szereg dzienny, więc ŁAMANA (`smoothing: 0`). Wygładzenie rysuje
  // między pomiarami krzywą, której nikt nie zmierzył, a przy metryce
  // wydajności to jest dokładnie ta informacja, o którą tu chodzi - czy dzień
  // odstaje od sąsiadów.
  const lcpConfig = useMemo(
    () =>
      biChart({
        kind: "line",
        categories: trend.map((p) => p.day.slice(5)),
        series: [
          { name: t("adminAnalytics.bi.charts.lcpTrend"), values: trend.map((p) => p.value) },
        ],
        unit: " ms",
        sampleSize: trend.length,
        smoothing: 0,
        showLegend: false,
      }),
    [trend, t],
  );

  // Stabilna referencja: `?? []` tworzy NOWĄ tablicę przy każdym renderze,
  // więc bez tego `useMemo` niżej przeliczałby konfigurację w kółko - a wykres
  // przebudowany przy każdym renderze gubi stan wskazania.
  const daily = useMemo(() => errorsReport?.daily ?? [], [errorsReport]);
  // Błędy klienta idą DOMYŚLNYM slotem palety, i to jest decyzja, nie
  // przeoczenie: sloty serii niosą TOŻSAMOŚĆ, a nie ocenę. Kolor „zły" ma
  // w tym systemie osobne tokeny (`--chart-negative`) zarezerwowane dla
  // ZNAKU wartości, a `SLOTS_CLASHING_WITH_SIGN` wyklucza z ich sąsiedztwa
  // nawet terakotę. Że wzrost błędów jest zły, mówi tytuł wykresu.
  const errorsConfig = useMemo(
    () =>
      biChart({
        kind: "bar",
        categories: daily.map((d) => d.day.slice(5)),
        series: [
          {
            name: t("adminAnalytics.bi.charts.errorsDaily"),
            values: daily.map((d) => d.count),
          },
        ],
        sampleSize: daily.reduce((a, d) => a + d.count, 0),
        showLegend: false,
      }),
    [daily, t],
  );

  // Wczesny powrót DOPIERO po hookach - ich liczba i kolejność nie mogą
  // zależeć od roli, bo role dojeżdżają po pierwszym renderze. Zapytania
  // wyżej i tak stoją na `enabled: false`, więc nic nie wychodzi do sieci.
  // `className` (np. `mt-6` na /admin) znika razem z paskiem: brak pustej
  // przerwy po nieobecnym bloku.
  if (!canRead) return null;

  return (
    <section className={className}>
      <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
        <div>
          <h2 className="font-display text-base font-bold">{t("adminAnalytics.bi.stripTitle")}</h2>
          <p className="text-[11px] text-muted-foreground">
            {t("adminAnalytics.bi.stripSubtitle", { days })}
          </p>
        </div>
        {showLink ? (
          <Link to="/admin/analytics/bi" className="text-xs text-primary hover:underline">
            {t("adminAnalytics.bi.openFull")}
          </Link>
        ) : null}
      </div>

      {/* AWARIA TO KOMUNIKAT, NIE SIATKA ZER. Karta stoi NAD kafelkami, a
          wykresy się nie zwijają (dostają puste serie), żeby operator nie
          tracił kontekstu paska. */}
      {failure ? (
        <Card
          role="alert"
          className="mb-2.5 space-y-0.5 border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          <div className="font-medium text-destructive">
            {t("adminAnalytics.common.readFailedReason", { reason: failureReason })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t("adminAnalytics.common.readFailedHint")}
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <KpiTile
          label={t("adminAnalytics.bi.kpi.samples")}
          value={vitalsReport ? String(vitalsReport.windowTotal) : placeholder(vitalsQ.isError)}
        />
        {/* Kreska zostaje luką ZMIERZONEGO okna bez próbek LCP - nie stanem
            „jeszcze nie wiem" ani „odczyt padł". */}
        <KpiTile
          label={t("adminAnalytics.bi.kpi.lcp")}
          value={
            vitalsReport ? (lcp ? `${Math.round(lcp.p75)} ms` : "-") : placeholder(vitalsQ.isError)
          }
          hint={lcp ? lcp.rating : undefined}
        />
        <KpiTile
          label={t("adminAnalytics.bi.kpi.errors")}
          value={errorsReport ? String(errorsReport.windowTotal) : placeholder(errorsQ.isError)}
        />
        <KpiTile
          label={t("adminAnalytics.bi.kpi.errorGroups")}
          value={errorsReport ? String(errorsReport.uniqueGroups) : placeholder(errorsQ.isError)}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5 mt-2.5">
        <ChartCard
          title={t("adminAnalytics.bi.charts.lcpTrend")}
          subtitle={t("adminAnalytics.bi.charts.lcpTrendSub")}
          config={lcpConfig}
          height={220}
          csv={{
            filename: "lcp-p75",
            headers: [t("adminAnalytics.bi.cols.day"), t("adminAnalytics.bi.cols.value")],
            rows: trend.map((p) => [p.day, p.value]),
          }}
        />
        <ChartCard
          title={t("adminAnalytics.bi.charts.errorsDaily")}
          subtitle={t("adminAnalytics.bi.charts.errorsDailySub")}
          config={errorsConfig}
          height={220}
          csv={{
            filename: "client-errors-daily",
            headers: [t("adminAnalytics.bi.cols.day"), t("adminAnalytics.bi.cols.count")],
            rows: daily.map((d) => [d.day, d.count]),
          }}
        />
      </div>
    </section>
  );
}
