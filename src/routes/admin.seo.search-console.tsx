// /admin/seo/search-console - Google Search Console dashboard:
// top queries, CTR, average position and top pages for the selected verified property.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listGscSites, queryGscAnalytics, type GscRow } from "@/lib/analytics/gsc.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  ExternalLink,
  TrendingUp,
  MousePointerClick,
  Eye,
  Target,
} from "@/lib/lucide-shim";

export const Route = createFileRoute("/admin/seo/search-console")({
  component: SearchConsolePanel,
  head: () => ({ meta: [{ title: "Search Console - SEO" }] }),
});

type RangeKey = "7d" | "28d" | "90d";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function rangeDates(range: RangeKey): { startDate: string; endDate: string } {
  const endDate = isoDaysAgo(2); // GSC data lags ~2 days
  const daysMap: Record<RangeKey, number> = { "7d": 9, "28d": 30, "90d": 92 };
  return { startDate: isoDaysAgo(daysMap[range]), endDate };
}

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function formatPosition(v: number): string {
  return v.toFixed(1);
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone = "text-foreground",
}: {
  icon: typeof Search;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-[6px] p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function SearchConsolePanel() {
  const { t } = useTranslation();
  const [range, setRange] = useState<RangeKey>("28d");
  const [siteUrl, setSiteUrl] = useState<string>("");

  const listSites = useServerFn(listGscSites);
  const runQuery = useServerFn(queryGscAnalytics);

  const sitesQuery = useQuery({
    queryKey: ["gsc-sites"],
    queryFn: () => listSites(),
    staleTime: 5 * 60_000,
  });

  const effectiveSite = siteUrl || sitesQuery.data?.sites?.[0]?.siteUrl || "";
  const { startDate, endDate } = useMemo(() => rangeDates(range), [range]);

  const queriesQuery = useQuery({
    queryKey: ["gsc-queries", effectiveSite, startDate, endDate],
    enabled: !!effectiveSite,
    queryFn: () =>
      runQuery({
        data: {
          siteUrl: effectiveSite,
          startDate,
          endDate,
          dimensions: ["query"],
          rowLimit: 25,
        },
      }),
  });

  const pagesQuery = useQuery({
    queryKey: ["gsc-pages", effectiveSite, startDate, endDate],
    enabled: !!effectiveSite,
    queryFn: () =>
      runQuery({
        data: {
          siteUrl: effectiveSite,
          startDate,
          endDate,
          dimensions: ["page"],
          rowLimit: 25,
        },
      }),
  });

  const totals = useMemo(() => {
    const rows: GscRow[] = queriesQuery.data?.rows ?? [];
    if (!rows.length) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const weightedPos =
      rows.reduce((s, r) => s + r.position * r.impressions, 0) / (impressions || 1);
    return {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: weightedPos,
    };
  }, [queriesQuery.data]);

  const notConfigured = sitesQuery.data && sitesQuery.data.configured === false;
  const noSites =
    sitesQuery.data && sitesQuery.data.configured && sitesQuery.data.sites.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <Search className="w-6 h-6" />
          {t("admin.gsc.title", { defaultValue: "Google Search Console" })}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("admin.gsc.subtitle", {
            defaultValue:
              "Top zapytania, CTR, średnia pozycja oraz najlepsze strony z Twojej zweryfikowanej właściwości.",
          })}
        </p>
      </div>

      {sitesQuery.isLoading && (
        <div className="text-sm text-muted-foreground">{t("admin.loading")}</div>
      )}

      {sitesQuery.error && (
        <div className="bg-destructive/10 border border-destructive/40 text-destructive rounded-[6px] p-4 text-sm">
          {(sitesQuery.error as Error).message}
        </div>
      )}

      {notConfigured && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-[6px] p-4 text-sm">
          {t("admin.gsc.notConfigured", {
            defaultValue:
              "Konektor Google Search Console nie jest podłączony. Podłącz go w ustawieniach integracji.",
          })}
        </div>
      )}

      {noSites && (
        <div className="bg-amber-500/10 border border-amber-500/40 rounded-[6px] p-4 text-sm">
          {t("admin.gsc.noSites", {
            defaultValue:
              "Brak zweryfikowanych właściwości w podłączonym koncie Google Search Console.",
          })}
        </div>
      )}

      {!!sitesQuery.data?.sites?.length && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger className="w-[320px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sitesQuery.data.sites.map((s) => (
                <SelectItem key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-[140px] h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">
                {t("admin.gsc.range7d", { defaultValue: "Ostatnie 7 dni" })}
              </SelectItem>
              <SelectItem value="28d">
                {t("admin.gsc.range28d", { defaultValue: "Ostatnie 28 dni" })}
              </SelectItem>
              <SelectItem value="90d">
                {t("admin.gsc.range90d", { defaultValue: "Ostatnie 90 dni" })}
              </SelectItem>
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">
            {startDate} → {endDate}
          </span>
        </div>
      )}

      {effectiveSite && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              icon={MousePointerClick}
              label={t("admin.gsc.clicks", { defaultValue: "Kliknięcia" })}
              value={totals.clicks.toLocaleString()}
              tone="text-brand"
            />
            <StatCard
              icon={Eye}
              label={t("admin.gsc.impressions", { defaultValue: "Wyświetlenia" })}
              value={totals.impressions.toLocaleString()}
            />
            <StatCard
              icon={TrendingUp}
              label={t("admin.gsc.ctr", { defaultValue: "CTR" })}
              value={formatPercent(totals.ctr)}
            />
            <StatCard
              icon={Target}
              label={t("admin.gsc.position", { defaultValue: "Śr. pozycja" })}
              value={formatPosition(totals.position)}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <GscTable
              title={t("admin.gsc.topQueries", { defaultValue: "Top zapytania" })}
              keyLabel={t("admin.gsc.query", { defaultValue: "Zapytanie" })}
              rows={queriesQuery.data?.rows ?? []}
              loading={queriesQuery.isLoading}
              error={queriesQuery.error as Error | null}
            />
            <GscTable
              title={t("admin.gsc.topPages", { defaultValue: "Top strony" })}
              keyLabel={t("admin.gsc.page", { defaultValue: "Strona" })}
              rows={pagesQuery.data?.rows ?? []}
              loading={pagesQuery.isLoading}
              error={pagesQuery.error as Error | null}
              renderKey={(k) => (
                <a
                  href={k}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-brand hover:underline"
                >
                  <span className="truncate max-w-[320px]">{k}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              )}
            />
          </div>
        </>
      )}

      <p className="text-[11px] text-muted-foreground">
        <Link to="/admin/seo" className="hover:text-brand hover:underline">
          ← {t("admin.gsc.backToSeo", { defaultValue: "Wróć do przeglądu SEO" })}
        </Link>
      </p>
    </div>
  );
}

