import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Search as SearchIcon,
  Activity,
  Gauge,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAnalyticsStatus, type AnalyticsStatus } from "@/lib/analytics/status.functions";
import { listGscSites, queryGscAnalytics, type GscRow } from "@/lib/analytics/gsc.functions";
import { runGa4Report, type Ga4Report } from "@/lib/analytics/ga4.functions";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";

export const Route = createFileRoute("/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Analityka i wydajność - Admin" },
      { name: "description", content: "Google Analytics 4, Search Console i Web Vitals w jednym panelu." },
    ],
  }),
  component: AnalyticsPage,
});

function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// --------- Status pills ---------

interface PillProps {
  ok: boolean;
  label: string;
  detail?: string;
}
function StatusPill({ ok, label, detail }: PillProps) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <div
        className={
          "shrink-0 w-9 h-9 rounded-full inline-flex items-center justify-center " +
          (ok ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground")
        }
      >
        {ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-muted-foreground truncate">
          {ok ? detail ?? "Połączone" : detail ?? "Nie skonfigurowane"}
        </div>
      </div>
    </Card>
  );
}

// --------- GSC panel ---------

function GscPanel({ configured }: { configured: boolean }) {
  const fetchSites = useServerFn(listGscSites);
  const fetchAnalytics = useServerFn(queryGscAnalytics);
  const [siteUrl, setSiteUrl] = useState<string>("");
  const [days, setDays] = useState<number>(28);
  const [dim, setDim] = useState<"query" | "page" | "country" | "device" | "date">("query");

  const sitesQ = useQuery({
    queryKey: ["gsc-sites"],
    queryFn: () => fetchSites(),
    enabled: configured,
  });

  const effectiveSite = siteUrl || sitesQ.data?.sites?.[0]?.siteUrl || "";

  const dataQ = useQuery({
    queryKey: ["gsc-query", effectiveSite, days, dim],
    queryFn: () =>
      fetchAnalytics({
        data: {
          siteUrl: effectiveSite,
          startDate: daysAgoISO(days),
          endDate: todayISO(),
          dimensions: [dim],
          rowLimit: 50,
        },
      }),
    enabled: configured && Boolean(effectiveSite),
  });

  if (!configured) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        Search Console nie jest jeszcze podłączony. Wróć do zakładki <b>Przegląd</b> i użyj przycisku „Połącz Search Console".
      </Card>
    );
  }

  const totals = useMemo(() => {
    const rows = dataQ.data?.rows ?? [];
    return rows.reduce(
      (acc, r) => {
        acc.clicks += r.clicks;
        acc.impressions += r.impressions;
        return acc;
      },
      { clicks: 0, impressions: 0 },
    );
  }, [dataQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px]">
          <label className="text-xs text-muted-foreground block mb-1">Właściwość</label>
          <Select value={effectiveSite} onValueChange={setSiteUrl}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Wybierz właściwość" />
            </SelectTrigger>
            <SelectContent>
              {(sitesQ.data?.sites ?? []).map((s) => (
                <SelectItem key={s.siteUrl} value={s.siteUrl}>
                  {s.siteUrl}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Okno</label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 text-sm w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dni</SelectItem>
              <SelectItem value="28">28 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Grupuj wg</label>
          <Select value={dim} onValueChange={(v) => setDim(v as typeof dim)}>
            <SelectTrigger className="h-9 text-sm w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="query">Zapytanie</SelectItem>
              <SelectItem value="page">Strona</SelectItem>
              <SelectItem value="country">Kraj</SelectItem>
              <SelectItem value="device">Urządzenie</SelectItem>
              <SelectItem value="date">Dzień</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => dataQ.refetch()}
          className="h-9"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Odśwież
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Kliknięcia" value={totals.clicks.toLocaleString("pl-PL")} />
        <KpiCard label="Wyświetlenia" value={totals.impressions.toLocaleString("pl-PL")} />
        <KpiCard
          label="CTR"
          value={
            totals.impressions
              ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%`
              : "-"
          }
        />
        <KpiCard label="Wierszy" value={String(dataQ.data?.rows.length ?? 0)} />
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-border text-sm font-semibold flex items-center gap-2">
          <SearchIcon className="w-4 h-4" /> Top {dim === "query" ? "zapytania" : dim === "page" ? "strony" : dim === "country" ? "kraje" : dim === "device" ? "urządzenia" : "dni"}
        </div>
        {dataQ.isLoading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Ładowanie danych GSC...
          </div>
        ) : (
          <GscTable rows={dataQ.data?.rows ?? []} />
        )}
      </Card>
    </div>
  );
}

function GscTable({ rows }: { rows: GscRow[] }) {
  if (!rows.length) {
    return <div className="p-6 text-sm text-muted-foreground">Brak danych w tym oknie.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Klucz</th>
            <th className="text-right px-3 py-2">Kliknięcia</th>
            <th className="text-right px-3 py-2">Wyświetlenia</th>
            <th className="text-right px-3 py-2">CTR</th>
            <th className="text-right px-3 py-2">Pozycja</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              <td className="px-3 py-2 truncate max-w-[380px]">{r.keys.join(" / ")}</td>
              <td className="text-right px-3 py-2 tabular-nums">{r.clicks.toLocaleString("pl-PL")}</td>
              <td className="text-right px-3 py-2 tabular-nums">{r.impressions.toLocaleString("pl-PL")}</td>
              <td className="text-right px-3 py-2 tabular-nums">{(r.ctr * 100).toFixed(2)}%</td>
              <td className="text-right px-3 py-2 tabular-nums">{r.position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------- GA4 panel ---------

function Ga4Panel({ status }: { status: AnalyticsStatus["ga4"] }) {
  const fetchReport = useServerFn(runGa4Report);
  const [days, setDays] = useState<number>(28);
  const [dim, setDim] = useState<string>("date");

  const reportQ = useQuery({
    queryKey: ["ga4-report", days, dim],
    queryFn: () =>
      fetchReport({
        data: {
          startDate: `${days}daysAgo`,
          endDate: "today",
          dimensions: [dim],
          metrics: ["sessions", "activeUsers", "screenPageViews", "engagementRate"],
          limit: 100,
        },
      }),
    enabled: status.configured,
  });

  if (!status.configured) {
    return (
      <Card className="p-6 space-y-3">
        <div className="text-sm font-semibold">Podłącz Google Analytics 4</div>
        <ol className="list-decimal pl-5 text-sm text-muted-foreground space-y-2">
          <li>
            W Google Cloud Console utwórz <b>Service Account</b> z rolą „Viewer" na projekcie i wygeneruj klucz JSON.
          </li>
          <li>
            W Google Analytics 4 → <b>Admin</b> → <b>Property access management</b> dodaj adres e-mail service accounta jako „Viewer".
          </li>
          <li>
            W Lovable dodaj sekrety: <code className="text-xs">GA4_SERVICE_ACCOUNT_JSON</code> (cała treść pliku JSON) oraz <code className="text-xs">GA4_PROPERTY_ID</code> (numeryczne ID właściwości).
          </li>
        </ol>
        <div className="text-xs text-muted-foreground">
          Stan: service account {status.hasServiceAccount ? <Badge>OK</Badge> : <Badge variant="outline">brak</Badge>} · property id {status.hasPropertyId ? <Badge>OK</Badge> : <Badge variant="outline">brak</Badge>}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Okno</label>
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="h-9 text-sm w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 dni</SelectItem>
              <SelectItem value="28">28 dni</SelectItem>
              <SelectItem value="90">90 dni</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Wymiar</label>
          <Select value={dim} onValueChange={setDim}>
            <SelectTrigger className="h-9 text-sm w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Dzień</SelectItem>
              <SelectItem value="pagePath">Strona</SelectItem>
              <SelectItem value="sessionSource">Źródło</SelectItem>
              <SelectItem value="country">Kraj</SelectItem>
              <SelectItem value="deviceCategory">Urządzenie</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => reportQ.refetch()} className="h-9">
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Odśwież
        </Button>
      </div>

      <Ga4Totals report={reportQ.data} loading={reportQ.isLoading} />

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-border text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> GA4 raport
        </div>
        {reportQ.isLoading ? (
          <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Ładowanie...
          </div>
        ) : reportQ.data?.error ? (
          <div className="p-6 text-sm text-destructive">{reportQ.data.error}</div>
        ) : (
          <Ga4Table report={reportQ.data} />
        )}
      </Card>
    </div>
  );
}

function Ga4Totals({ report, loading }: { report: Ga4Report | undefined; loading: boolean }) {
  if (loading || !report) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <KpiCard key={i} label="-" value="-" />
        ))}
      </div>
    );
  }
  const labels: Record<string, string> = {
    sessions: "Sesje",
    activeUsers: "Aktywni użytkownicy",
    screenPageViews: "Odsłony",
    engagementRate: "Zaangażowanie",
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {report.metricHeaders.map((h, i) => {
        const raw = report.totals[i] ?? "0";
        const num = Number(raw);
        const display = h === "engagementRate"
          ? `${(num * 100).toFixed(1)}%`
          : Number.isFinite(num) ? num.toLocaleString("pl-PL") : raw;
        return <KpiCard key={h} label={labels[h] ?? h} value={display} />;
      })}
    </div>
  );
}

function Ga4Table({ report }: { report: Ga4Report | undefined }) {
  if (!report || !report.rows.length) {
    return <div className="p-6 text-sm text-muted-foreground">Brak danych w tym oknie.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {report.dimensionHeaders.map((h) => (
              <th key={h} className="text-left px-3 py-2">{h}</th>
            ))}
            {report.metricHeaders.map((h) => (
              <th key={h} className="text-right px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {r.dims.map((v, j) => (
                <td key={j} className="px-3 py-2 truncate max-w-[280px]">{v}</td>
              ))}
              {r.metrics.map((v, j) => (
                <td key={j} className="text-right px-3 py-2 tabular-nums">
                  {Number.isFinite(Number(v)) ? Number(v).toLocaleString("pl-PL", { maximumFractionDigits: 2 }) : v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------- Vitals mini card ---------

function VitalsMiniPanel() {
  const fetchVitals = useServerFn(getVitalsSummary);
  const q = useQuery({
    queryKey: ["analytics-vitals-mini"],
    queryFn: () => fetchVitals({ data: { days: 7 } }),
  });
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4" /> Web Vitals (7 dni)
        </div>
        <a
          href="/admin/performance"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          Szczegóły <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {q.isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> Ładowanie...
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {(q.data?.metrics ?? []).slice(0, 3).map((m) => (
            <div key={m.metric} className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.metric}</div>
              <div className="text-lg font-semibold tabular-nums">
                {m.metric === "CLS" ? m.p75.toFixed(3) : `${Math.round(m.p75)} ${m.p75 >= 1000 ? "" : "ms"}`}
              </div>
              <div className="text-[10px] text-muted-foreground">{m.count} próbek</div>
            </div>
          ))}
          {!(q.data?.metrics ?? []).length && (
            <div className="col-span-3 text-xs text-muted-foreground">Brak próbek.</div>
          )}
        </div>
      )}
    </Card>
  );
}

// --------- Overview ---------

function OverviewPanel({ status }: { status: AnalyticsStatus }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusPill
          ok={status.gsc.configured}
          label="Google Search Console"
          detail={status.gsc.configured ? "Podłączone (OAuth)" : "Wymaga podłączenia connectora"}
        />
        <StatusPill
          ok={status.ga4.configured}
          label="Google Analytics 4"
          detail={
            status.ga4.configured
              ? `Property ${status.ga4.propertyId}`
              : status.ga4.hasServiceAccount
                ? "Brak GA4_PROPERTY_ID"
                : "Brak service accounta"
          }
        />
        <StatusPill ok={status.vitals.configured} label="Web Vitals" detail="Real user monitoring" />
      </div>

      <VitalsMiniPanel />

      <Card className="p-4 text-sm space-y-2">
        <div className="font-semibold">Jak podłączyć klucze Google?</div>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>
            <b>Search Console</b> — Lovable łączy przez OAuth. Otwórz Ustawienia projektu → Konektory → Google Search Console.
          </li>
          <li>
            <b>Google Analytics 4</b> — dodaj sekrety <code>GA4_SERVICE_ACCOUNT_JSON</code> i <code>GA4_PROPERTY_ID</code>, a service account dodaj jako Viewer w GA4.
          </li>
          <li>
            <b>Web Vitals</b> — dane RUM zbierane automatycznie z rzeczywistego ruchu.
          </li>
        </ul>
      </Card>
    </div>
  );
}

// --------- KPI card ---------

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
    </Card>
  );
}

// --------- Root ---------

function AnalyticsPage() {
  const { t } = useTranslation();
  const fetchStatus = useServerFn(getAnalyticsStatus);
  const statusQ = useQuery({
    queryKey: ["analytics-status"],
    queryFn: () => fetchStatus(),
    staleTime: 30_000,
  });
  const [tab, setTab] = useState("overview");

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Activity className="w-6 h-6" />
            {t("admin.nav.analytics", { defaultValue: "Analityka i wydajność" })}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Google Analytics 4, Search Console oraz Web Vitals w jednym miejscu.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => statusQ.refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> Odśwież status
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="w-3.5 h-3.5 mr-2" /> Przegląd
          </TabsTrigger>
          <TabsTrigger value="ga4">
            <BarChart3 className="w-3.5 h-3.5 mr-2" /> GA4
          </TabsTrigger>
          <TabsTrigger value="gsc">
            <SearchIcon className="w-3.5 h-3.5 mr-2" /> Search Console
          </TabsTrigger>
          <TabsTrigger value="vitals">
            <Gauge className="w-3.5 h-3.5 mr-2" /> Web Vitals
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {statusQ.isLoading || !statusQ.data ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Ładowanie statusu...
            </div>
          ) : (
            <OverviewPanel status={statusQ.data} />
          )}
        </TabsContent>

        <TabsContent value="ga4" className="mt-4">
          {statusQ.data ? <Ga4Panel status={statusQ.data.ga4} /> : null}
        </TabsContent>

        <TabsContent value="gsc" className="mt-4">
          {statusQ.data ? <GscPanel configured={statusQ.data.gsc.configured} /> : null}
        </TabsContent>

        <TabsContent value="vitals" className="mt-4">
          <VitalsMiniPanel />
          <div className="mt-3 text-sm text-muted-foreground">
            Pełny widok RUM z rozkładem per ścieżka:{" "}
            <a href="/admin/performance" className="text-primary hover:underline">
              /admin/performance
            </a>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
