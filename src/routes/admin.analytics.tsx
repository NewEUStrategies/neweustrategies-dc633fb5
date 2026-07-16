import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo, useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getAnalyticsStatus, type AnalyticsStatus } from "@/lib/analytics/status.functions";
import { sendGa4Event } from "@/lib/analytics/ga4.functions";
import { getVitalsSummary } from "@/lib/observability/vitals.functions";
import { InsightSection, type Insight } from "@/components/admin/analytics/InsightSection";

// BI dashboards are heavy (ECharts + per-widget datasets). Lazy-load them so
// the SSR route chunk stays under V8's mark-compact ceiling during `build:dev`
// and the browser only pays for the panel the user actually opens.
const GscBiDashboard = lazy(() =>
  import("@/components/admin/analytics/GscBiDashboard").then((m) => ({ default: m.GscBiDashboard })),
);
const Ga4BiDashboard = lazy(() =>
  import("@/components/admin/analytics/Ga4BiDashboard").then((m) => ({ default: m.Ga4BiDashboard })),
);
const VitalsBiDashboard = lazy(() =>
  import("@/components/admin/analytics/VitalsBiDashboard").then((m) => ({ default: m.VitalsBiDashboard })),
);

function DashboardFallback() {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Ładowanie dashboardu…
    </div>
  );
}


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
        <Ga4BiDashboard configured={status.configured} activeMode={status.activeMode ?? undefined} />
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
  return (
    <Card className={"p-4 " + (active ? "border-primary/60 ring-1 ring-primary/30" : "")}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-sm font-semibold">{title}</div>
        <div className="flex items-center gap-2">
          {active && <Badge className="text-[10px]">Aktywny</Badge>}
          {ok ? (
            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/40">
              {badge}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Nieaktywne
            </Badge>
          )}
        </div>
      </div>
      <div className="text-xs text-muted-foreground space-y-2">{children}</div>
    </Card>
  );
}

function Ga4ConfigPanel({ status }: { status: AnalyticsStatus["ga4"] }) {
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
        toast.error(r.error ?? "Brak konfiguracji Measurement Protocol");
        return;
      }
      if (r.ok) toast.success("Event wysłany. GA4 przyjął payload (debug OK).");
      else toast.error(r.error ?? "GA4 odrzucił event - sprawdź debug w konsoli.");
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
        <div className="text-sm font-semibold">Sposoby podłączenia GA4</div>
        <p className="text-xs text-muted-foreground mt-1">
          Wybierz dowolny tryb - sekrety dodaj przez Lovable Cloud → Secrets. Priorytet dla raportów Data API: Service Account → OAuth refresh token.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModeCard
          active={status.activeMode === "service_account"}
          ok={status.hasServiceAccount && status.hasPropertyId}
          title="1. Service Account (JSON)"
          badge="Gotowe"
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>Google Cloud Console → utwórz Service Account, wygeneruj klucz JSON.</li>
            <li>GA4 → Admin → Property access management → dodaj e-mail SA jako Viewer.</li>
            <li>
              Sekrety: <code>GA4_SERVICE_ACCOUNT_JSON</code>, <code>GA4_PROPERTY_ID</code>.
            </li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">SA {status.hasServiceAccount ? "✓" : "×"}</Badge>
            <Badge variant="outline" className="text-[10px]">Property {status.hasPropertyId ? "✓" : "×"}</Badge>
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
          title="2. OAuth 2.0 (refresh token)"
          badge="Gotowe"
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Google Cloud Console → OAuth consent screen + Credentials → utwórz OAuth Client ID typu <b>Desktop app</b>.
            </li>
            <li>
              Wygeneruj refresh_token dla scope{" "}
              <code>https://www.googleapis.com/auth/analytics.readonly</code> (np. OAuth Playground - Use your own OAuth credentials).
            </li>
            <li>
              Sekrety: <code>GA4_OAUTH_CLIENT_ID</code>, <code>GA4_OAUTH_CLIENT_SECRET</code>, <code>GA4_OAUTH_REFRESH_TOKEN</code>, <code>GA4_PROPERTY_ID</code>.
            </li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">Client {status.hasOauthClient ? "✓" : "×"}</Badge>
            <Badge variant="outline" className="text-[10px]">Refresh {status.hasOauthRefresh ? "✓" : "×"}</Badge>
            <Badge variant="outline" className="text-[10px]">Property {status.hasPropertyId ? "✓" : "×"}</Badge>
          </div>
        </ModeCard>

        <ModeCard
          active={status.activeMode === "measurement_protocol"}
          ok={status.hasMeasurementProtocol}
          title="3. Measurement Protocol (server-side events)"
          badge="Gotowe"
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              GA4 → Admin → Data Streams → wybierz strumień web → <b>Measurement Protocol API secrets</b> → utwórz nowy sekret.
            </li>
            <li>
              Sekrety: <code>GA4_MEASUREMENT_ID</code> (np. G-XXXXXXX), <code>GA4_API_SECRET</code>.
            </li>
            <li>Ten tryb służy do <b>wysyłania</b> eventów server-side, nie do czytania raportów.</li>
          </ol>
          <div className="flex flex-wrap gap-2 items-center pt-1">
            <Badge variant="outline" className="text-[10px]">
              Measurement ID {status.hasMeasurementId ? "✓" : "×"}
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
                Wyślij testowy event
              </Button>
            )}
          </div>
        </ModeCard>

        <ModeCard
          active={status.activeMode === "embed"}
          ok={status.hasEmbedUrl}
          title="4. Embed (Looker Studio / iframe)"
          badge="Gotowe"
        >
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Zbuduj raport w <b>Looker Studio</b> na źródle GA4 i użyj File → Embed report → skopiuj URL.
            </li>
            <li>
              Sekret: <code>GA4_EMBED_URL</code> (pełen URL iframe do raportu, np. z lookerstudio.google.com).
            </li>
            <li>Zero uwierzytelniania po naszej stronie - raport renderuje się jako iframe.</li>
          </ol>
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge variant="outline" className="text-[10px]">Embed URL {status.hasEmbedUrl ? "✓" : "×"}</Badge>
          </div>
        </ModeCard>
      </div>
    </Card>
  );
}

