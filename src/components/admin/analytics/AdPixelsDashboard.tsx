// Panel „Piksele Ads": wizyty i konwersje Meta Pixel / Google Ads / LinkedIn
// Insight po zgodzie marketingowej. Dane: `getAdPixelsAnalytics`.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAdPixelsAnalytics } from "@/lib/analytics/adPixelsAnalytics.functions";
import { AD_PLATFORMS, conversionRate, type AdPlatform } from "@/lib/analytics/adPixels";
import { useCurrentTenantId } from "@/lib/tenant";
import { ensureI18n } from "@/lib/i18n-admin-ad-pixels";
import { ChartCard } from "./ChartCard";
import { biChart } from "./biChart";

const RANGES = [7, 14, 30, 90] as const;

export function AdPixelsDashboard() {
  ensureI18n();
  const { t } = useTranslation();
  const tenantId = useCurrentTenantId();
  const fetchData = useServerFn(getAdPixelsAnalytics);
  const [days, setDays] = useState<number>(30);
  const q = useQuery({
    queryKey: ["admin", "analytics", "ad-pixels", tenantId ?? "", days],
    queryFn: () => fetchData({ data: { days } }),
    enabled: Boolean(tenantId),
    staleTime: 60_000,
  });

  const name = (p: AdPlatform) => t(`adminAdPixels.platform.${p}`);
  const data = q.data;

  const charts = useMemo(() => {
    if (!data) return null;
    const cats = data.daily.map((d) => d.date.slice(5));
    const mk = (key: "visits" | "conversions", kind: "line" | "bar") =>
      biChart({
        kind,
        categories: cats,
        series: AD_PLATFORMS.map((p) => ({ name: name(p), values: data.daily.map((d) => d[key][p]) })),
        showLegend: true,
      });
    return { visits: mk("visits", "line"), conversions: mk("conversions", "bar") };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, t]);

  const csvRows = (key: "visits" | "conversions") =>
    (data?.daily ?? []).map((d) => [d.date, ...AD_PLATFORMS.map((p) => d[key][p])]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight">{t("adminAdPixels.title")}</h2>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t("adminAdPixels.subtitle")}</p>
        </div>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-44" aria-label={t("adminAdPixels.range", { days })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => (
              <SelectItem key={r} value={String(r)}>
                {t("adminAdPixels.range", { days: r })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>

      {!tenantId || q.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("adminAdPixels.loading")}
        </div>
      ) : q.isError || !data || !charts ? (
        <Card role="alert" className="p-4 text-sm text-destructive">
          {t("adminAdPixels.error")}
          {q.error instanceof Error ? <div className="mt-1 text-xs text-muted-foreground">{q.error.message}</div> : null}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">{t("adminAdPixels.kpi.visits")}</div>
              <div className="text-2xl font-semibold tabular-nums">{data.consentedVisits}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">{t("adminAdPixels.kpi.conversions")}</div>
              <div className="text-2xl font-semibold tabular-nums">{data.conversions}</div>
            </Card>
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">{t("adminAdPixels.kpi.rate")}</div>
              <div className="text-2xl font-semibold tabular-nums">
                {conversionRate(data.consentedVisits, data.conversions)}%
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {AD_PLATFORMS.map((p) => (
              <Card key={p} className="p-4">
                <div className="text-sm font-semibold">{name(p)}</div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {t("adminAdPixels.platformLine", {
                    visits: data.totals[p].visits,
                    conversions: data.totals[p].conversions,
                    rate: conversionRate(data.totals[p].visits, data.totals[p].conversions),
                  })}
                </div>
              </Card>
            ))}
          </div>

          {data.capped ? <p className="text-xs text-muted-foreground">{t("adminAdPixels.capped")}</p> : null}
          {data.consentedVisits === 0 ? (
            <p className="text-sm text-muted-foreground">{t("adminAdPixels.empty")}</p>
          ) : null}

          <ChartCard
            title={t("adminAdPixels.charts.visits")}
            subtitle={t("adminAdPixels.charts.visitsSub")}
            config={charts.visits}
            csv={{ filename: "ad-pixels-visits", headers: [t("adminAdPixels.cols.day"), ...AD_PLATFORMS.map(name)], rows: csvRows("visits") }}
          />
          <ChartCard
            title={t("adminAdPixels.charts.conversions")}
            subtitle={t("adminAdPixels.charts.conversionsSub")}
            config={charts.conversions}
            csv={{ filename: "ad-pixels-conversions", headers: [t("adminAdPixels.cols.day"), ...AD_PLATFORMS.map(name)], rows: csvRows("conversions") }}
          />

          {data.conversionKinds.length > 0 ? (
            <Card className="p-4">
              <div className="mb-2 text-sm font-semibold">{t("adminAdPixels.charts.kinds")}</div>
              <ul className="space-y-1 text-sm">
                {data.conversionKinds.map((k) => (
                  <li key={k.kind} className="flex justify-between gap-3">
                    <span>{t(`adminAdPixels.kind.${k.kind}`, { defaultValue: k.kind })}</span>
                    <span className="tabular-nums">{k.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
