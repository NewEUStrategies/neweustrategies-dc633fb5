import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
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
  Users,
  Scale,
  MousePointerClick,
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { adminToast } from "@/lib/adminToasts";
import { getAnalyticsStatus, type AnalyticsStatus } from "@/lib/analytics/status.functions";
import { sendGa4Event } from "@/lib/analytics/ga4.functions";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";
import { InsightSection, type Insight } from "@/components/admin/analytics/InsightSection";
// Nakładka wnosi gałąź `admin.analyticsPanel.*` - bez tego importu i18next
// nie ma tych kluczy i panel renderuje surowe identyfikatory.
import "@/lib/i18n-admin-extras";

// BI dashboards are heavy (ECharts + per-widget datasets). Lazy-load them so
// the SSR route chunk stays under V8's mark-compact ceiling during `build:dev`
// and the browser only pays for the panel the user actually opens.
const GscBiDashboard = lazy(() =>
  import("@/components/admin/analytics/GscBiDashboard").then((m) => ({
    default: m.GscBiDashboard,
  })),
);
const FooterAnalyticsPanel = lazy(() =>
  import("@/components/admin/analytics/FooterAnalyticsPanel").then((m) => ({
    default: m.FooterAnalyticsPanel,
  })),
);

const Ga4BiDashboard = lazy(() =>
  import("@/components/admin/analytics/Ga4BiDashboard").then((m) => ({
    default: m.Ga4BiDashboard,
  })),
);
const VitalsBiDashboard = lazy(() =>
  import("@/components/admin/analytics/VitalsBiDashboard").then((m) => ({
    default: m.VitalsBiDashboard,
  })),
);
const AudienceSegmentsDashboard = lazy(() =>
  import("@/components/admin/analytics/AudienceSegmentsDashboard").then((m) => ({
    default: m.AudienceSegmentsDashboard,
  })),
);
// Warstwa semantyczna: jedna definicja metryki, jedno okno, jedna liczba do
// raportu plus werdykt uzgodnienia dla pozostałych strumieni.
const SemanticReconciliationPanel = lazy(() =>
  import("@/components/admin/analytics/semantic/organisms/SemanticReconciliationPanel").then(
    (m) => ({ default: m.SemanticReconciliationPanel }),
  ),
);

function DashboardFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {t("admin.analyticsPanel.loadingDashboard")}
    </div>
  );
}

export const Route = createFileRoute("/admin/analytics/")({
  head: () => ({
    meta: [
      { title: "Analityka i wydajność - Admin" },
      {
        name: "description",
        content: "Google Analytics 4, Search Console i Web Vitals w jednym panelu.",
      },
    ],
  }),
  component: AnalyticsPage,
});

// --------- Status pills ---------

interface PillProps {
  ok: boolean;
  label: string;
  detail?: string;
}
function StatusPill({ ok, label, detail }: PillProps) {
  const { t } = useTranslation();
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
          {ok
            ? (detail ?? t("admin.analyticsPanel.pill.connected"))
            : (detail ?? t("admin.analyticsPanel.pill.notConfigured"))}
        </div>
      </div>
    </Card>
  );
}

// --------- GSC panel ---------
// Renderowanie i pobieranie danych GSC żyje teraz w komponencie
// `GscBiDashboard` (patrz src/components/admin/analytics). Ten route trzyma
// wyłącznie warstwę tabów + statusu, żeby nie duplikować logiki wykresów.

// --------- GA4 panel ---------

