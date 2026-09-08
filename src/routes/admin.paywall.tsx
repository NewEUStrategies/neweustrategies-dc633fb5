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
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";

import {
  DEFAULT_METERING_SETTINGS,
  normalizeMeteringPolicy,
  useMeteringSettings,
  type MeteringPolicy,
  type MeteringSettings,
} from "@/lib/access/metering";
import { CHECKOUT_SETTINGS_QUERY_KEY, useCheckoutSettings } from "@/hooks/useCheckoutSettings";
import {
  checkoutBillingPlane,
  checkoutSessionParams,
  type CheckoutSettings,
} from "@/lib/billing/checkoutSettings";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";
import { Layers, Gauge, SlidersHorizontal, CreditCard, Sparkles, Activity } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";

import { confirmDialog } from "@/lib/appDialogs";
import { uiLocale } from "@/lib/i18n/format";
import { useNowMs } from "@/lib/time/useNowMs";
import { toastError } from "@/lib/toastError";
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
  const qc = useQueryClient();
  const plansQuery = useQuery({
    queryKey: ["admin-access-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("access_plans").select("*").order("sort_order");
      if (error) throw error;
      return (data as AccessPlan[]) ?? [];
    },
  });
  const plans = plansQuery.data ?? [];
  const [draft, setDraft] = useState<Partial<AccessPlan>>(emptyPlan());
  const [busy, setBusy] = useState(false);
  const load = () => qc.invalidateQueries({ queryKey: ["admin-access-plans"] });

  const save = async () => {
    setBusy(true);
    try {
      const { error } = draft.id
        ? await supabase.from("access_plans").update(draft).eq("id", draft.id)
        : await supabase.from("access_plans").insert(draft);
      if (error) throw error;
      toast.success(t("admin.paywall.savedPlan"));
      setDraft(emptyPlan());
      await load();
    } catch (error) {
      toastError(error, "save");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: t("admin.paywall.confirmRemove"),
        destructive: true,
        confirmLabel: t("admin.delete"),
      }))
    )
      return;
    try {
      const { error } = await supabase.from("access_plans").delete().eq("id", id);
      if (error) throw error;
      toast.success(t("admin.paywall.removed"));
      await load();
    } catch (error) {
      toastError(error, "delete");
    }
  };

  const activePlans = plans.filter((p) => p.active).length;
  const highlightedPlans = plans.filter((p) => p.highlighted).length;
  const currencies = Array.from(new Set(plans.map((p) => (p.currency ?? "PLN").toUpperCase())));

  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        {/* Header + KPI: szybki podgląd stanu paywalla bez wchodzenia w zakładki. */}
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-bold">{t("admin.paywall.title")}</h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {t("admin.paywall.subtitle")}
              </p>
            </div>
            {highlightedPlans > 0 && (
              <Badge variant="secondary" className="gap-1 rounded-[6px]">
                <Sparkles className="h-3 w-3" aria-hidden />
                {t("admin.paywall.highlighted")} × {highlightedPlans}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <KpiTile
              icon={Layers}
              label={t("admin.paywall.kpiPlans")}
              value={String(plans.length)}
            />
            <KpiTile
              icon={Activity}
              label={t("admin.paywall.kpiActive")}
              value={String(activePlans)}
            />
            <KpiTile
              icon={CreditCard}
              label={t("admin.paywall.kpiCurrencies")}
              value={currencies.join(" / ") || "-"}
            />
            <KpiTile
              icon={Gauge}
              label={t("admin.paywall.kpiMetering")}
              value={t("admin.paywall.kpiConfigured")}
            />
          </div>
        </header>

        {/* Tabs porządkują 4 luźne sekcje w jasny podział: Plany | Metering | Wyjątki | Checkout. */}
        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="grid w-full grid-cols-2 gap-2 rounded-[6px] bg-muted/50 p-1.5 border border-border/60 shadow-sm sm:inline-flex sm:h-11 sm:w-auto sm:grid-cols-none sm:gap-1">
            <TabsTrigger
              value="plans"
              className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:bg-muted/60 hover:text-foreground sm:h-8"
            >
              <Layers className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t("admin.paywall.tabPlans")}</span>
              <span className="ml-0.5 rounded-[4px] bg-muted px-1.5 py-0 text-[10px] font-semibold tabular-nums data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                {plans.length}
              </span>
            </TabsTrigger>
            <TabsTrigger
              value="metering"
              className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:bg-muted/60 hover:text-foreground sm:h-8"
            >
              <Gauge className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t("admin.paywall.tabMetering")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="overrides"
              className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:bg-muted/60 hover:text-foreground sm:h-8"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t("admin.paywall.tabOverrides")}</span>
            </TabsTrigger>
            <TabsTrigger
              value="checkout"
              className="h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:bg-muted/60 hover:text-foreground sm:h-8"
            >
              <CreditCard className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{t("admin.paywall.tabCheckout")}</span>
            </TabsTrigger>
          </TabsList>

          {/* ————— PLANY ————— */}
          <TabsContent value="plans" className="mt-4 space-y-6">
            <SectionCard
              icon={Layers}
              title={t("admin.paywall.plansListTitle")}
              description={t("admin.paywall.plansListDesc")}
              padded={false}
            >
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
                    <tr
                      key={p.id}
                      className="border-b border-border last:border-0 hover:bg-muted/40"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{p.name_pl || p.name_en}</span>
                          {p.highlighted && (
                            <Badge
                              variant="secondary"
                              className="h-4 rounded-[6px] px-1.5 text-[10px]"
                            >
                              <Sparkles className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                              {t("admin.paywall.highlighted")}
                            </Badge>
                          )}
                        </div>
                        {p.name_en && p.name_pl && (
                          <div className="text-xs text-muted-foreground">{p.name_en}</div>
                        )}
                      </td>
                      <td className="p-3">
                        {formatMoney(p.price_cents, p.currency)}
                        {p.currency?.toUpperCase() === "PLN" && (
                          <div className="text-[11px] text-muted-foreground">
                            EN:{" "}
                            {formatMoney(
                              convertToDisplayCurrency(p.price_cents, p.currency, "EUR").cents,
                              "EUR",
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-muted-foreground">{p.interval}</td>
                      <td className="p-3">
                        {p.active ? (
                          <Badge variant="secondary" className="rounded-[6px]">
                            {t("admin.paywall.active")}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 text-right space-x-2">
                        <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                          {t("admin.paywall.edit")}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("admin.delete")}
                          onClick={() => remove(p.id)}
                        >
                          <Trash className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {(plansQuery.isPending || plansQuery.isError || plans.length === 0) && (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                        {plansQuery.isError ? (
                          <span role="alert">{t("admin.paywall.readError")}</span>
                        ) : plansQuery.isPending ? (
                          <span role="status">{t("common.loading")}</span>
                        ) : (
                          t("admin.paywall.empty")
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </SectionCard>

            <SectionCard
              icon={Plus}
              title={draft.id ? t("admin.paywall.editPlan") : t("admin.paywall.newPlan")}
              description={t("admin.paywall.newPlanDesc")}
            >
              {/* Grupa: Nazewnictwo */}
              <FieldGroup label={t("admin.paywall.groupNaming")}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="paywall-namePl">{t("admin.paywall.namePl")}</Label>
                    <Input
                      id="paywall-namePl"
                      value={draft.name_pl ?? ""}
                      onChange={(e) => setDraft({ ...draft, name_pl: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="paywall-nameEn">{t("admin.paywall.nameEn")}</Label>
                    <Input
                      id="paywall-nameEn"
                      value={draft.name_en ?? ""}
                      onChange={(e) => setDraft({ ...draft, name_en: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="paywall-descPl">{t("admin.paywall.descPl")}</Label>
                    <Textarea
                      id="paywall-descPl"
                      rows={2}
                      value={draft.description_pl ?? ""}
                      onChange={(e) => setDraft({ ...draft, description_pl: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="paywall-descEn">{t("admin.paywall.descEn")}</Label>
                    <Textarea
                      id="paywall-descEn"
                      rows={2}
                      value={draft.description_en ?? ""}
                      onChange={(e) => setDraft({ ...draft, description_en: e.target.value })}
                    />
                  </div>
                </div>
              </FieldGroup>

              {/* Grupa: Cennik i rozliczenie */}
              <FieldGroup label={t("admin.paywall.groupPricing")}>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div>
                    <Label htmlFor="paywall-priceCents">{t("admin.paywall.priceCents")}</Label>
                    <Input
                      id="paywall-priceCents"
                      type="number"
                      value={draft.price_cents ?? 0}
                      onChange={(e) => setDraft({ ...draft, price_cents: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="paywall-currency">{t("admin.paywall.currency")}</Label>
                    <Input
                      id="paywall-currency"
                      value={draft.currency ?? "PLN"}
                      onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label>{t("admin.paywall.interval")}</Label>
                    <Select
                      value={draft.interval ?? "month"}
                      onValueChange={(v) =>
                        setDraft({ ...draft, interval: v as AccessPlan["interval"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="two_weeks">
                          {t("admin.paywall.intervalTwoWeeks")}
                        </SelectItem>
                        <SelectItem value="month">{t("admin.paywall.intervalMonth")}</SelectItem>
                        <SelectItem value="quarter">
                          {t("admin.paywall.intervalQuarter")}
                        </SelectItem>
                        <SelectItem value="year">{t("admin.paywall.intervalYear")}</SelectItem>
                        <SelectItem value="one_time">{t("admin.paywall.intervalOnce")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="paywall-trialDays">{t("admin.paywall.trialDays")}</Label>
                    <Input
                      id="paywall-trialDays"
                      type="number"
                      min={0}
                      value={draft.trial_days ?? 0}
                      onChange={(e) => setDraft({ ...draft, trial_days: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </FieldGroup>

              {/* Grupa: Widoczność i akcenty */}
              <FieldGroup label={t("admin.paywall.groupVisibility")}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!draft.active}
                      onCheckedChange={(v) => setDraft({ ...draft, active: v })}
                    />
                    {t("admin.paywall.active")}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={!!draft.highlighted}
                      onCheckedChange={(v) => setDraft({ ...draft, highlighted: v })}
                    />
                    {t("admin.paywall.highlighted")}
                  </label>
                  <div>
                    <Label htmlFor="paywall-sort">{t("admin.paywall.sort")}</Label>
                    <Input
                      id="paywall-sort"
                      type="number"
                      value={draft.sort_order ?? 0}
                      onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
                      className="w-24"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="paywall-badgePl">{t("admin.paywall.badgePl")}</Label>
                      <Input
                        id="paywall-badgePl"
                        value={draft.badge_pl ?? ""}
                        onChange={(e) => setDraft({ ...draft, badge_pl: e.target.value })}
                        placeholder="Najpopularniejszy"
                      />
                    </div>
                    <div>
                      <Label htmlFor="paywall-badgeEn">{t("admin.paywall.badgeEn")}</Label>
                      <Input
                        id="paywall-badgeEn"
                        value={draft.badge_en ?? ""}
                        onChange={(e) => setDraft({ ...draft, badge_en: e.target.value })}
                        placeholder="Most popular"
                      />
                    </div>
                  </div>
                </div>
              </FieldGroup>

              {/* Grupa: Lista funkcji */}
              <FieldGroup label={t("admin.paywall.groupFeatures")}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="paywall-featuresPl">{t("admin.paywall.featuresPl")}</Label>
                    <Textarea
                      id="paywall-featuresPl"
                      rows={5}
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
                  <div>
                    <Label htmlFor="paywall-featuresEn">{t("admin.paywall.featuresEn")}</Label>
                    <Textarea
                      id="paywall-featuresEn"
                      rows={5}
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
              </FieldGroup>

              <div className="flex gap-2 pt-2 border-t border-border/60 mt-2">
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
            </SectionCard>
          </TabsContent>

          {/* ————— METERING ————— */}
          <TabsContent value="metering" className="mt-4">
            <MeteringSettingsCard />
          </TabsContent>

          {/* ————— WYJĄTKI ————— */}
          <TabsContent value="overrides" className="mt-4">
            <MeteringOverridesCard />
          </TabsContent>

          {/* ————— CHECKOUT ————— */}
          <TabsContent value="checkout" className="mt-4">
            <CheckoutSettingsCard />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------
// UI primitives lokalne dla tej strony - trzymają spójny wygląd sekcji, KPI
// i grup pól. Nie eksportowane, bo nigdzie indziej nie mają sensu.
// ---------------------------------------------------------------------------

type IconType = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function KpiTile({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card px-3 py-2.5 flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted/60 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
      </div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
  padded = true,
}: {
  icon: IconType;
  title: string;
  description?: string;
  children: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="border border-border rounded-lg bg-card overflow-hidden">
      <header className="flex items-start gap-3 border-b border-border/60 bg-muted/20 px-5 py-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[6px] bg-background text-muted-foreground border border-border/60">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-sm">{title}</h2>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{description}</p>
          )}
        </div>
      </header>
      <div className={padded ? "p-5 space-y-5" : ""}>{children}</div>
    </section>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/60" aria-hidden />
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metering - globalna konfiguracja darmowego limitu miesięcznego. Singleton
// per tenant (metering_settings); egzekwowanie serwerowe (consume_metered_view).
// ---------------------------------------------------------------------------
function MeteringSettingsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: saved, isLoading, isError } = useMeteringSettings();
  const [draft, setDraft] = useState<MeteringSettings | null>(null);
  const form = draft ?? saved ?? DEFAULT_METERING_SETTINGS;
  const setForm = setDraft;
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      const { error } = await supabase.from("metering_settings").upsert(
        {
          enabled: form.enabled,
          member_monthly_limit: Math.max(0, Math.min(1000, Math.round(form.member_monthly_limit))),
          anon_monthly_limit: Math.max(0, Math.min(1000, Math.round(form.anon_monthly_limit))),
          meter_paid: form.meter_paid,
          meter_members: form.meter_members,
          show_counter: form.show_counter,
          updated_by: auth.session?.user.id ?? null,
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
      toast.success(t("admin.paywall.meteringSaved"));
      void qc.invalidateQueries({ queryKey: ["metering-settings"] });
    } catch (error) {
      console.error("[paywall] settings save failed", error);
      toast.error(t("admin.paywall.meteringSaveError"));
    } finally {
      setBusy(false);
    }
  };

  const numberField = (labelKey: string, value: number, onChange: (next: number) => void) => (
    <div>
      <Label htmlFor={labelKey}>{t(labelKey)}</Label>
      <Input
        id={labelKey}
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
      {isError ? (
        <p role="alert">{t("admin.paywall.readError")}</p>
      ) : isLoading ? (
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
          <MeteringImpactPreview proposedLimit={form.member_monthly_limit} enabled={form.enabled} />
          <Button onClick={save} disabled={busy}>
            {t("admin.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

// Podgląd wpływu limitu na bieżący miesiąc kalendarzowy. Odpytuje
// metering_impact_preview (staff-only) z debouncem, żeby nie palić RPC
// przy każdym uderzeniu klawisza.
interface ImpactRow {
  total_members: number;
  members_blocked: number;
  members_warning: number;
  members_safe: number;
  total_anon: number;
  anon_blocked: number;
  avg_used: number;
  max_used: number;
  total_views: number;
}

function MeteringImpactPreview({
  proposedLimit,
  enabled,
}: {
  proposedLimit: number;
  enabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const [debounced, setDebounced] = useState(proposedLimit);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(proposedLimit), 350);
    return () => window.clearTimeout(id);
  }, [proposedLimit]);

  const q = useQuery({
    queryKey: ["metering-impact-preview", debounced] as const,
    queryFn: async (): Promise<ImpactRow | null> => {
      const { data, error } = await supabase.rpc("metering_impact_preview", {
        _proposed_member_limit: Math.max(0, Math.min(1000, Math.round(debounced))),
      });
      if (error) throw error;
      const row = ((data ?? []) as ImpactRow[])[0];
      return row ?? null;
    },
    staleTime: 30_000,
    enabled,
  });

  const fmt = new Intl.NumberFormat(uiLocale(lang));
  const now = useNowMs(60_000);
  const monthLabel =
    now === null
      ? ""
      : new Intl.DateTimeFormat(uiLocale(lang), {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        }).format(now);
  const row = q.data;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-sm font-medium">{t("admin.paywall.meteringImpactTitle")}</p>
        <span className="text-xs text-muted-foreground capitalize">{monthLabel}</span>
      </div>
      {!enabled ? (
        <p className="text-xs text-muted-foreground">{t("admin.paywall.meteringImpactDisabled")}</p>
      ) : q.isLoading ? (
        <p className="text-xs text-muted-foreground">…</p>
      ) : q.isError ? (
        <p className="text-xs text-destructive">{t("admin.paywall.meteringImpactError")}</p>
      ) : !row || row.total_members + row.total_anon === 0 ? (
        <p className="text-xs text-muted-foreground">{t("admin.paywall.meteringImpactEmpty")}</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.paywall.meteringImpactBlocked")}
              </dt>
              <dd className="font-semibold tabular-nums text-destructive">
                {fmt.format(row.members_blocked)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.paywall.meteringImpactWarning")}
              </dt>
              <dd className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                {fmt.format(row.members_warning)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.paywall.meteringImpactSafe")}
              </dt>
              <dd className="font-semibold tabular-nums">{fmt.format(row.members_safe)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("admin.paywall.meteringImpactAvg")}
              </dt>
              <dd className="font-semibold tabular-nums">
                {fmt.format(Number(row.avg_used) || 0)}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {t("admin.paywall.meteringImpactSummary", {
              members: fmt.format(row.total_members),
              anon: fmt.format(row.total_anon),
              views: fmt.format(row.total_views),
              max: fmt.format(row.max_used),
              limit: fmt.format(debounced),
            })}
          </p>
        </>
      )}
    </div>
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
  if ("error" in posts && posts.error) throw posts.error;
  if ("error" in pages && pages.error) throw pages.error;
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
    try {
      const { error } = await supabase
        .from("content_access")
        .update({ metering_policy: policy })
        .eq("id", row.id);
      if (error) throw error;
      toast.success(t("admin.paywall.overrideSaved"));
      await qc.invalidateQueries({ queryKey: ["metering-overrides"] });
    } catch (error) {
      toastError(error, "save");
    }
  };

  const rows = overrides.data ?? [];

  return (
    <section className="border border-border rounded-lg bg-card p-5">
      <h2 className="font-semibold">{t("admin.paywall.overridesTitle")}</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        {t("admin.paywall.overridesSubtitle")}
      </p>
      {overrides.isError ? (
        <p role="alert">{t("admin.paywall.readError")}</p>
      ) : overrides.isPending ? (
        <p role="status">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
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
  const { data: saved, isLoading, isError } = useCheckoutSettings();
  const [form, setForm] = useState<CheckoutSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);

  const current = form ?? saved ?? null;

  const save = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      const { error } = await supabase.from("checkout_settings").upsert(
        {
          allow_promotion_codes: current.allow_promotion_codes,
          automatic_tax: current.automatic_tax,
          tax_id_collection: current.tax_id_collection,
          billing_address_collection: current.billing_address_collection,
          invoice_creation: current.invoice_creation,
          updated_by: auth.session?.user.id ?? null,
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
      toast.success(t("admin.paywall.checkoutSaved"));
      void qc.invalidateQueries({ queryKey: CHECKOUT_SETTINGS_QUERY_KEY });
    } catch (error) {
      console.error("[paywall] settings save failed", error);
      toast.error(t("admin.paywall.checkoutSaveError"));
    } finally {
      setBusy(false);
    }
  };

  type CheckoutToggleKey =
    "allow_promotion_codes" | "automatic_tax" | "tax_id_collection" | "invoice_creation";

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
      {isError ? (
        <p role="alert">{t("admin.paywall.readError")}</p>
      ) : isLoading || !current ? (
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
          {/* Podgląd tego, co NAPRAWDĘ pojedzie do sesji Stripe - liczony tą
              samą czystą funkcją co serwer, więc panel nie może obiecać flagi,
              której API nie dostanie (np. `automatic_tax` w trybie MoR). */}
          <CheckoutPlanePreview settings={current} />
          <Button onClick={save} disabled={busy}>
            {t("admin.save")}
          </Button>
        </div>
      )}
    </section>
  );
}

/** Płaszczyzna rozliczeniowa + lista parametrów sesji dla bieżących ustawień. */
function CheckoutPlanePreview({ settings }: { settings: CheckoutSettings }) {
  const { t } = useTranslation();
  const plane = checkoutBillingPlane(settings);
  // Podgląd dla zakupu jednorazowego z przypiętym klientem - jedyny tryb, w
  // którym widać komplet flag (subskrypcja nie przyjmuje `invoice_creation`).
  const params = checkoutSessionParams(settings, {
    mode: "payment",
    hasCustomer: true,
    hasDiscount: false,
  });
  const keys = Object.keys(params).sort().join(", ");
  return (
    <div className="rounded-md border border-border bg-muted/40 p-3">
      <p className="text-xs font-medium">{t("admin.paywall.planTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {plane === "managed" ? t("admin.paywall.planManaged") : t("admin.paywall.planMerchant")}
      </p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground break-words">
        {t("admin.paywall.planParams", { params: keys })}
      </p>
    </div>
  );
}