function GscTable({
  title,
  keyLabel,
  rows,
  loading,
  error,
  renderKey,
}: {
  title: string;
  keyLabel: string;
  rows: GscRow[];
  loading: boolean;
  error: Error | null;
  renderKey?: (k: string) => React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-card border border-border rounded-[6px] overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="font-display font-semibold text-sm">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-muted/30 text-[10px] uppercase text-muted-foreground tracking-wide">
            <tr>
              <th className="p-2 text-left">{keyLabel}</th>
              <th className="p-2 text-right w-20">
                {t("admin.gsc.clicks", { defaultValue: "Klik." })}
              </th>
              <th className="p-2 text-right w-20">
                {t("admin.gsc.impressions", { defaultValue: "Wyśw." })}
              </th>
              <th className="p-2 text-right w-16">CTR</th>
              <th className="p-2 text-right w-16">
                {t("admin.gsc.positionShort", { defaultValue: "Poz." })}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  {t("admin.loading")}
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-destructive">
                  {error.message}
                </td>
              </tr>
            )}
            {!loading && !error && !rows.length && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  {t("admin.gsc.noData", { defaultValue: "Brak danych w tym okresie" })}
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const key = r.keys[0] ?? "";
              return (
                <tr key={`${key}-${i}`} className="hover:bg-muted/20">
                  <td className="p-2 max-w-[380px]">
                    <div className="truncate" title={key}>
                      {renderKey ? renderKey(key) : key}
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums font-medium">
                    {r.clicks.toLocaleString()}
                  </td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">
                    {r.impressions.toLocaleString()}
                  </td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">
                    {formatPercent(r.ctr)}
                  </td>
                  <td className="p-2 text-right tabular-nums text-muted-foreground">
                    {formatPosition(r.position)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