function Ga4Panel({ status }: { status: AnalyticsStatus["ga4"] }) {
  // Panel konfiguracji trybów - zawsze widoczny, żeby admin mógł włączyć
  // dowolny sposób (Service Account, OAuth refresh, Measurement Protocol, Embed).
  const configPanel = <Ga4ConfigPanel status={status} />;

  if (!status.configured) {
    return (
      <div className="space-y-4">
        {configPanel}
        {status.hasEmbedUrl && status.embedUrl ? <Ga4EmbedCard url={status.embedUrl} /> : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={<DashboardFallback />}>
        <Ga4BiDashboard
          configured={status.configured}
          activeMode={status.activeMode ?? undefined}
        />
      </Suspense>
      {status.hasEmbedUrl && status.embedUrl ? <Ga4EmbedCard url={status.embedUrl} /> : null}
      {configPanel}
    </div>
  );
}

// --------- GA4 config panel (4 modes) ---------

interface ModeCardProps {
  active: boolean;
  ok: boolean;
  title: string;
  badge: string;
  children: React.ReactNode;
}

function ModeCard({ active, ok, title, badge, children }: ModeCardProps) {
  const { t } = useTranslation();
  return (
    <Card className={"p-4 " + (active ? "border-primary/60 ring-1 ring-primary/30" : "")}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-2">
          {active && (
            <Badge className="text-[10px]">{t("admin.analyticsPanel.ga4Modes.active")}</Badge>
          )}
          {ok ? (
            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">
              {badge}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {t("admin.analyticsPanel.ga4Modes.inactive")}
            </Badge>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground space-y-2">{children}</div>
    </Card>
  );
}

function Ga4ConfigPanel({ status }: { status: AnalyticsStatus["ga4"] }) {
  const { t } = useTranslation();
  const send = useServerFn(sendGa4Event);
  const [sending, setSending] = useState(false);

  async function testEvent() {
    setSending(true);
    try {
      const r = await send({
        data: {
          clientId: `admin-${Date.now()}`,
          eventName: "admin_test_event",
          params: { source: "admin_analytics_page" },
          debug: true,
        },
      });
      if (!r.configured) {
        toast.error(r.error ?? adminToast.ga4NotConfigured());
        return;
      }
      if (r.ok) toast.success(adminToast.ga4Accepted());
      else toast.error(r.error ?? adminToast.ga4Rejected());
      if (r.debug) console.info("[GA4 Debug]", r.debug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-4 space-y-4">
      <div>
        <div className="text-sm font-semibold">{t("admin.analyticsPanel.ga4Modes.title")}</div>
        <p className="text-xs text-muted-foreground mt-1">
          {t("admin.analyticsPanel.ga4Modes.intro")}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModeCard
          active={status.activeMode === "service_account"}
          ok={status.hasServiceAccount && status.hasPropertyId}
          title={t("admin.analyticsPanel.ga4Modes.serviceAccount.title")}
          badge={t("admin.analyticsPanel.ga4Modes.ready")}
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>{t("admin.analyticsPanel.ga4Modes.serviceAccount.step1")}</li>
            <li>{t("admin.analyticsPanel.ga4Modes.serviceAccount.step2")}</li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.secrets")} <code>GA4_SERVICE_ACCOUNT_JSON</code>,{" "}
              <code>GA4_PROPERTY_ID</code>
            </li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">
              SA {status.hasServiceAccount ? "✓" : "×"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Property {status.hasPropertyId ? "✓" : "×"}
            </Badge>
            {status.serviceAccountEmail && (
              <Badge variant="outline" className="text-[10px] truncate max-w-[220px]">
                {status.serviceAccountEmail}
              </Badge>
            )}
          </div>
        </ModeCard>

        <ModeCard
          active={status.activeMode === "oauth_refresh"}
          ok={status.hasOauthClient && status.hasOauthRefresh && status.hasPropertyId}
          title={t("admin.analyticsPanel.ga4Modes.oauth.title")}
          badge={t("admin.analyticsPanel.ga4Modes.ready")}
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>{t("admin.analyticsPanel.ga4Modes.oauth.step1")}</li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.oauth.step2Before")}{" "}
              <code>https://www.googleapis.com/auth/analytics.readonly</code>{" "}
              {t("admin.analyticsPanel.ga4Modes.oauth.step2After")}
            </li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.secrets")} <code>GA4_OAUTH_CLIENT_ID</code>,{" "}
              <code>GA4_OAUTH_CLIENT_SECRET</code>, <code>GA4_OAUTH_REFRESH_TOKEN</code>,{" "}
              <code>GA4_PROPERTY_ID</code>
            </li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">
              Client {status.hasOauthClient ? "✓" : "×"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Refresh {status.hasOauthRefresh ? "✓" : "×"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              Property {status.hasPropertyId ? "✓" : "×"}
            </Badge>
          </div>
        </ModeCard>

        <ModeCard
          active={status.activeMode === "measurement_protocol"}
          ok={status.hasMeasurementProtocol}
          title={t("admin.analyticsPanel.ga4Modes.measurement.title")}
          badge={t("admin.analyticsPanel.ga4Modes.ready")}
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>{t("admin.analyticsPanel.ga4Modes.measurement.step1")}</li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.measurement.step2Before")}{" "}
              <a href="/admin/settings/analytics" className="underline">
                {t("admin.analyticsPanel.ga4Modes.measurement.step2Link")}
              </a>{" "}
              {t("admin.analyticsPanel.ga4Modes.measurement.step2After")}
            </li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.secretProject")} <code>GA4_API_SECRET</code>{" "}
              {t("admin.analyticsPanel.ga4Modes.measurement.secretHint")}
            </li>
            <li>{t("admin.analyticsPanel.ga4Modes.measurement.step3")}</li>
          </ol>
          <div className="flex flex-wrap gap-2 items-center pt-1">
            <Badge variant="outline" className="text-[10px]">
              Measurement ID {status.hasMeasurementId ? "✓" : "×"}
              {status.measurementId ? (
                <span className="ml-1 font-mono opacity-80">{status.measurementId}</span>
              ) : null}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              API secret {status.hasMeasurementProtocol && status.hasMeasurementId ? "✓" : "×"}
            </Badge>
            {status.hasMeasurementProtocol && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs ml-auto"
                onClick={testEvent}
                disabled={sending}
              >
                {sending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
                {t("admin.analyticsPanel.ga4Modes.testEvent")}
              </Button>
            )}
          </div>
        </ModeCard>

        <ModeCard
          active={status.activeMode === "embed"}
          ok={status.hasEmbedUrl}
          title={t("admin.analyticsPanel.ga4Modes.embed.title")}
          badge={t("admin.analyticsPanel.ga4Modes.ready")}
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>{t("admin.analyticsPanel.ga4Modes.embed.step1")}</li>
            <li>
              {t("admin.analyticsPanel.ga4Modes.secretSingle")} <code>GA4_EMBED_URL</code>{" "}
              {t("admin.analyticsPanel.ga4Modes.embed.step2")}
            </li>
            <li>{t("admin.analyticsPanel.ga4Modes.embed.step3")}</li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">
              Embed URL {status.hasEmbedUrl ? "✓" : "×"}
            </Badge>
          </div>
        </ModeCard>
      </div>
    </Card>
  );
}

function Ga4EmbedCard({ url }: { url: string }) {
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b border-border text-sm font-semibold flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> {t("admin.analyticsPanel.embed.title")}
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("admin.analyticsPanel.embed.open")} <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      <iframe
        title="GA4 Looker Studio embed"
        src={url}
        className="w-full"
        style={{ height: 720, border: 0 }}
        allowFullScreen
      />
    </Card>
  );
}

// Ga4Totals / Ga4Table zostały zastąpione przez `Ga4BiDashboard`
// (KPI tiles z delta + trend area + donuty + radar + top strony).

// --------- Vitals mini card ---------

/** Okno mini-panelu RUM w dniach - ta sama liczba idzie do zapytania i do napisu. */
const VITALS_WINDOW_DAYS = 7;

/**
 * Wartość kafelka RUM.
 *
 * CLS jest bezwymiarowy i dostaje trzy miejsca po przecinku (0,083 i 0,08 to
 * dwie różne oceny). KAŻDA metryka czasowa dostaje jednostkę - wcześniej
 * warunek `p75 >= 1000 ? "" : "ms"` gubił ją dokładnie powyżej sekundy, czyli
 * na każdym złym LCP: kafelek, który ma zaalarmować, pokazywał samą liczbę.
 */
function vitalValue(metric: string, p75: number): string {
  if (metric === "CLS") return p75.toFixed(3);
  return `${Math.round(p75)} ms`;
}

function VitalsMiniPanel() {
  const { t } = useTranslation();
  const fetchVitals = useServerFn(getVitalsSummary);
  const q = useQuery({
    queryKey: ["analytics-vitals-mini"],
    queryFn: () => fetchVitals({ data: { days: VITALS_WINDOW_DAYS } }),
  });
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4" />{" "}
          {t("admin.analyticsPanel.vitals.title", { days: VITALS_WINDOW_DAYS })}
        </div>
        <a
          href="/admin/performance"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          {t("admin.analyticsPanel.vitals.details")} <ExternalLink className="w-3 h-3" />
        </a>
      </div>
      {q.isLoading ? (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" /> {t("admin.analyticsPanel.vitals.loading")}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {(q.data?.metrics ?? []).slice(0, 3).map((m) => (
            <div key={m.metric} className="text-center">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {m.metric}
              </div>
              <div className="text-lg font-semibold tabular-nums">
                {vitalValue(m.metric, m.p75)}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {t("admin.analyticsPanel.vitals.samples", { count: m.count })}
              </div>
            </div>
          ))}
          {!(q.data?.metrics ?? []).length && (
            <div className="col-span-3 text-xs text-muted-foreground">
              {t("admin.analyticsPanel.vitals.empty")}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// --------- Overview ---------

function OverviewPanel({ status }: { status: AnalyticsStatus }) {
  const { t } = useTranslation();
  const insights: Insight[] = [];
  // GSC
  insights.push({
    id: "gsc",
    element: t("admin.analyticsPanel.insights.gsc.element"),
    severity: status.gsc.configured ? "good" : "critical",
    title: status.gsc.configured
      ? t("admin.analyticsPanel.insights.gsc.titleOk")
      : t("admin.analyticsPanel.insights.gsc.titleOff"),
    detail: status.gsc.configured
      ? t("admin.analyticsPanel.insights.gsc.detailOk")
      : t("admin.analyticsPanel.insights.gsc.detailOff"),
    fixes: status.gsc.configured
      ? [
          t("admin.analyticsPanel.insights.gsc.fixOkVariants"),
          t("admin.analyticsPanel.insights.gsc.fixOkSitemap"),
        ]
      : [
          t("admin.analyticsPanel.insights.gsc.fixOffConnector"),
          t("admin.analyticsPanel.insights.gsc.fixOffRefresh"),
        ],
  });
  // GA4 - TRZY stany, nie dwa: „podłączone", „jest service account, brak
  // GA4_PROPERTY_ID" i „nic nie ma" mają własną wagę i własny komunikat.
  insights.push({
    id: "ga4",
    element: t("admin.analyticsPanel.insights.ga4.element"),
    severity: status.ga4.configured ? "good" : status.ga4.hasServiceAccount ? "warn" : "critical",
    title: status.ga4.configured
      ? t("admin.analyticsPanel.insights.ga4.titleOk", { propertyId: status.ga4.propertyId })
      : status.ga4.hasServiceAccount
        ? t("admin.analyticsPanel.insights.ga4.titlePartial")
        : t("admin.analyticsPanel.insights.ga4.titleOff"),
    detail: status.ga4.configured
      ? t("admin.analyticsPanel.insights.ga4.detailOk")
      : t("admin.analyticsPanel.insights.ga4.detailOff"),
    fixes: status.ga4.configured
      ? [
          t("admin.analyticsPanel.insights.ga4.fixOkConversions"),
          t("admin.analyticsPanel.insights.ga4.fixOkEvents"),
        ]
      : status.ga4.hasServiceAccount
        ? [t("admin.analyticsPanel.insights.ga4.fixPartialProperty")]
        : [
            t("admin.analyticsPanel.insights.ga4.fixOffServiceAccount"),
            t("admin.analyticsPanel.insights.ga4.fixOffSecrets"),
          ],
  });
  // Vitals
  insights.push({
    id: "vitals",
    element: t("admin.analyticsPanel.insights.vitals.element"),
    severity: status.vitals.configured ? "good" : "warn",
    title: status.vitals.configured
      ? t("admin.analyticsPanel.insights.vitals.titleOk")
      : t("admin.analyticsPanel.insights.vitals.titleOff"),
    detail: status.vitals.configured
      ? t("admin.analyticsPanel.insights.vitals.detailOk")
      : t("admin.analyticsPanel.insights.vitals.detailOff"),
    fixes: status.vitals.configured
      ? [
          t("admin.analyticsPanel.insights.vitals.fixOkTab"),
          t("admin.analyticsPanel.insights.vitals.fixOkLcp"),
        ]
      : [
          t("admin.analyticsPanel.insights.vitals.fixOffConsent"),
          t("admin.analyticsPanel.insights.vitals.fixOffDev"),
        ],
  });

  return (
    <div className="space-y-4">
      {/* Nagłówek DRUGIEGO poziomu. Trasa daje `<h1>`, a współdzielony
          `InsightSection` renderuje `<h3>`: bez tego poziomu czytnik ekranu
          ogłasza zejście o dwa stopnie i pokazuje wnioski jako pod-pod-sekcję
          czegoś, czego w dokumencie nie ma (axe: `heading-order`). Poprawka
          stoi PO STRONIE TRASY, bo `InsightSection` jest współdzielony przez
          sześć pulpitów BI i jego poziom nie jest tu do ruszenia. */}
      <h2 className="text-sm font-semibold tracking-tight">
        {t("admin.analyticsPanel.overviewHeading")}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatusPill
          ok={status.gsc.configured}
          label={t("admin.analyticsPanel.pill.gsc")}
          detail={
            status.gsc.configured
              ? t("admin.analyticsPanel.pill.gscConnected")
              : t("admin.analyticsPanel.pill.gscNeedsConnector")
          }
        />
        <StatusPill
          ok={status.ga4.configured}
          label={t("admin.analyticsPanel.pill.ga4")}
          detail={
            status.ga4.configured
              ? t("admin.analyticsPanel.pill.ga4Property", { propertyId: status.ga4.propertyId })
              : status.ga4.hasServiceAccount
                ? t("admin.analyticsPanel.pill.ga4NoProperty")
                : t("admin.analyticsPanel.pill.ga4NoServiceAccount")
          }
        />
        <StatusPill
          ok={status.vitals.configured}
          label={t("admin.analyticsPanel.pill.vitals")}
          detail={t("admin.analyticsPanel.pill.vitalsDetail")}
        />
      </div>

      <VitalsMiniPanel />

      <InsightSection
        title={t("admin.analyticsPanel.insights.title")}
        subtitle={t("admin.analyticsPanel.insights.subtitle")}
        insights={insights}
      />

      <Card className="p-4 text-sm space-y-2">
        <div className="font-semibold">{t("admin.analyticsPanel.keys.title")}</div>
        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
          <li>
            <b>{t("admin.analyticsPanel.insights.gsc.element")}</b>
            {" - "}
            {t("admin.analyticsPanel.keys.gsc")}
          </li>
          <li>
            <b>{t("admin.analyticsPanel.pill.ga4")}</b>
            {" - "}
            {t("admin.analyticsPanel.keys.ga4")} <code>GA4_SERVICE_ACCOUNT_JSON</code>,{" "}
            <code>GA4_PROPERTY_ID</code>
          </li>
          <li>
            <b>{t("admin.analyticsPanel.pill.vitals")}</b>
            {" - "}
            {t("admin.analyticsPanel.keys.vitals")}
          </li>
        </ul>
      </Card>
    </div>
  );
}

// --------- KPI card ---------

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
            {t("admin.nav.analytics")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.analyticsPanel.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => statusQ.refetch()}>
          <RefreshCw className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.refresh")}
        </Button>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <Activity className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="ga4">
            <BarChart3 className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.tabs.ga4")}
          </TabsTrigger>
          <TabsTrigger value="gsc">
            <SearchIcon className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.tabs.gsc")}
          </TabsTrigger>
          <TabsTrigger value="vitals">
            <Gauge className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.tabs.vitals")}
          </TabsTrigger>
          <TabsTrigger value="audience">
            <Users className="w-3.5 h-3.5 mr-2" /> {t("admin.analyticsPanel.tabs.audience")}
          </TabsTrigger>
          <TabsTrigger value="semantic">
            <Scale className="w-3.5 h-3.5 mr-2" /> {t("admin.nav.analyticsReconciliation")}
          </TabsTrigger>
          <TabsTrigger value="footer">
            <MousePointerClick className="w-3.5 h-3.5 mr-2" />{" "}
            {t("admin.analyticsPanel.tabs.footer")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          {statusQ.isLoading || !statusQ.data ? (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("admin.analyticsPanel.loadingStatus")}
            </div>
          ) : (
            <OverviewPanel status={statusQ.data} />
          )}
        </TabsContent>

        <TabsContent value="ga4" className="mt-4">
          {statusQ.data ? <Ga4Panel status={statusQ.data.ga4} /> : null}
        </TabsContent>

        <TabsContent value="gsc" className="mt-4">
          {statusQ.data ? (
            <Suspense fallback={<DashboardFallback />}>
              <GscBiDashboard configured={statusQ.data.gsc.configured} />
            </Suspense>
          ) : null}
        </TabsContent>

        <TabsContent value="vitals" className="mt-4">
          <Suspense fallback={<DashboardFallback />}>
            <VitalsBiDashboard />
          </Suspense>
          <div className="mt-3 text-sm text-muted-foreground">
            {t("admin.analyticsPanel.vitals.fullView")}{" "}
            <a href="/admin/performance" className="text-primary hover:underline">
              /admin/performance
            </a>
          </div>
        </TabsContent>

        <TabsContent value="audience" className="mt-4">
          <Suspense fallback={<DashboardFallback />}>
            <AudienceSegmentsDashboard />
          </Suspense>
        </TabsContent>

        <TabsContent value="semantic" className="mt-4">
          <Suspense fallback={<DashboardFallback />}>
            <SemanticReconciliationPanel />
          </Suspense>
        </TabsContent>

        <TabsContent value="footer" className="mt-4">
          <Suspense fallback={<DashboardFallback />}>
            <FooterAnalyticsPanel />
          </Suspense>
        </TabsContent>
      </Tabs>
    </div>
  );
}
