// Organizm strony /admin/newsletter/deliverability.
//
// Kolejność ekranu odpowiada kolejności decyzji operatora:
//   1. alarm bramki (czy wolno mi teraz wysyłać?),
//   2. wskaźniki wobec progów Google (jak blisko krawędzi jestem?),
//   3. pętla zwrotna (czy dane w ogóle napływają?),
//   4. trend i kampanie (co się zmieniło i przez co?),
//   5. lista wykluczeń (co mogę z tym zrobić?).
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { uiLang, uiLocale } from "@/lib/i18n/format";
import { AlertTriangle, MailWarning, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chart } from "@/components/charts/Chart";
import type { ChartConfig } from "@/lib/charts/types";
import { ReputationMeter } from "@/components/molecules/ReputationMeter";
import { ReputationStatusDot } from "@/components/atoms/ReputationStatusDot";
import { formatRate } from "@/lib/email/reputation";
import {
  getDeliverabilityMetrics,
  getDeliverabilitySetup,
} from "@/lib/newsletter-deliverability.functions";
import { SuppressionTable } from "./SuppressionTable";
import { WebhookSetupCard } from "./WebhookSetupCard";
import { cn } from "@/lib/utils";
import "@/lib/i18n-newsletter-deliverability";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

export function DeliverabilityPanel() {
  const { t, i18n } = useTranslation();
  const locale = uiLocale(i18n.language);
  const [days, setDays] = useState<Range>(30);

  const metricsFn = useServerFn(getDeliverabilityMetrics);
  const setupFn = useServerFn(getDeliverabilitySetup);

  const metrics = useQuery({
    queryKey: ["deliverability-metrics", days],
    queryFn: () => metricsFn({ data: { days } }),
  });
  const setup = useQuery({
    queryKey: ["deliverability-setup"],
    queryFn: () => setupFn(),
  });

  const reputation = metrics.data?.reputation;
  const counts = metrics.data?.counts;
  const seriesData = metrics.data?.series;

  const chart: ChartConfig | null = useMemo(() => {
    const series = seriesData ?? [];
    if (series.length === 0) return null;
    const label = (day: string) =>
      new Date(`${day}T00:00:00Z`).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
      });
    return {
      kind: "line",
      title: t("adminDeliverability.chart.title"),
      description: "",
      categories: series.map((p) => label(p.day)),
      series: [
        {
          name: t("adminDeliverability.chart.delivered"),
          values: series.map((p) => p.delivered),
          colorSlot: 1,
        },
        {
          name: t("adminDeliverability.chart.bounced"),
          values: series.map((p) => p.bounced),
          colorSlot: 2,
        },
        {
          name: t("adminDeliverability.chart.complained"),
          values: series.map((p) => p.complained),
          colorSlot: 3,
        },
      ],
      stacked: false,
      unit: "",
      height: 260,
      showLegend: true,
      showGrid: true,
      showValues: false,
      animate: false,
      source: "",
    };
  }, [seriesData, locale, t]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="font-display text-xl flex items-center gap-2">
            {t("adminDeliverability.title")}
            {reputation && <ReputationStatusDot status={reputation.overall} />}
          </h2>
          <p className="text-sm text-muted-foreground max-w-3xl">
            {t("adminDeliverability.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-1 p-1 rounded-lg bg-muted/60 border border-border/60"
            role="group"
            aria-label={t("adminDeliverability.range.label")}
          >
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDays(r)}
                aria-pressed={days === r}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
                  days === r
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`adminDeliverability.range.d${r}`)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              metrics.refetch();
              setup.refetch();
            }}
            disabled={metrics.isFetching}
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", metrics.isFetching && "animate-spin")} />
            {t("adminDeliverability.refresh")}
          </Button>
        </div>
      </header>

      {reputation?.blocksSending && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 flex items-start gap-3"
        >
          <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <h3 className="font-medium text-destructive">{t("adminDeliverability.gate.title")}</h3>
            <p className="text-sm text-muted-foreground">{t("adminDeliverability.gate.body")}</p>
            <ul className="list-disc pl-5 text-sm text-destructive/90">
              {reputation.blockReasons.map((code) => (
                <li key={code}>{t(`adminDeliverability.gate.${code}`)}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {reputation ? (
          <>
            <ReputationMeter
              label={t("adminDeliverability.kpi.complaintRate")}
              hint={t("adminDeliverability.kpi.complaintHint")}
              metric={reputation.complaint}
              locale={locale}
            />
            <ReputationMeter
              label={t("adminDeliverability.kpi.bounceRate")}
              hint={t("adminDeliverability.kpi.bounceHint")}
              metric={reputation.bounce}
              locale={locale}
            />
            <ReputationMeter
              label={t("adminDeliverability.kpi.hardBounceRate")}
              hint={t("adminDeliverability.kpi.hardBounceHint")}
              metric={reputation.hardBounce}
              locale={locale}
            />
          </>
        ) : (
          RANGES.map((key) => (
            <div
              key={key}
              className="bg-card border border-border rounded-xl p-4 h-[148px] animate-pulse"
            />
          ))
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          icon={ShieldCheck}
          label={t("adminDeliverability.kpi.deliveryRate")}
          value={reputation ? formatRate(reputation.deliveryRate, locale) : "-"}
          hint={t("adminDeliverability.kpi.deliveryHint")}
        />
        <StatCard
          icon={MailWarning}
          label={t("adminDeliverability.kpi.suppressions")}
          value={(counts?.activeSuppressions ?? 0).toLocaleString(locale)}
          hint={t("adminDeliverability.kpi.suppressionsHint", {
            count: counts?.suppressedSends ?? 0,
          })}
        />
      </section>

      {setup.data && <WebhookSetupCard setup={setup.data} locale={locale} />}

      <section className="bg-card border border-border rounded-xl p-5 space-y-3">
        <h3 className="font-display text-lg">{t("adminDeliverability.chart.title")}</h3>
        {chart ? (
          <Chart config={chart} lang={uiLang(i18n.language)} />
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t("adminDeliverability.chart.empty")}
          </p>
        )}
      </section>

      <section className="bg-card border border-border rounded-xl overflow-hidden">
        <h3 className="font-display text-lg px-5 pt-5 pb-3">
          {t("adminDeliverability.campaigns.title")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-y border-border bg-muted/40">
              <tr>
                <th className="text-left p-3">{t("adminDeliverability.campaigns.colName")}</th>
                <th className="text-right p-3">{t("adminDeliverability.campaigns.colSent")}</th>
                <th className="text-right p-3 hidden sm:table-cell">
                  {t("adminDeliverability.campaigns.colDelivered")}
                </th>
                <th className="text-right p-3">{t("adminDeliverability.campaigns.colBounced")}</th>
                <th className="text-right p-3">
                  {t("adminDeliverability.campaigns.colComplained")}
                </th>
                <th className="text-right p-3 hidden md:table-cell">
                  {t("adminDeliverability.campaigns.colSuppressed")}
                </th>
              </tr>
            </thead>
            <tbody>
              {(metrics.data?.campaigns.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    {t("adminDeliverability.campaigns.empty")}
                  </td>
                </tr>
              )}
              {(metrics.data?.campaigns ?? []).map((c) => (
                <tr key={c.id} className="border-b border-border/60 last:border-0">
                  <td className="p-3">
                    <div className="font-medium truncate max-w-[280px]">{c.name || "-"}</div>
                    {c.finishedAt && (
                      <div className="text-[11px] text-muted-foreground">
                        {new Date(c.finishedAt).toLocaleDateString(locale)}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums">{c.sent.toLocaleString(locale)}</td>
                  <td className="p-3 text-right tabular-nums hidden sm:table-cell">
                    {c.delivered.toLocaleString(locale)}
                  </td>
                  <td
                    className={cn(
                      "p-3 text-right tabular-nums",
                      c.bounced > 0 && "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {c.bounced.toLocaleString(locale)}
                  </td>
                  <td
                    className={cn(
                      "p-3 text-right tabular-nums",
                      c.complained > 0 && "text-destructive",
                    )}
                  >
                    {c.complained.toLocaleString(locale)}
                  </td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground hidden md:table-cell">
                    {c.suppressed.toLocaleString(locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <SuppressionTable locale={locale} />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="font-display text-2xl tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </div>
  );
}
