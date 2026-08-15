// Panel partnerów CRM (integracje wychodzące leadów) - następca sztywnej
// konfiguracji Merydian (kolumny merydian_* w crm_integrations).
//
// Każdy partner = wiersz integration_endpoints (integration='crm_partner';
// transport: URL + sekret w Vault + enabled) + profil crm_webhook_endpoints
// (auth_kind hmac/bearer, forward_stages, consent_mapping, workspace_id).
// Dowolna liczba odbiorców per tenant bez migracji; dostawy płyną outboxem
// integration_deliveries (retry + backoff + dead), a sekrety nigdy nie wracają
// do przeglądarki (zapis przez RPC integration_endpoint_set_secret).
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { dispatchIntegrationDeliveries } from "@/lib/integrations/dispatch.functions";
import { CRM_PARTNER_EVENT_TYPES, parseCrmConsentMapping } from "@/lib/integrations/formats";
import type { Json } from "@/integrations/supabase/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toJson } from "@/lib/builder/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
} from "lucide-react";

type Stage = "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "archived";
const STAGES: Stage[] = ["new", "contacted", "qualified", "proposal", "won", "lost", "archived"];

interface ConsentMapItem {
  source_key: string;
  source_label: string;
  partner_field: string;
  partner_category: string;
  required: boolean;
}

interface PartnerProfileRow {
  auth_kind: string;
  forward_stages: Stage[];
  consent_mapping: Json;
  workspace_id: string | null;
}

interface PartnerRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  secret_id: string | null;
  created_at: string;
  updated_at: string;
  crm_webhook_endpoints: PartnerProfileRow | null;
}

