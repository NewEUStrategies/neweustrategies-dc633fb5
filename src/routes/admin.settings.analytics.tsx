// Admin analytics config. Powers the ConsentScriptInjector and shows live
// connection status for GA4, Google Search Console and Plausible.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  BarChart3,
  Search,
  LineChart,
  Code2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  Plug,
  PlugZap,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { useSettings, useDraft } from "@/lib/admin/useSettings";
import { Field, Text, SaveBar } from "@/components/admin/settings/fields";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { defaultAnalyticsConfig, type AnalyticsConfig } from "@/lib/analytics/config";
import { getAnalyticsStatus, type AnalyticsStatus, type Ga4Mode } from "@/lib/analytics/status.functions";
import type { ReactNode } from "react";

export const Route = createFileRoute("/admin/settings/analytics")({
  head: () => ({
    meta: [{ title: "Analityka - Ustawienia" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AnalyticsSettings,
});

type StatusKind = "connected" | "partial" | "off" | "loading" | "disabled";

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
    disabled: {
      icon: <Unplug className="w-3.5 h-3.5" />,
      cls: "bg-destructive/10 text-destructive border-destructive/30",
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
  actions,
  children,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
  status?: ReactNode;
  actions?: ReactNode;
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
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {actions}
        </div>
      </header>
      <div className="space-y-0">{children}</div>
    </Card>
  );
}

function ga4Kind(
  s: AnalyticsStatus["ga4"] | undefined,
  measurementId: string,
  enabled: boolean,
): StatusKind {
  if (!s) return "loading";
  if (!enabled) return "disabled";
  if (s.configured) return "connected";
  if (measurementId.trim() || s.hasMeasurementId || s.hasEmbedUrl || s.hasPropertyId) return "partial";
  return "off";
}

function modeKey(mode: Ga4Mode): string {
  return mode ?? "none";
}

interface Ga4ConnectDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialPropertyId: string;
  initialMeasurementId: string;
  missingSecrets: string[];
  saving: boolean;
  onSubmit: (input: { propertyId: string; measurementId: string }) => void;
}

function Ga4ConnectDialog({
  open,
  onOpenChange,
  initialPropertyId,
  initialMeasurementId,
  missingSecrets,
  saving,
  onSubmit,
}: Ga4ConnectDialogProps) {
  const { t } = useTranslation();
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [measurementId, setMeasurementId] = useState(initialMeasurementId);
  // Reset local state when dialog reopens with new initial values.
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setPropertyId(initialPropertyId);
      setMeasurementId(initialMeasurementId);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("admin.analyticsSettings.ga4.connectTitle")}</DialogTitle>
          <DialogDescription>
            {t("admin.analyticsSettings.ga4.connectDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="font-medium">{t("admin.analyticsSettings.ga4.propertyId")}</span>
            <Text
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              placeholder="123456789"
              className="mt-1"
            />
            <span className="mt-1 block text-xs text-muted-foreground">
              {t("admin.analyticsSettings.ga4.propertyIdHint")}
            </span>
          </label>
          <label className="block text-sm">
            <span className="font-medium">{t("admin.analyticsSettings.ga4.measurementId")}</span>
            <Text
              value={measurementId}
              onChange={(e) => setMeasurementId(e.target.value)}
              placeholder="G-XXXXXXXXXX"
              className="mt-1"
            />
          </label>
          {missingSecrets.length > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                {t("admin.analyticsSettings.ga4.secretsNeeded")}
              </p>
              <ul className="text-xs font-mono space-y-1">
                {missingSecrets.map((s) => (
                  <li key={s} className="text-foreground">{s}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                {t("admin.analyticsSettings.ga4.secretsHint")}
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("admin.analyticsSettings.ga4.cancel")}
          </Button>
          <Button
            onClick={() => onSubmit({ propertyId: propertyId.trim(), measurementId: measurementId.trim() })}
            disabled={saving}
          >
            {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <PlugZap className="w-4 h-4 mr-2" />}
            {t("admin.analyticsSettings.ga4.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnalyticsSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { query, save } = useSettings<AnalyticsConfig>("analytics", defaultAnalyticsConfig());
  const [draft, setDraft] = useDraft(query.data);
  const [ga4Dialog, setGa4Dialog] = useState(false);
  const [ga4Saving, setGa4Saving] = useState(false);

  const fetchStatus = useServerFn(getAnalyticsStatus);
  const statusQ = useQuery({
    queryKey: ["analytics-status"],
    queryFn: () => fetchStatus(),
    staleTime: 30_000,
  });

  if (!draft) return <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>;

  const set = <K extends keyof AnalyticsConfig>(k: K, v: AnalyticsConfig[K]) =>
    setDraft({ ...draft, [k]: v });

  // Persist a mutation to the analytics config and auto-refresh status.
  const persist = async (next: AnalyticsConfig) => {
    await save.mutateAsync(next);
    await qc.invalidateQueries({ queryKey: ["analytics-status"] });
  };

  const st = statusQ.data;
  const tStatus = {
    connected: t("admin.analyticsSettings.status.connected"),
    off: t("admin.analyticsSettings.status.notConfigured"),
    partial: t("admin.analyticsSettings.status.partial"),
    loading: t("admin.analyticsSettings.status.checking"),
    disabled: t("admin.analyticsSettings.ga4.disabled"),
  };
  const badge = (k: StatusKind) => <StatusBadge kind={k} label={tStatus[k]} />;

  const ga4K = ga4Kind(st?.ga4, draft.ga4_measurement_id, draft.ga4_enabled);
  const gscK: StatusKind = !st ? "loading" : st.gsc.configured ? "connected" : "off";
  const plausibleK: StatusKind = draft.plausible_domain.trim() ? "connected" : "off";

  const openGa4Connect = () => setGa4Dialog(true);
  const submitGa4Connect = async ({
    propertyId,
    measurementId,
  }: {
    propertyId: string;
    measurementId: string;
  }) => {
    setGa4Saving(true);
    try {
      const next: AnalyticsConfig = {
        ...draft,
        ga4_property_id: propertyId,
        ga4_measurement_id: measurementId,
        ga4_enabled: true,
      };
      setDraft(next);
      await persist(next);
      toast.success(t("admin.analyticsSettings.status.connected"));
      setGa4Dialog(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setGa4Saving(false);
    }
  };
  const disconnectGa4 = async () => {
    if (!window.confirm(t("admin.analyticsSettings.ga4.confirmDisconnect"))) return;
    const next: AnalyticsConfig = { ...draft, ga4_enabled: false };
    setDraft(next);
    try {
      await persist(next);
      toast.success(t("admin.analyticsSettings.ga4.disabled"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

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
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {ga4K === "connected" || ga4K === "partial" ? (
              <>
                <Button size="sm" variant="outline" onClick={openGa4Connect}>
                  <PlugZap className="w-3.5 h-3.5 mr-2" />
                  {t("admin.analyticsSettings.ga4.reconnect")}
                </Button>
                <Button size="sm" variant="destructive" onClick={disconnectGa4}>
                  <Unplug className="w-3.5 h-3.5 mr-2" />
                  {t("admin.analyticsSettings.ga4.disconnect")}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={openGa4Connect}>
                <Plug className="w-3.5 h-3.5 mr-2" />
                {t("admin.analyticsSettings.ga4.connect")}
              </Button>
            )}
          </div>
        }
      >
        <Field
          label={t("admin.analyticsSettings.ga4.propertyId")}
          hint={t("admin.analyticsSettings.ga4.propertyIdHint")}
        >
          <Text
            value={draft.ga4_property_id}
            onChange={(e) => set("ga4_property_id", e.target.value)}
            placeholder="123456789"
          />
        </Field>
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

      <Ga4ConnectDialog
        open={ga4Dialog}
        onOpenChange={setGa4Dialog}
        initialPropertyId={draft.ga4_property_id}
        initialMeasurementId={draft.ga4_measurement_id}
        missingSecrets={st?.ga4.missingSecrets ?? []}
        saving={ga4Saving}
        onSubmit={submitGa4Connect}
      />

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

      <SaveBar saving={save.isPending} onSave={() => void persist(draft)} />
    </div>
  );
}
