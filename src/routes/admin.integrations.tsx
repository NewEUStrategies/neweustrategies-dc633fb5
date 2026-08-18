// Panel „Integracje wychodzące" - zarządzanie tabelą integration_endpoints
// (webhook fan-out z outbox eventów domenowych; migracja 20260714090000 z PR #19).
//
// Klucz podpisujący HMAC-SHA256 nie ma kolumny w bazie - siedzi w
// Supabase Vault (secret_id -> vault.secrets), zapis wyłącznie przez RPC
// integration_endpoint_set_secret (admin swojego tenanta lub service role);
// odczyt tylko service_role (dispatcher). UI pokazuje jedynie „ustawiony/nie"
// i pozwala go nadpisać lub wyczyścić - nigdy nie zwraca plaintextu.
//
// Reszta CRUD idzie klientem pod RLS: policy „integration_endpoints_staff_all"
// wymusza tenant + rolę staff, a triggery bazy pinują tenant_id/created_by.
import { useMemo, useState } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ensureI18n as ensureAdminIntegrationsI18n } from "@/lib/i18n-admin-integrations";
import { toast } from "sonner";
import {
  Cable,
  KeyRound,
  Loader2,
  PlayCircle,
  Plus,
  Trash2,
  Webhook as WebhookIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { dispatchIntegrationDeliveries } from "@/lib/integrations/dispatch.functions";
import {
  INTEGRATION_KINDS,
  normalizeIntegrationKind,
  type IntegrationKind,
} from "@/lib/integrations/formats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/admin/integrations")({
  head: () => ({
    meta: [
      { title: "Integracje wychodzące - Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminIntegrationsPage,
});
/**
 * Kolumny czytane przez ten kod - WYPROWADZONE z wygenerowanych typów.
 * Ręcznie przepisany kształt wiersza rozjeżdża się z bazą bez żadnego sygnału,
 * bo `as unknown as` kasuje różnicę; `Pick` po `Tables<>` zamienia zmianę
 * kolumny w migracji na błąd kompilacji dokładnie tutaj.
 */
type EndpointRow = Pick<
  Tables<"integration_endpoints">,
  | "id"
  | "name"
  | "integration"
  | "url"
  | "event_types"
  | "enabled"
  | "secret_id"
  | "created_at"
  | "updated_at"
>;

interface DraftEndpoint {
  id: string | null;
  name: string;
  integration: string;
  url: string;
  event_types_csv: string;
  enabled: boolean;
  new_secret: string;
  clear_secret: boolean;
}

const EMPTY_DRAFT: DraftEndpoint = {
  id: null,
  name: "",
  integration: "webhook",
  url: "",
  event_types_csv: "",
  enabled: true,
  new_secret: "",
  clear_secret: false,
};

function nullifyEmpty(v: string): string | null {
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function parseEventTypes(csv: string): string[] {
  return csv
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function kindLabel(kind: IntegrationKind, t: TFunction): string {
  switch (kind) {
    case "webhook":
      return t("adminIntegrations.webhookGenericJsonHmac");
    case "slack":
      return "Slack (Block Kit)";
    case "hubspot":
      return "HubSpot (CRM v3, kontakty)";
    case "gcal":
      return t("adminIntegrations.googleCalendarGenericJson");
    case "confluence":
      return t("adminIntegrations.confluenceGenericJson");
    case "crm_partner":
      return t("adminIntegrations.crmPartnerLeadsConsents");
  }
}

function kindHint(raw: string, t: TFunction): string {
  switch (normalizeIntegrationKind(raw)) {
    case "slack":
      return t("adminIntegrations.pasteSlackIncomingWebhookUrl");
    case "hubspot":
      return t("adminIntegrations.urlApiBaseUsuallyHttps");
    case "crm_partner":
      return t("adminIntegrations.crmPartnerEndpointLeadEvents");
    default:
      return t("adminIntegrations.receiverGetsFullEventEnvelope");
  }
}

function kindUrlPlaceholder(raw: string): string {
  switch (normalizeIntegrationKind(raw)) {
    case "slack":
      return "https://hooks.slack.com/services/T000/B000/XXXX";
    case "hubspot":
      return "https://api.hubapi.com";
    default:
      return "https://example.com/webhooks/nes";
  }
}

function AdminIntegrationsPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-integrations.ts.
  ensureAdminIntegrationsI18n();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const dispatchNow = useServerFn(dispatchIntegrationDeliveries);

  const [draft, setDraft] = useState<DraftEndpoint | null>(null);

  const endpointsQ = useQuery({
    queryKey: ["admin", "integration-endpoints"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("integration_endpoints")
        .select("id,name,integration,url,event_types,enabled,secret_id,created_at,updated_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as EndpointRow[];
    },
  });

  const deliveriesQ = useQuery({
    queryKey: ["admin", "integration-deliveries-summary"],
    queryFn: async () => {
      // Wystarczy prosty licznik statusów (RLS scope po tenantcie).
      const { data, error } = await supabase
        .from("integration_deliveries")
        .select("status")
        .limit(1000);
      if (error) throw error;
      const rows = (data ?? []) as { status: string }[];
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return counts;
    },
  });

  const upsert = useMutation({
    mutationFn: async (d: DraftEndpoint) => {
      const events = parseEventTypes(d.event_types_csv);
      const payload = {
        name: d.name.trim(),
        integration: normalizeIntegrationKind(d.integration),
        url: d.url.trim(),
        event_types: events,
        enabled: d.enabled,
      };
      let endpointId = d.id;
      if (d.id) {
        const { error } = await supabase
          .from("integration_endpoints")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", d.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("integration_endpoints")
          // tenant_id/created_by pinuje trigger bazy; podajemy tylko payload.
          .insert(payload as never)
          .select("id")
          .single();
        if (error) throw error;
        endpointId = (data as { id: string }).id;
      }
      // Sekret idzie osobno przez RPC (Vault) i tylko gdy admin go zmienia.
      if (endpointId && (d.clear_secret || d.new_secret.trim().length > 0)) {
        const plain = d.clear_secret ? "" : d.new_secret.trim();
        const { error: rpcErr } = await supabase.rpc("integration_endpoint_set_secret", {
          _endpoint_id: endpointId,
          _plaintext: plain,
        });
        if (rpcErr) throw rpcErr;
      }
      return endpointId as string;
    },
    onSuccess: () => {
      toast.success(t("adminIntegrations.saved"));
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["admin", "integration-endpoints"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("adminIntegrations.error", { message: msg }));
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integration_endpoints").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("adminIntegrations.endpointRemoved"));
      void qc.invalidateQueries({ queryKey: ["admin", "integration-endpoints"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("adminIntegrations.error", { message: msg }));
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("integration_endpoints")
        .update({ enabled, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "integration-endpoints"] });
    },
  });

  const runDispatch = useMutation({
    mutationFn: async () => dispatchNow({ data: { limit: 50 } }),
    onSuccess: (summary) => {
      toast.success(
        t("adminIntegrations.dispatchSummary", {
          delivered: summary.delivered,
          failed: summary.failed,
          claimed: summary.claimed,
        }),
      );
      void qc.invalidateQueries({ queryKey: ["admin", "integration-deliveries-summary"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("adminIntegrations.dispatcherError", { message: msg }));
    },
  });

  const rows = endpointsQ.data ?? [];
  const counts = deliveriesQ.data ?? {};
  // Statusy z CHECK-a integration_deliveries: queued/delivering/delivered/failed/dead.
  const pending = (counts["queued"] ?? 0) + (counts["delivering"] ?? 0);
  const dead = counts["dead"] ?? 0;
  const delivered = counts["delivered"] ?? 0;
  const failed = counts["failed"] ?? 0;

  const openNew = () => setDraft({ ...EMPTY_DRAFT });
  const openEdit = (r: EndpointRow) =>
    setDraft({
      id: r.id,
      name: r.name,
      integration: r.integration,
      url: r.url,
      event_types_csv: r.event_types.join(", "),
      enabled: r.enabled,
      new_secret: "",
      clear_secret: false,
    });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Cable className="h-6 w-6" aria-hidden />
            {t("adminIntegrations.outgoingIntegrations")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("adminIntegrations.webhookEndpointsReceivingDomainEvents")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => runDispatch.mutate()}
            disabled={runDispatch.isPending}
          >
            {runDispatch.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <PlayCircle className="mr-2 h-4 w-4" aria-hidden />
            )}
            {t("adminIntegrations.runDispatcher")}
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {t("adminIntegrations.newEndpoint")}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={t("adminIntegrations.delivered")} value={delivered} tone="ok" />
        <StatCard label={t("adminIntegrations.pending")} value={pending} tone="wait" />
        <StatCard label={t("adminIntegrations.failed")} value={failed} tone="warn" />
        <StatCard label={t("adminIntegrations.dead")} value={dead} tone="err" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("adminIntegrations.endpoints")}</CardTitle>
          <CardDescription>{t("adminIntegrations.disabledEndpointSkipped")}</CardDescription>
        </CardHeader>
        <CardContent>
          {endpointsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t("adminIntegrations.loading")}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("adminIntegrations.endpointsYetAddOneStart")}
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <WebhookIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{r.name}</span>
                      <Badge variant="outline">{r.integration}</Badge>
                      {r.secret_id ? (
                        <Badge variant="secondary" className="gap-1">
                          <KeyRound className="h-3 w-3" aria-hidden />
                          {t("adminIntegrations.secretSet")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <KeyRound className="h-3 w-3" aria-hidden />
                          {t("adminIntegrations.secret")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">{r.url}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.event_types.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground">
                          {t("adminIntegrations.allEvents")}
                        </span>
                      ) : (
                        r.event_types.map((e) => (
                          <Badge key={e} variant="outline" className="text-xs">
                            {e}
                          </Badge>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => toggleEnabled.mutate({ id: r.id, enabled: v })}
                        aria-label={t("adminIntegrations.enabled")}
                      />
                      <span className="text-muted-foreground">
                        {r.enabled
                          ? t("adminIntegrations.enabled")
                          : t("adminIntegrations.disabled")}
                      </span>
                    </label>
                    <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                      {t("adminIntegrations.edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            t("adminIntegrations.confirmDeleteEndpoint", { name: r.name }),
                          )
                        ) {
                          remove.mutate(r.id);
                        }
                      }}
                      aria-label={t("adminIntegrations.delete")}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <EndpointDialog
        draft={draft}
        setDraft={setDraft}
        onSave={(d) => upsert.mutate(d)}
        saving={upsert.isPending}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "wait" | "warn" | "err";
}) {
  const toneClass = useMemo(() => {
    switch (tone) {
      case "ok":
        return "text-emerald-600 dark:text-emerald-400";
      case "wait":
        return "text-sky-600 dark:text-sky-400";
      case "warn":
        return "text-amber-600 dark:text-amber-400";
      case "err":
        return "text-destructive";
    }
  }, [tone]);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={`text-2xl ${toneClass}`}>{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}

function EndpointDialog({
  draft,
  setDraft,
  onSave,
  saving,
}: {
  draft: DraftEndpoint | null;
  setDraft: (d: DraftEndpoint | null) => void;
  onSave: (d: DraftEndpoint) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  if (!draft) return null;
  const set = (patch: Partial<DraftEndpoint>) => setDraft({ ...draft, ...patch });
  const canSave = draft.name.trim().length >= 2 && /^https:\/\//i.test(draft.url.trim()) && !saving;

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => (o ? undefined : setDraft(null))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? t("adminIntegrations.editEndpoint") : t("adminIntegrations.newEndpoint")}
          </DialogTitle>
          <DialogDescription>{t("adminIntegrations.urlMustUseHttpsSsrf")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="int-name">{t("adminIntegrations.name")}</Label>
            <Input
              id="int-name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={t("adminIntegrations.eGZapierNewCampaigns")}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="int-type">{t("adminIntegrations.formatAdapter")}</Label>
              <Select
                value={normalizeIntegrationKind(draft.integration)}
                onValueChange={(v) => set({ integration: v as IntegrationKind })}
              >
                <SelectTrigger id="int-type">
                  <SelectValue placeholder="webhook" />
                </SelectTrigger>
                <SelectContent>
                  {INTEGRATION_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {kindLabel(k, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => set({ enabled: v })}
                id="int-enabled"
              />
              <Label htmlFor="int-enabled" className="text-sm text-muted-foreground">
                {t("adminIntegrations.enabled")}
              </Label>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{kindHint(draft.integration, t)}</p>

          <div className="grid gap-2">
            <Label htmlFor="int-url">URL</Label>
            <Input
              id="int-url"
              type="url"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder={kindUrlPlaceholder(draft.integration)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="int-events">{t("adminIntegrations.eventsCommaSpaceSeparated")}</Label>
            <Textarea
              id="int-events"
              rows={3}
              value={draft.event_types_csv}
              onChange={(e) => set({ event_types_csv: e.target.value })}
              placeholder="post.published.v1, crm_lead.created.v1, crm_task.due.v1, newsletter_subscriber.confirmed.v1"
            />
            <p className="text-xs text-muted-foreground">
              {t("adminIntegrations.emptyEveryEventTenant")}
            </p>
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" aria-hidden />
              {normalizeIntegrationKind(draft.integration) === "hubspot"
                ? t("adminIntegrations.accessTokenBearer")
                : t("adminIntegrations.hmacSigningSecret")}
            </div>
            <p className="text-xs text-muted-foreground">
              {normalizeIntegrationKind(draft.integration) === "hubspot"
                ? t("adminIntegrations.hubspotPrivateAppTokenLives")
                : t("adminIntegrations.secretLivesInVault")}
            </p>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.new_secret}
              onChange={(e) => set({ new_secret: e.target.value, clear_secret: false })}
              placeholder={
                normalizeIntegrationKind(draft.integration) === "hubspot"
                  ? "pat-eu1-…"
                  : t("adminIntegrations.newSecret16Chars")
              }
              disabled={draft.clear_secret}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.clear_secret}
                onChange={(e) => set({ clear_secret: e.target.checked, new_secret: "" })}
              />
              {t("adminIntegrations.clearSecretWebhookSendsUnsigned")}
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            {t("adminIntegrations.cancel")}
          </Button>
          <Button
            onClick={() =>
              onSave({ ...draft, name: nullifyEmpty(draft.name) ?? "", url: draft.url.trim() })
            }
            disabled={!canSave}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {t("adminIntegrations.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