interface DeliveryStat {
  delivered: number;
  failed: number;
  dead: number;
  queued: number;
  lastAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

interface Draft {
  id: string | null;
  name: string;
  url: string;
  enabled: boolean;
  auth_kind: "hmac" | "bearer";
  workspace_id: string;
  forward_stages: Stage[];
  consent_mapping: ConsentMapItem[];
  new_secret: string;
  clear_secret: boolean;
  has_secret: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  url: "",
  enabled: true,
  auth_kind: "hmac",
  workspace_id: "",
  forward_stages: ["new"],
  consent_mapping: [],
  new_secret: "",
  clear_secret: false,
  has_secret: false,
};

interface Props {
  lang: "pl" | "en";
  stageLabels: Record<Stage, string>;
}

export function CrmPartnerEndpointsPanel({ lang, stageLabels }: Props) {
  const t = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const endpointsQ = useQuery({
    queryKey: ["admin", "crm-partner-endpoints"],
    queryFn: async (): Promise<PartnerRow[]> => {
      const { data, error } = await supabase
        .from("integration_endpoints")
        .select(
          "id, name, url, enabled, secret_id, created_at, updated_at, crm_webhook_endpoints(auth_kind, forward_stages, consent_mapping, workspace_id)",
        )
        .eq("integration", "crm_partner")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as PartnerRow[];
    },
  });

  const rows = useMemo(() => endpointsQ.data ?? [], [endpointsQ.data]);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // Zdrowie dostaw per endpoint z ostatnich wpisów outboxu (RLS: staff tenant).
  const statsQ = useQuery({
    queryKey: ["admin", "crm-partner-deliveries", rowIds],
    enabled: rowIds.length > 0,
    staleTime: 15_000,
    queryFn: async (): Promise<Map<string, DeliveryStat>> => {
      const { data, error } = await supabase
        .from("integration_deliveries")
        .select("endpoint_id, status, created_at, last_error")
        .in("endpoint_id", rowIds)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) throw new Error(error.message);
      const map = new Map<string, DeliveryStat>();
      for (const d of data ?? []) {
        const s =
          map.get(d.endpoint_id) ??
          ({
            delivered: 0,
            failed: 0,
            dead: 0,
            queued: 0,
            lastAt: null,
            lastStatus: null,
            lastError: null,
          } satisfies DeliveryStat);
        if (d.status === "delivered") s.delivered += 1;
        else if (d.status === "dead") s.dead += 1;
        else if (d.status === "failed") s.failed += 1;
        else s.queued += 1;
        if (!s.lastAt) {
          s.lastAt = d.created_at;
          s.lastStatus = d.status;
          s.lastError = d.last_error;
        }
        map.set(d.endpoint_id, s);
      }
      return map;
    },
  });

  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ["admin", "crm-partner-endpoints"] });
    await qc.invalidateQueries({ queryKey: ["admin", "crm-partner-deliveries"] });
  };

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const url = d.url.trim();
      const endpointPayload = {
        name: d.name.trim(),
        integration: "crm_partner",
        url,
        event_types: [...CRM_PARTNER_EVENT_TYPES],
        enabled: d.enabled,
      };
      let endpointId = d.id;
      if (endpointId) {
        const { error } = await supabase
          .from("integration_endpoints")
          .update(endpointPayload)
          .eq("id", endpointId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from("integration_endpoints")
          .insert(endpointPayload)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        endpointId = (data as { id: string }).id;
      }
      const mapping = d.consent_mapping
        .filter((m) => m.source_key.trim().length > 0)
        .map((m) => ({
          source_key: m.source_key.trim(),
          source_label: m.source_label,
          partner_field: m.partner_field,
          partner_category: m.partner_category,
          required: m.required,
        }));
      const { error: profileError } = await supabase.from("crm_webhook_endpoints").upsert(
        {
          endpoint_id: endpointId,
          auth_kind: d.auth_kind,
          forward_stages: d.forward_stages.length > 0 ? d.forward_stages : ["new"],
          consent_mapping: toJson(mapping),
          workspace_id: d.workspace_id.trim() || null,
        },
        { onConflict: "endpoint_id" },
      );
      if (profileError) throw new Error(profileError.message);
      if (d.clear_secret || d.new_secret.trim().length > 0) {
        const plain = d.clear_secret ? "" : d.new_secret.trim();
        const { error } = await supabase.rpc("integration_endpoint_set_secret", {
          _endpoint_id: endpointId,
          _plaintext: plain,
        });
        if (error) throw new Error(error.message);
      }
      return endpointId;
    },
    onSuccess: async () => {
      toast.success(t("Partner zapisany", "Partner saved"));
      setDraft(null);
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("integration_endpoints").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      toast.success(t("Partner usunięty", "Partner removed"));
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await supabase
        .from("integration_endpoints")
        .update({ enabled: next })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const drain = useMutation({
    mutationFn: async () => dispatchIntegrationDeliveries({ data: { limit: 50 } }),
    onSuccess: async (r) => {
      toast.success(
        t(
          `Kolejka: ${r.delivered} dostarczono, ${r.failed} nieudanych`,
          `Queue: ${r.delivered} delivered, ${r.failed} failed`,
        ),
      );
      await invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const edit = (r: PartnerRow) => {
    const profile = r.crm_webhook_endpoints;
    setDraft({
      id: r.id,
      name: r.name,
      url: r.url,
      enabled: r.enabled,
      auth_kind: profile?.auth_kind === "bearer" ? "bearer" : "hmac",
      workspace_id: profile?.workspace_id ?? "",
      forward_stages: profile?.forward_stages ?? ["new"],
      consent_mapping: parseCrmConsentMapping(profile?.consent_mapping),
      new_secret: "",
      clear_secret: false,
      has_secret: r.secret_id != null,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-2 rounded-md border bg-card p-3">
        <Webhook className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t("Partnerzy CRM", "CRM partners")}</h3>
          <p className="text-[11px] text-muted-foreground">
            {t(
              "Leady są wysyłane do każdego aktywnego partnera przez kolejkę z automatycznym retry. Webhook (HMAC w nagłówkach X-Signature / x-nes-signature) lub API (Bearer). Sekrety trafiają do Vault i nigdy nie wracają do przeglądarki.",
              "Leads are delivered to every active partner through a queue with automatic retries. Webhook (HMAC in X-Signature / x-nes-signature headers) or API (Bearer). Secrets are stored in Vault and never returned to the browser.",
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => drain.mutate()}
            disabled={drain.isPending}
          >
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t("Przetwórz kolejkę", "Process queue")}
          </Button>
          <Button size="sm" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
            {t("Nowy partner", "New partner")}
          </Button>
        </div>
      </div>

      {endpointsQ.isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-[12px] text-muted-foreground">
          {t(
            "Brak partnerów. Dodaj pierwszego, aby leady z wybranych etapów były wysyłane automatycznie.",
            "No partners yet. Add one so leads from selected stages are forwarded automatically.",
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const profile = r.crm_webhook_endpoints;
            const stat = statsQ.data?.get(r.id);
            return (
              <li key={r.id} className="rounded-md border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) => toggleEnabled.mutate({ id: r.id, next: v === true })}
                    aria-label={t("Włącz partnera", "Enable partner")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-medium">{r.name}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {profile?.auth_kind === "bearer" ? "Bearer" : "HMAC"}
                      </Badge>
                      {r.secret_id ? (
                        <Badge variant="outline" className="gap-1 text-[10px]">
                          <KeyRound className="h-2.5 w-2.5" aria-hidden />
                          {t("sekret ustawiony", "secret set")}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-amber-600">
                          {t("bez sekretu", "no secret")}
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{r.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => edit(r)}
                      aria-label={t("Edytuj", "Edit")}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive hover:bg-destructive/10"
                          aria-label={t("Usuń", "Delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            {t(`Usunąć partnera „${r.name}"?`, `Delete partner "${r.name}"?`)}
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            {t(
                              "Nowe dostawy dla tego partnera przestaną być tworzone. Historia dostaw zostanie usunięta.",
                              "New deliveries for this partner will stop. Its delivery history is removed.",
                            )}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{t("Anuluj", "Cancel")}</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => remove.mutate(r.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {t("Usuń", "Delete")}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className="font-medium">{t("Etapy:", "Stages:")}</span>
                  {(profile?.forward_stages ?? []).map((s) => (
                    <Badge key={s} variant="outline" className="text-[10px]">
                      {stageLabels[s] ?? s}
                    </Badge>
                  ))}
                  {profile?.workspace_id && (
                    <span className="ml-2">
                      {t("Workspace:", "Workspace:")} {profile.workspace_id}
                    </span>
                  )}
                  {stat && (
                    <span className="ml-auto tabular-nums">
                      ✓ {stat.delivered} · ✗ {stat.failed + stat.dead}
                      {stat.queued > 0 && <> · ⏳ {stat.queued}</>}
                      {stat.lastAt && (
                        <>
                          {" "}
                          · {t("ostatnia:", "last:")} {new Date(stat.lastAt).toLocaleString()} (
                          {stat.lastStatus})
                        </>
                      )}
                    </span>
                  )}
                </div>
                {stat?.lastError && stat.lastStatus !== "delivered" && (
                  <p className="mt-1 truncate text-[11px] text-destructive">{stat.lastError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft && (
        <div className="space-y-4 rounded-md border bg-card p-4">
          <h4 className="text-sm font-medium">
            {draft.id ? t("Edytuj partnera", "Edit partner") : t("Nowy partner", "New partner")}
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("Nazwa", "Name")}>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={t("np. Merydian", "e.g. Merydian")}
                className="h-8 text-[13px]"
              />
            </Field>
            <Field label={t("Tryb uwierzytelnienia", "Authentication")}>
              <Select
                value={draft.auth_kind}
                onValueChange={(v) => setDraft({ ...draft, auth_kind: v as "hmac" | "bearer" })}
              >
                <SelectTrigger className="h-8 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hmac">
                    {t("Webhook - podpis HMAC SHA-256", "Webhook - HMAC SHA-256 signature")}
                  </SelectItem>
                  <SelectItem value="bearer">{t("API - Bearer", "API - Bearer")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="URL">
              <Input
                value={draft.url}
                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                placeholder="https://partner.example.com/api/leads"
                className="h-8 text-[13px]"
              />
            </Field>
            <Field
              label={
                draft.auth_kind === "bearer"
                  ? t("Klucz API (Bearer)", "API key (Bearer)")
                  : t("Sekret HMAC", "HMAC secret")
              }
            >
              <Input
                type="password"
                value={draft.new_secret}
                onChange={(e) =>
                  setDraft({ ...draft, new_secret: e.target.value, clear_secret: false })
                }
                placeholder={draft.has_secret ? t("•••• (ustawiony)", "•••• (set)") : undefined}
                autoComplete="new-password"
                className="h-8 text-[13px]"
              />
              {draft.has_secret && (
                <label className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Switch
                    checked={draft.clear_secret}
                    onCheckedChange={(v) =>
                      setDraft({ ...draft, clear_secret: v === true, new_secret: "" })
                    }
                  />
                  {t("Wyczyść zapisany sekret", "Clear stored secret")}
                </label>
              )}
            </Field>
            <Field label={t("ID przestrzeni roboczej (opcjonalnie)", "Workspace ID (optional)")}>
              <Input
                value={draft.workspace_id}
                onChange={(e) => setDraft({ ...draft, workspace_id: e.target.value })}
                className="h-8 text-[13px]"
              />
            </Field>
            <Field label={t("Aktywny", "Enabled")}>
              <div className="flex h-8 items-center">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(v) => setDraft({ ...draft, enabled: v === true })}
                />
              </div>
            </Field>
          </div>

          <Field label={t("Etapy do automatycznej wysyłki", "Auto-forward stages")}>
            <div className="flex flex-wrap gap-1.5">
              {STAGES.map((st) => {
                const active = draft.forward_stages.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        forward_stages: active
                          ? draft.forward_stages.filter((x) => x !== st)
                          : [...draft.forward_stages, st],
                      })
                    }
                    className={`rounded-md border px-2 py-1 text-[11px] ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {stageLabels[st]}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="space-y-2 rounded-md border bg-background/60 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0 flex-1">
                <h5 className="text-[13px] font-medium">
                  {t("Mapowanie zgód → partner", "Consent mapping → partner")}
                </h5>
                <p className="text-[11px] text-muted-foreground">
                  {t(
                    "Każdy wysłany lead zawiera tablicę `consents` z polami granted/required/field/category.",
                    "Every forwarded lead includes a `consents` array with granted/required/field/category.",
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() =>
                  setDraft({
                    ...draft,
                    consent_mapping: [
                      ...draft.consent_mapping,
                      {
                        source_key: "",
                        source_label: "",
                        partner_field: "",
                        partner_category: "",
                        required: false,
                      },
                    ],
                  })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                {t("Dodaj mapowanie", "Add mapping")}
              </Button>
            </div>
            {draft.consent_mapping.length === 0 ? (
              <p className="text-[11px] italic text-muted-foreground">
                {t(
                  "Brak mapowań. Dodaj pierwsze, aby zgody trafiały do konkretnych pól partnera.",
                  "No mappings yet. Add one so consents land in specific partner fields.",
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {draft.consent_mapping.map((m, idx) => {
                  const patch = (p: Partial<ConsentMapItem>) =>
                    setDraft({
                      ...draft,
                      consent_mapping: draft.consent_mapping.map((x, i) =>
                        i === idx ? { ...x, ...p } : x,
                      ),
                    });
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-1 items-center gap-1.5 rounded-md border bg-background p-2 sm:grid-cols-12"
                    >
                      <Input
                        className="h-8 text-[12px] sm:col-span-3"
                        placeholder={t(
                          "Klucz zgody (np. newsletter_opt_in)",
                          "Consent key (e.g. newsletter_opt_in)",
                        )}
                        value={m.source_key}
                        onChange={(e) => patch({ source_key: e.target.value })}
                      />
                      <Input
                        className="h-8 text-[12px] sm:col-span-3"
                        placeholder={t("Etykieta (PL/EN)", "Label (PL/EN)")}
                        value={m.source_label}
                        onChange={(e) => patch({ source_label: e.target.value })}
                      />
                      <Input
                        className="h-8 text-[12px] sm:col-span-2"
                        placeholder={t("Pole partnera", "Partner field")}
                        value={m.partner_field}
                        onChange={(e) => patch({ partner_field: e.target.value })}
                      />
                      <Input
                        className="h-8 text-[12px] sm:col-span-2"
                        placeholder={t("Kategoria", "Category")}
                        value={m.partner_category}
                        onChange={(e) => patch({ partner_category: e.target.value })}
                      />
                      <label className="flex items-center gap-1 text-[11px] sm:col-span-1">
                        <Switch
                          checked={m.required}
                          onCheckedChange={(v) => patch({ required: v === true })}
                        />
                        <span className="truncate">{t("Wymagana", "Required")}</span>
                      </label>
                      <Button
                        size="sm"
                        variant="ghost"
                        type="button"
                        className="h-8 px-2 sm:col-span-1"
                        aria-label={t("Usuń", "Remove")}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            consent_mapping: draft.consent_mapping.filter((_, i) => i !== idx),
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              {t("Anuluj", "Cancel")}
            </Button>
            <Button
              size="sm"
              disabled={
                save.isPending || !draft.name.trim() || !/^https:\/\//i.test(draft.url.trim())
              }
              onClick={() => save.mutate(draft)}
            >
              <Send className="mr-1 h-3.5 w-3.5" aria-hidden />
              {t("Zapisz partnera", "Save partner")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
