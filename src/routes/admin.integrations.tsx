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
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

export const Route = createFileRoute("/admin/integrations")({
  head: () => ({
    meta: [
      { title: "Integracje wychodzące — Admin" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminIntegrationsPage,
});

interface EndpointRow {
  id: string;
  name: string;
  integration: string;
  url: string;
  event_types: string[];
  enabled: boolean;
  secret_id: string | null;
  created_at: string;
  updated_at: string;
}

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

function AdminIntegrationsPage() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
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
      return (data ?? []) as unknown as EndpointRow[];
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
        integration: d.integration.trim() || "webhook",
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
        const { error: rpcErr } = await supabase.rpc(
          "integration_endpoint_set_secret" as never,
          { _endpoint_id: endpointId, _plaintext: plain } as never,
        );
        if (rpcErr) throw rpcErr;
      }
      return endpointId as string;
    },
    onSuccess: () => {
      toast.success(L("Zapisano", "Saved"));
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ["admin", "integration-endpoints"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(L(`Błąd: ${msg}`, `Error: ${msg}`));
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integration_endpoints").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L("Usunięto endpoint", "Endpoint removed"));
      void qc.invalidateQueries({ queryKey: ["admin", "integration-endpoints"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(L(`Błąd: ${msg}`, `Error: ${msg}`));
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
        L(
          `Wysłano: ${summary.delivered}, błędy: ${summary.failed}, przejęto: ${summary.claimed}`,
          `Delivered: ${summary.delivered}, failed: ${summary.failed}, claimed: ${summary.claimed}`,
        ),
      );
      void qc.invalidateQueries({ queryKey: ["admin", "integration-deliveries-summary"] });
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(L(`Błąd dispatchera: ${msg}`, `Dispatcher error: ${msg}`));
    },
  });

  const rows = endpointsQ.data ?? [];
  const counts = deliveriesQ.data ?? {};
  const pending = (counts["pending"] ?? 0) + (counts["retry"] ?? 0);
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
            {L("Integracje wychodzące", "Outgoing integrations")}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {L(
              "Endpointy webhook, do których platforma wysyła zdarzenia domenowe (publikacja wpisu, kampania newsletter, formularz kontaktowy itp.). Podpis HMAC-SHA256 w nagłówku x-nes-signature, sekret w Supabase Vault - nigdy nie jest zwracany do przeglądarki.",
              "Webhook endpoints receiving domain events (post published, newsletter campaign, contact form, etc.). Payload signed with HMAC-SHA256 in header x-nes-signature; secret lives in Supabase Vault and is never returned to the browser.",
            )}
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
            {L("Uruchom dispatcher", "Run dispatcher")}
          </Button>
          <Button onClick={openNew}>
            <Plus className="mr-2 h-4 w-4" aria-hidden />
            {L("Nowy endpoint", "New endpoint")}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={L("Dostarczone", "Delivered")} value={delivered} tone="ok" />
        <StatCard label={L("W kolejce", "Pending")} value={pending} tone="wait" />
        <StatCard label={L("Nieudane", "Failed")} value={failed} tone="warn" />
        <StatCard label={L("Martwe", "Dead")} value={dead} tone="err" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{L("Endpointy", "Endpoints")}</CardTitle>
          <CardDescription>
            {L(
              "Wpis „wyłączony" jest pomijany przy dispatchu (delivery kończy się z powodem „endpoint disabled" - nie ma retry).",
              "A disabled endpoint is skipped by the dispatcher (delivery finishes with reason \"endpoint disabled\", no retry).",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {endpointsQ.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {L("Ładowanie…", "Loading…")}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {L(
                "Brak endpointów. Dodaj pierwszy, żeby zacząć wysyłać webhooki.",
                "No endpoints yet. Add one to start delivering webhooks.",
              )}
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-3 py-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <WebhookIcon
                        className="h-4 w-4 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="font-medium">{r.name}</span>
                      <Badge variant="outline">{r.integration}</Badge>
                      {r.secret_id ? (
                        <Badge variant="secondary" className="gap-1">
                          <KeyRound className="h-3 w-3" aria-hidden />
                          {L("Sekret ustawiony", "Secret set")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="gap-1">
                          <KeyRound className="h-3 w-3" aria-hidden />
                          {L("Brak sekretu", "No secret")}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {r.url}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.event_types.length === 0 ? (
                        <span className="text-xs italic text-muted-foreground">
                          {L("wszystkie zdarzenia", "all events")}
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
                        onCheckedChange={(v) =>
                          toggleEnabled.mutate({ id: r.id, enabled: v })
                        }
                        aria-label={L("Aktywny", "Enabled")}
                      />
                      <span className="text-muted-foreground">
                        {r.enabled ? L("Aktywny", "Enabled") : L("Wyłączony", "Disabled")}
                      </span>
                    </label>
                    <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
                      {L("Edytuj", "Edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (
                          window.confirm(
                            L(
                              `Usunąć endpoint „${r.name}"? Dostawy tego endpointu przestaną być tworzone.`,
                              `Delete endpoint "${r.name}"? New deliveries for this endpoint will stop.`,
                            ),
                          )
                        ) {
                          remove.mutate(r.id);
                        }
                      }}
                      aria-label={L("Usuń", "Delete")}
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
        L={L}
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
  L,
}: {
  draft: DraftEndpoint | null;
  setDraft: (d: DraftEndpoint | null) => void;
  onSave: (d: DraftEndpoint) => void;
  saving: boolean;
  L: (pl: string, en: string) => string;
}) {
  if (!draft) return null;
  const set = (patch: Partial<DraftEndpoint>) => setDraft({ ...draft, ...patch });
  const canSave =
    draft.name.trim().length >= 2 &&
    /^https:\/\//i.test(draft.url.trim()) &&
    !saving;

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => (o ? undefined : setDraft(null))}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft.id
              ? L("Edytuj endpoint", "Edit endpoint")
              : L("Nowy endpoint", "New endpoint")}
          </DialogTitle>
          <DialogDescription>
            {L(
              "Adres URL musi używać HTTPS. Guard SSRF odrzuca adresy prywatne (127.0.0.1, 10.x, metadata cloud itp.).",
              "URL must use HTTPS. The SSRF guard rejects private targets (127.0.0.1, 10.x, cloud metadata, etc.).",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="int-name">{L("Nazwa", "Name")}</Label>
            <Input
              id="int-name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder={L("np. Zapier - nowe kampanie", "e.g. Zapier — new campaigns")}
            />
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="int-type">{L("Typ", "Kind")}</Label>
              <Input
                id="int-type"
                value={draft.integration}
                onChange={(e) => set({ integration: e.target.value })}
                placeholder="webhook"
              />
            </div>
            <div className="flex items-center gap-3 pt-6">
              <Switch
                checked={draft.enabled}
                onCheckedChange={(v) => set({ enabled: v })}
                id="int-enabled"
              />
              <Label htmlFor="int-enabled" className="text-sm text-muted-foreground">
                {L("Aktywny", "Enabled")}
              </Label>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="int-url">URL</Label>
            <Input
              id="int-url"
              type="url"
              value={draft.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="https://example.com/webhooks/nes"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="int-events">
              {L("Zdarzenia (oddzielone przecinkiem lub spacją)", "Events (comma or space separated)")}
            </Label>
            <Textarea
              id="int-events"
              rows={3}
              value={draft.event_types_csv}
              onChange={(e) => set({ event_types_csv: e.target.value })}
              placeholder="post.published, newsletter.campaign.sent, contact.submitted"
            />
            <p className="text-xs text-muted-foreground">
              {L(
                "Puste = wszystkie zdarzenia tego tenanta.",
                "Empty = every event of this tenant.",
              )}
            </p>
          </div>

          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4" aria-hidden />
              {L("Sekret podpisu HMAC", "HMAC signing secret")}
            </div>
            <p className="text-xs text-muted-foreground">
              {L(
                "Sekret trzymamy w Vault - platforma go nigdy nie zwraca do przeglądarki. Wpisz nową wartość, żeby ustawić lub zrotować; zaznacz „wyczyść", żeby usunąć podpisywanie.",
                "Secret lives in Vault — the platform never returns it to the browser. Type a new value to set or rotate it; tick \"clear\" to remove signing.",
              )}
            </p>
            <Input
              type="password"
              autoComplete="new-password"
              value={draft.new_secret}
              onChange={(e) => set({ new_secret: e.target.value, clear_secret: false })}
              placeholder={L("Nowy sekret (min. 16 znaków)", "New secret (16+ chars)")}
              disabled={draft.clear_secret}
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.clear_secret}
                onChange={(e) => set({ clear_secret: e.target.checked, new_secret: "" })}
              />
              {L("Wyczyść sekret (endpoint będzie wysyłać bez podpisu)", "Clear secret (endpoint will send unsigned)")}
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            {L("Anuluj", "Cancel")}
          </Button>
          <Button
            onClick={() => onSave({ ...draft, name: nullifyEmpty(draft.name) ?? "", url: draft.url.trim() })}
            disabled={!canSave}
          >
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            ) : null}
            {L("Zapisz", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
