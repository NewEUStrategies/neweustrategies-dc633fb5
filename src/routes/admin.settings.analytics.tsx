// Admin analytics config. Powers the ConsentScriptInjector and shows live
// connection status for GA4, Google Search Console and Plausible.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BarChart3, Search, LineChart, Code2, CheckCircle2, XCircle, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { defaultAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics/config";
import { getAnalyticsStatus, type AnalyticsStatus, type Ga4Mode } from "@/lib/analytics/status.functions";
import type { ReactNode } from "react";

export const Route = createFileRoute("/admin/settings/analytics")({
  head: () => ({
    meta: [{ title: "Analityka - Ustawienia" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AnalyticsSettings,
});

type StatusKind = "connected" | "partial" | "off" | "loading";

function StatusBadge({ kind, label }: { kind: StatusKind; label: string }) {
  const map: Record<StatusKind, { icon: ReactNode; cls: string }> = {
    connected: {
      icon: <CheckCircle2 className="w-3.5 h-3.5" />,
      cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
    },
    partial: {
      icon: <AlertTriangle className="w-3.5 h-3.5" />,
      cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
    },
    off: {
      icon: <XCircle className="w-3.5 h-3.5" />,
      cls: "bg-muted text-muted-foreground border-border",
    },
    loading: {
      icon: <RefreshCw className="w-3.5 h-3.5 animate-spin" />,
      cls: "bg-muted text-muted-foreground border-border",
    },
  };
  const { icon, cls } = map[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide px-2 py-1 rounded-md border ${cls}`}
    >
      {icon}
      {label}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  desc,
  status,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-lg leading-tight">{title}</h3>
            <p className="text-sm text-muted-foreground mt-1">{desc}</p>
          </div>
        </div>
        {status}
      </header>
      <div className="space-y-0">{children}</div>
    </Card>
  );
}

function ga4Kind(s: AnalyticsStatus["ga4"] | undefined, measurementId: string): StatusKind {
  if (!s) return "loading";
  if (s.configured) return "connected";
  if (measurementId.trim() || s.hasMeasurementId || s.hasEmbedUrl) return "partial";
  return "off";
}

function modeKey(mode: Ga4Mode): string {
  return mode ?? "none";
}

function AnalyticsSettings() {
  const { t } = useTranslation();
  const { query, save } = useSettings<AnalyticsConfig>("analytics", defaultAnalyticsConfig());
  const [draft, setDraft] = useDraft(query.data);

  const fetchStatus = useServerFn(getAnalyticsStatus);
  const statusQ = useQuery({
    queryKey: ["analytics-status"],
    queryFn: () => fetchStatus(),
    staleTime: 30_000,
  });

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const set = <K extends keyof AnalyticsConfig>(k: K, v: AnalyticsConfig[K]) =>
    setDraft({ ...draft, [k]: v });

  const st = statusQ.data;
  const tStatus = {
    connected: t("admin.analyticsSettings.status.connected"),
    off: t("admin.analyticsSettings.status.notConfigured"),
    partial: t("admin.analyticsSettings.status.partial"),
    loading: t("admin.analyticsSettings.status.checking"),
  };
  const badge = (k: StatusKind) => <StatusBadge kind={k} label={tStatus[k === "off" ? "off" : k]} />;

  const ga4K = ga4Kind(st?.ga4, draft.ga4_measurement_id);
  const gscK: StatusKind = !st ? "loading" : st.gsc.configured ? "connected" : "off";
  const plausibleK: StatusKind = draft.plausible_domain.trim() ? "connected" : "off";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight">
            {t("admin.analyticsSettings.title")}
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            {t("admin.analyticsSettings.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => statusQ.refetch()} disabled={statusQ.isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 mr-2 ${statusQ.isFetching ? "animate-spin" : ""}`} />
          {tStatus.loading}
        </Button>
      </header>

      {/* GA4 */}
      <SectionCard
        icon={<BarChart3 className="w-5 h-5" />}
        title={t("admin.analyticsSettings.ga4.title")}
        desc={t("admin.analyticsSettings.ga4.desc")}
        status={badge(ga4K)}
      >
        <Field
          label={t("admin.analyticsSettings.ga4.measurementId")}
          hint={t("admin.analyticsSettings.ga4.measurementIdHint")}
        >
          <Text
            value={draft.ga4_measurement_id}
            onChange={(e) => set("ga4_measurement_id", e.target.value)}
            placeholder="G-XXXXXXXXXX"
          />
        </Field>
        <Field
          label={t("admin.analyticsSettings.ga4.gtm")}
          hint={t("admin.analyticsSettings.ga4.gtmHint")}
        >
          <Text
            value={draft.gtm_container_id}
            onChange={(e) => set("gtm_container_id", e.target.value)}
            placeholder="GTM-XXXXXXX"
          />
        </Field>
        {st?.ga4 && (
          <Field label={t("admin.analyticsSettings.ga4.activeMode")}>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-sm">
                {t(`admin.analyticsSettings.ga4.modes.${modeKey(st.ga4.activeMode)}`)}
              </span>
              {st.ga4.serviceAccountEmail && (
                <code className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded">
                  {st.ga4.serviceAccountEmail}
                </code>
              )}
              {st.ga4.propertyId && (
                <code className="text-[11px] text-muted-foreground bg-muted px-2 py-1 rounded">
                  properties/{st.ga4.propertyId}
                </code>
              )}
            </div>
          </Field>
        )}
      </SectionCard>

      {/* GSC */}
      <SectionCard
        icon={<Search className="w-5 h-5" />}
        title={t("admin.analyticsSettings.gsc.title")}
        desc={t("admin.analyticsSettings.gsc.desc")}
        status={badge(gscK)}
      >
        <div className="py-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            {gscK === "connected"
              ? t("admin.analyticsSettings.gsc.managed")
              : t("admin.analyticsSettings.gsc.needsConnector")}
          </p>
          <div>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/analytics">
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                {t("admin.analyticsSettings.gsc.openDashboard")}
              </Link>
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Plausible */}
      <SectionCard
        icon={<LineChart className="w-5 h-5" />}
        title={t("admin.analyticsSettings.plausible.title")}
        desc={t("admin.analyticsSettings.plausible.desc")}
        status={badge(plausibleK)}
      >
        <Field label={t("admin.analyticsSettings.plausible.domain")}>
          <Text
            value={draft.plausible_domain}
            onChange={(e) => set("plausible_domain", e.target.value)}
            placeholder="example.com"
          />
        </Field>
        <Field label={t("admin.analyticsSettings.plausible.scriptUrl")}>
          <Text
            value={draft.plausible_script_url}
            onChange={(e) => set("plausible_script_url", e.target.value)}
            placeholder="https://plausible.io/js/script.js"
          />
        </Field>
      </SectionCard>

      {/* Custom scripts */}
      <SectionCard
        icon={<Code2 className="w-5 h-5" />}
        title={t("admin.analyticsSettings.custom.title")}
        desc={t("admin.analyticsSettings.custom.desc")}
      >
        <Field label={t("admin.analyticsSettings.custom.head")}>
          <textarea
            value={draft.custom_head_html}
            onChange={(e) => set("custom_head_html", e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
        <Field label={t("admin.analyticsSettings.custom.body")}>
          <textarea
            value={draft.custom_body_html}
            onChange={(e) => set("custom_body_html", e.target.value)}
            rows={5}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </Field>
      </SectionCard>

      <SaveBar saving={save.isPending} onSave={() => save.mutate(draft)} />
    </div>
  );
}