function Ga4EmbedCard({ url }: { url: string }) {
  return (
    <Card className="overflow-hidden">
      <div className="p-3 border-b border-border text-sm font-semibold flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> Raport osadzony (Looker Studio)
        </span>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          Otwórz w nowej karcie <ExternalLink className="w-3 h-3" />
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
  const insights: Insight[] = [];
  // GSC
  insights.push({
    id: "gsc",
    element: "Search Console",
    severity: status.gsc.configured ? "good" : "critical",
    title: status.gsc.configured ? "GSC podłączony i zbiera dane" : "Brak połączenia z GSC",
    detail: status.gsc.configured
      ? "OAuth aktywny - dashboard GSC ma dostęp do wszystkich zweryfikowanych właściwości."
      : "Bez GSC nie ma widoczności SERP: brak zapytań, pozycji, CTR i sitemap health.",
    fixes: status.gsc.configured
      ? [
          "Zweryfikuj że wszystkie warianty domeny (http/https, www/apex) są dodane w GSC.",
          "Wgraj świeży sitemap.xml raz w tygodniu (możesz zautomatyzować przez pg_cron).",
        ]
      : [
          "Otwórz Ustawienia → Konektory → Google Search Console i podłącz konto z dostępem do właściwości.",
          "Po podłączeniu odśwież ten panel - dashboard GSC zacznie zbierać dane w ciągu godziny.",
        ],
  });
  // GA4
  insights.push({
    id: "ga4",
    element: "Google Analytics 4",
    severity: status.ga4.configured ? "good" : status.ga4.hasServiceAccount ? "warn" : "critical",
    title: status.ga4.configured
      ? `GA4 aktywny (property ${status.ga4.propertyId})`
      : status.ga4.hasServiceAccount
        ? "Service account jest, brak GA4_PROPERTY_ID"
        : "GA4 nie jest podłączony",
    detail: status.ga4.configured
      ? "Data API odpowiada - masz sesje, źródła, urządzenia, konwersje na dashboardzie GA4."
      : "Bez GA4 nie ma pomiaru zachowań usera po wejściu (bounce, engagement, conversions).",
    fixes: status.ga4.configured
      ? [
          "Skonfiguruj konwersje (kontakt, newsletter) - bez nich engagement rate nie ma kontekstu.",
          "Zdefiniuj mikroeventy (scroll_75, cta_click) - lepsze segmenty.",
        ]
      : status.ga4.hasServiceAccount
        ? ["Dodaj sekret GA4_PROPERTY_ID (numer property, nie tag pomiaru)."]
        : [
            "Zbierz service account JSON z Google Cloud Console (rola Viewer w GA4).",
            "Dodaj sekret GA4_SERVICE_ACCOUNT_JSON + GA4_PROPERTY_ID.",
          ],
  });
  // Vitals
  insights.push({
    id: "vitals",
    element: "Web Vitals",
    severity: status.vitals.configured ? "good" : "warn",
    title: status.vitals.configured ? "RUM zbierany z realnego ruchu" : "Brak samples RUM w oknie",
    detail: status.vitals.configured
      ? "Beacon `/api/public/vitals` odbiera LCP/INP/CLS/FCP/TTFB. Web Vitals BI attribute per podstrona."
      : "Brak próbek zwykle oznacza, że ruch jest zbyt niski lub RUM został wyłączony w consent bannerze.",
    fixes: status.vitals.configured
      ? [
          "Otwórz zakładkę Web Vitals - konkretne rekomendacje per metryka są tam wygenerowane.",
          "Jeśli LCP > 2.5s: preload obrazu bohatera + AVIF/WebP.",
        ]
      : [
          "Sprawdź w Consent Banner że kategoria 'Analytics' jest opcjonalna z domyślnie akceptowaną (jeśli prawnie OK).",
          "W dev otwórz kilka podstron - konsola powinna pokazać `[web-vitals]`.",
        ],
  });

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

      <InsightSection
        title="Stan integracji i rekomendacje"
        subtitle="Analiza gotowości: GSC · GA4 · Web Vitals"
        insights={insights}
      />

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
