import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { AccessPlan } from "@/hooks/useContentAccess";
import { formatMoney } from "@/hooks/useContentAccess";
import {
  DEFAULT_METERING_SETTINGS,
  normalizeMeteringPolicy,
  useMeteringSettings,
  type MeteringPolicy,
  type MeteringSettings,
} from "@/lib/access/metering";
import { CHECKOUT_SETTINGS_QUERY_KEY, useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import type { CheckoutSettings } from "@/lib/billing/checkoutSettings";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";

import { confirmDialog } from "@/lib/appDialogs";
export const Route = createFileRoute("/admin/paywall")({ component: PaywallAdmin });

function emptyPlan(): Partial<AccessPlan> {
  return {
    name_pl: "",
    name_en: "",
    description_pl: "",
    description_en: "",
    price_cents: 1900,
    currency: "PLN",
    interval: "month",
    active: true,
    sort_order: 0,
    features_pl: [],
    features_en: [],
    badge_pl: "",
    badge_en: "",
    highlighted: false,
    trial_days: 0,
  };
}

function PaywallAdmin() {
  const { t } = useTranslation();
  const [plans, setPlans] = useState<AccessPlan[]>([]);
  const [draft, setDraft] = useState<Partial<AccessPlan>>(emptyPlan());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data } = await supabase.from("access_plans").select("*").order("sort_order");
    setPlans((data as AccessPlan[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    const { error } = draft.id
      ? await supabase.from("access_plans").update(draft).eq("id", draft.id)
      : await supabase.from("access_plans").insert(draft);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(t("admin.paywall.savedPlan"));
      setDraft(emptyPlan());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("admin.paywall.confirmRemove"),
        destructive: true,
        confirmLabel: t("admin.delete", { defaultValue: "Usuń" }),
      }))
    )
      return;
    const { error } = await supabase.from("access_plans").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(t("admin.paywall.removed"));
      load();
    }
  };

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">{t("admin.paywall.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("admin.paywall.subtitle")}</p>
        </header>

        <section className="border border-border rounded-lg bg-card">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-3">{t("admin.paywall.colName")}</th>
                <th className="text-left p-3">{t("admin.paywall.colPrice")}</th>
                <th className="text-left p-3">{t("admin.paywall.colInterval")}</th>
                <th className="text-left p-3">{t("admin.paywall.colActive")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-border hover:bg-muted/40">
                  <td className="p-3">
                    <div className="font-semibold">{p.name_pl || p.name_en}</div>
                    {p.name_en && p.name_pl && (
                      <div className="text-xs text-muted-foreground">{p.name_en}</div>
                    )}
                  </td>
                  <td className="p-3">{formatMoney(p.price_cents, p.currency)}</td>
                  <td className="p-3">{p.interval}</td>
                  <td className="p-3">{p.active ? "✓" : "-"}</td>
                  <td className="p-3 text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                      {t("admin.paywall.edit")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                      <Trash className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
              {plans.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                    {t("admin.paywall.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="border border-border rounded-lg bg-card p-5">
          <h2 className="font-semibold mb-4">
            {draft.id ? t("admin.paywall.editPlan") : t("admin.paywall.newPlan")}
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label>{t("admin.paywall.namePl")}</Label>
              <Input
                value={draft.name_pl ?? ""}
                onChange={(e) => setDraft({ ...draft, name_pl: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.paywall.nameEn")}</Label>
              <Input
                value={draft.name_en ?? ""}
                onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.descPl")}</Label>
              <Textarea
                rows={2}
                value={draft.description_pl ?? ""}
                onChange={(e) => setDraft({ ...draft, description_pl: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.descEn")}</Label>
              <Textarea
                rows={2}
                value={draft.description_en ?? ""}
                onChange={(e) => setDraft({ ...draft, description_en: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.paywall.priceCents")}</Label>
              <Input
                type="number"
                value={draft.price_cents ?? 0}
                onChange={(e) => setDraft({ ...draft, price_cents: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>{t("admin.paywall.currency")}</Label>
              <Input
                value={draft.currency ?? "PLN"}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("admin.paywall.interval")}</Label>
              <Select
                value={draft.interval ?? "month"}
                onValueChange={(v) => setDraft({ ...draft, interval: v as AccessPlan["interval"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">{t("admin.paywall.intervalMonth")}</SelectItem>
                  <SelectItem value="year">{t("admin.paywall.intervalYear")}</SelectItem>
                  <SelectItem value="one_time">{t("admin.paywall.intervalOnce")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!!draft.active}
                  onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                />{" "}
                {t("admin.paywall.active")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={!!draft.highlighted}
                  onCheckedChange={(v) => setDraft({ ...draft, highlighted: v })}
                />{" "}
                {t("admin.paywall.highlighted", "Wyróżniony")}
              </label>
              <div className="ml-auto">
                <Label>{t("admin.paywall.sort")}</Label>
                <Input
                  type="number"
                  value={draft.sort_order ?? 0}
                  onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
                  className="w-24"
                />
              </div>
            </div>
            <div>
              <Label>{t("admin.paywall.badgePl", "Plakietka (PL)")}</Label>
              <Input
                value={draft.badge_pl ?? ""}
                onChange={(e) => setDraft({ ...draft, badge_pl: e.target.value })}
                placeholder="Najpopularniejszy"
              />
            </div>
            <div>
              <Label>{t("admin.paywall.badgeEn", "Badge (EN)")}</Label>
              <Input
                value={draft.badge_en ?? ""}
                onChange={(e) => setDraft({ ...draft, badge_en: e.target.value })}
                placeholder="Most popular"
              />
            </div>
            <div>
              <Label>{t("admin.paywall.trialDays", "Dni okresu próbnego")}</Label>
              <Input
                type="number"
                min={0}
                value={draft.trial_days ?? 0}
                onChange={(e) => setDraft({ ...draft, trial_days: Number(e.target.value) })}
              />
            </div>
            <div></div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.featuresPl", "Funkcje (PL, jedna na linię)")}</Label>
              <Textarea
                rows={4}
                value={(draft.features_pl ?? []).join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    features_pl: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label>{t("admin.paywall.featuresEn", "Features (EN, one per line)")}</Label>
              <Textarea
                rows={4}
                value={(draft.features_en ?? []).join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    features_en: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            </div>
          </div>
          <div className="flex gap-2 mt-5">
            <Button onClick={save} disabled={busy}>
              <Plus className="w-4 h-4 mr-2" />
              {draft.id ? t("admin.save") : t("admin.paywall.addPlan")}
            </Button>
            {draft.id && (
              <Button variant="outline" onClick={() => setDraft(emptyPlan())}>
                {t("admin.cancel")}
              </Button>
            )}
          </div>
        </section>

        <MeteringSettingsCard />
        <MeteringOverridesCard />
        <CheckoutSettingsCard />
      </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// Metering - globalna konfiguracja darmowego limitu miesięcznego. Singleton
// per tenant (metering_settings); egzekwowanie serwerowe (consume_metered_view).
// ---------------------------------------------------------------------------
function MeteringSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: saved, isLoading } = useMeteringSettings();
  const [form, setForm] = useState<MeteringSettings>(DEFAULT_METERING_SETTINGS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved) setForm(saved);
  }, [saved]);

  const save = async () => {
    setBusy(true);
    const { data: auth } = await supabase.auth.getSession().then(r => ({ data: { user: r.data.session?.user ?? null } }));
    const { error } = await supabase.from("metering_settings").upsert(
      {
        enabled: form.enabled,
        member_monthly_limit: Math.max(0, Math.min(1000, Math.round(form.member_monthly_limit))),
        anon_monthly_limit: Math.max(0, Math.min(1000, Math.round(form.anon_monthly_limit))),
        meter_paid: form.meter_paid,
        meter_members: form.meter_members,
        show_counter: form.show_counter,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "tenant_id" },
    );
    setBusy(false);
    if (error) {
      toast.error(t("admin.paywall.meteringSaveError"));
      return;
    }
    toast.success(t("admin.paywall.meteringSaved"));
    void qc.invalidateQueries({ queryKey: ["metering-settings"] });
  };

  const numberField = (labelKey: string, value: number, onChange: (next: number) => void) => (
    <div>
      <Label>{t(labelKey)}</Label>
      <Input
        type="number"
        min={0}
        max={1000}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-40"
        disabled={!form.enabled}
      />
    </div>
  );

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{t("admin.paywall.meteringTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {t("admin.paywall.meteringSubtitle")}
      </p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            />
            {t("admin.paywall.meteringEnabled")}
          </label>
          <div className="grid sm:grid-cols-2 gap-4">
            {numberField("admin.paywall.meteringMemberLimit", form.member_monthly_limit, (v) =>
              setForm({ ...form, member_monthly_limit: v }),
            )}
            {numberField("admin.paywall.meteringAnonLimit", form.anon_monthly_limit, (v) =>
              setForm({ ...form, anon_monthly_limit: v }),
            )}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.meter_paid}
                disabled={!form.enabled}
                onCheckedChange={(v) => setForm({ ...form, meter_paid: v })}
              />
              {t("admin.paywall.meteringMeterPaid")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.meter_members}
                disabled={!form.enabled}
                onCheckedChange={(v) => setForm({ ...form, meter_members: v })}
              />
              {t("admin.paywall.meteringMeterMembers")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.show_counter}
                disabled={!form.enabled}
                onCheckedChange={(v) => setForm({ ...form, show_counter: v })}
              />
              {t("admin.paywall.meteringShowCounter")}
            </label>
          </div>
          <Button onClick={save} disabled={busy}>
            {t("admin.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Wyjątki meteringu per wpis/strona. To są TE SAME wiersze content_access,
// które edytują panele w edytorach - zmiana tutaj i tam jest w pełni
// zsynchronizowana (jedno źródło prawdy).
// ---------------------------------------------------------------------------
interface OverrideRow {
  id: string;
  entity_type: "post" | "page" | "media";
  entity_id: string;
  mode: string;
  metering_policy: string;
  title: string;
  slug: string | null;
}

async function fetchMeteringOverrides(): Promise<OverrideRow[]> {
  const { data, error } = await supabase
    .from("content_access")
    .select("id, entity_type, entity_id, mode, metering_policy")
    .neq("metering_policy", "inherit")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = data ?? [];

  const postIds = rows.filter((r) => r.entity_type === "post").map((r) => r.entity_id);
  const pageIds = rows.filter((r) => r.entity_type === "page").map((r) => r.entity_id);
  const [posts, pages] = await Promise.all([
    postIds.length
      ? supabase.from("posts").select("id, title_pl, title_en, slug").in("id", postIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            title_pl: string | null;
            title_en: string | null;
            slug: string | null;
          }>,
        }),
    pageIds.length
      ? supabase.from("pages").select("id, title_pl, title_en, slug").in("id", pageIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            title_pl: string | null;
            title_en: string | null;
            slug: string | null;
          }>,
        }),
  ]);
  const titleById = new Map<string, { title: string; slug: string | null }>();
  for (const p of posts.data ?? []) {
    titleById.set(p.id, { title: p.title_pl || p.title_en || p.slug || p.id, slug: p.slug });
  }
  for (const p of pages.data ?? []) {
    titleById.set(p.id, { title: p.title_pl || p.title_en || p.slug || p.id, slug: p.slug });
  }

  return rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    mode: String(r.mode),
    metering_policy: normalizeMeteringPolicy(r.metering_policy),
    title: titleById.get(r.entity_id)?.title ?? r.entity_id,
    slug: titleById.get(r.entity_id)?.slug ?? null,
  }));
}

function MeteringOverridesCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const overrides = useQuery({
    queryKey: ["metering-overrides"] as const,
    queryFn: fetchMeteringOverrides,
  });

  const setPolicy = async (row: OverrideRow, policy: MeteringPolicy) => {
    const { error } = await supabase
      .from("content_access")
      .update({ metering_policy: policy })
      .eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("admin.paywall.overrideSaved"));
    void qc.invalidateQueries({ queryKey: ["metering-overrides"] });
  };

  const rows = overrides.data ?? [];

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{t("admin.paywall.overridesTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {t("admin.paywall.overridesSubtitle")}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("admin.paywall.overridesEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-2">{t("admin.paywall.overridesColEntity")}</th>
                <th className="text-left p-2">{t("admin.paywall.overridesColMode")}</th>
                <th className="text-left p-2 w-56">{t("admin.paywall.overridesColPolicy")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0">
                  <td className="p-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {row.entity_type === "post"
                          ? t("admin.paywall.entityPost")
                          : t("admin.paywall.entityPage")}
                      </span>
                      {row.slug ? (
                        <Link
                          to={
                            row.entity_type === "post" ? "/admin/posts/$slug" : "/admin/pages/$slug"
                          }
                          params={{ slug: row.slug }}
                          className="truncate font-medium hover:underline"
                        >
                          {row.title}
                        </Link>
                      ) : (
                        <span className="truncate font-medium">{row.title}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-2 text-muted-foreground">{row.mode}</td>
                  <td className="p-2">
                    <Select
                      value={row.metering_policy}
                      onValueChange={(v) => void setPolicy(row, v as MeteringPolicy)}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {t("admin.paywall.overridePolicyInherit")}
                        </SelectItem>
                        <SelectItem value="metered">
                          {t("admin.paywall.overridePolicyMetered")}
                        </SelectItem>
                        <SelectItem value="exempt">
                          {t("admin.paywall.overridePolicyExempt")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Checkout - kupony (kody promocyjne Stripe), Stripe Tax, NIP na fakturze,
// faktury dla płatności jednorazowych. Serwer czyta te flagi przy tworzeniu
// sesji (createCheckoutOrder).
// ---------------------------------------------------------------------------
function CheckoutSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: saved, isLoading } = useCheckoutSettings();
  const [form, setForm] = useState<CheckoutSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const current = form ?? saved ?? null;

  const save = async () => {
    if (!current) return;
    setBusy(true);
    const { data: auth } = await supabase.auth.getSession().then(r => ({ data: { user: r.data.session?.user ?? null } }));
    const { error } = await supabase.from("checkout_settings").upsert(
      {
        allow_promotion_codes: current.allow_promotion_codes,
        automatic_tax: current.automatic_tax,
        tax_id_collection: current.tax_id_collection,
        billing_address_collection: current.billing_address_collection,
        invoice_creation: current.invoice_creation,
        updated_by: auth.user?.id ?? null,
      },
      { onConflict: "tenant_id" },
    );
    setBusy(false);
    if (error) {
      toast.error(t("admin.paywall.checkoutSaveError"));
      return;
    }
    toast.success(t("admin.paywall.checkoutSaved"));
    void qc.invalidateQueries({ queryKey: CHECKOUT_SETTINGS_QUERY_KEY });
  };

  type CheckoutToggleKey =
    | "allow_promotion_codes"
    | "automatic_tax"
    | "tax_id_collection"
    | "invoice_creation";

  const toggle = (labelKey: string, hintKey: string, key: CheckoutToggleKey) =>
    current ? (
      <div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch
            checked={current[key]}
            onCheckedChange={(v) => setForm({ ...current, [key]: v })}
          />
          {t(labelKey)}
        </label>
        <p className="mt-1 pl-10 text-xs text-muted-foreground">{t(hintKey)}</p>
      </div>
    ) : null;

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{t("admin.paywall.checkoutTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {t("admin.paywall.checkoutSubtitle")}
      </p>
      {isLoading || !current ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <div className="space-y-4">
          {toggle(
            "admin.paywall.allowPromo",
            "admin.paywall.allowPromoHint",
            "allow_promotion_codes",
          )}
          {toggle("admin.paywall.automaticTax", "admin.paywall.automaticTaxHint", "automatic_tax")}
          {toggle(
            "admin.paywall.taxIdCollection",
            "admin.paywall.taxIdCollectionHint",
            "tax_id_collection",
          )}
          {toggle(
            "admin.paywall.invoiceCreation",
            "admin.paywall.invoiceCreationHint",
            "invoice_creation",
          )}
          <div>
            <Label>{t("admin.paywall.addressCollection")}</Label>
            <Select
              value={current.billing_address_collection}
              onValueChange={(v) =>
                setForm({
                  ...current,
                  billing_address_collection: v === "required" ? "required" : "auto",
                })
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("admin.paywall.addressAuto")}</SelectItem>
                <SelectItem value="required">{t("admin.paywall.addressRequired")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={save} disabled={busy}>
            {t("admin.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
