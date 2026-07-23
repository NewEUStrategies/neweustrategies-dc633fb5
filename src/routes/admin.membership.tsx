// Panel warstw członkostwa: edycja katalogu warstw (nazwy, benefity, ranga)
// oraz mapowania plan sprzedażowy -> warstwa (access_plans.tier_key).
// Benefity edytowane per-punkt (para PL/EN, kolejność drag = przyciski up/down);
// features (bramki maszynowe) jako surowy JSON dla adminów.
import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BadgeCheck,
  Crown,
  Save,
  Plus,
  Trash2,
  Layers,
  Users,
  Landmark,
  ShieldCheck,
  Gift,
  Tag,
  Settings2,
  FileJson,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ensureI18n as ensureAdminMembershipI18n } from "@/lib/i18n-admin-membership";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingInput } from "@/components/ui/floating-input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { billingKeys } from "@/lib/billing/keys";
import { fetchActivePlans } from "@/lib/billing/queries";
import { planName } from "@/lib/billing/types";
import { convertToDisplayCurrency } from "@/lib/billing/displayCurrency";

import {
  parseTierBenefits,
  serializeTierBenefits,
  type MembershipTierRow,
  type TierBenefit,
} from "@/lib/billing/tiers";
import { TierBenefitsEditor } from "@/components/admin/pricing/TierBenefitsEditor";
import { TierFeatureTogglesEditor } from "@/components/admin/pricing/TierFeatureTogglesEditor";
import { ExpertRequestQuotaEditor } from "@/components/admin/pricing/ExpertRequestQuotaEditor";
import { ConfluenceReconciliationCard } from "@/components/admin/pricing/ConfluenceReconciliationCard";
import {
  fetchMembershipGrants,
  grantMembership,
  revokeGrant,
  type AdminGrantRow,
} from "@/lib/admin/membership-admin";
import type { Json } from "@/integrations/supabase/types";

export const Route = createFileRoute("/admin/membership")({
  component: AdminMembershipPage,
});

interface TierDraft {
  name_pl: string;
  name_en: string;
  description_pl: string;
  description_en: string;
  rank: number;
  benefits: TierBenefit[];
  features: string;
  active: boolean;
  is_default: boolean;
}

function draftFromTier(tier: MembershipTierRow): TierDraft {
  return {
    name_pl: tier.name_pl,
    name_en: tier.name_en,
    description_pl: tier.description_pl ?? "",
    description_en: tier.description_en ?? "",
    rank: tier.rank,
    benefits: parseTierBenefits(tier.benefits),
    features: JSON.stringify(tier.features ?? {}, null, 0),
    active: tier.active,
    is_default: tier.is_default,
  };
}

function AdminMembershipPage() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMembershipI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const qc = useQueryClient();

  const tiersQ = useQuery({
    queryKey: billingKeys.admin.membershipTiers(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("membership_tiers")
        .select("*")
        .order("rank", { ascending: true });
      if (error) throw error;
      return data;
    },
  });
  const plansQ = useQuery({ queryKey: billingKeys.admin.plans(), queryFn: fetchActivePlans });
  const grantsPreviewQ = useQuery({
    queryKey: billingKeys.admin.membershipGrants(),
    queryFn: fetchMembershipGrants,
  });

  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const tierOptions = useMemo(
    () => (tiersQ.data ?? []).filter((tier) => tier.active),
    [tiersQ.data],
  );

  const tiers = tiersQ.data ?? [];
  const activeTiersCount = tiers.filter((tt) => tt.active).length;
  const defaultTier = tiers.find((tt) => tt.is_default);
  const mappedPlansCount = (plansQ.data ?? []).filter((p) => p.tier_key).length;
  const activeGrantsCount = (grantsPreviewQ.data ?? []).filter((g) => !g.revoked_at).length;

  const saveTier = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: TierDraft }) => {
      let features: Json;
      try {
        features = JSON.parse(draft.features || "{}") as Json;
      } catch {
        throw new Error(tm("toast.featuresInvalid"));
      }
      const { error } = await supabase
        .from("membership_tiers")
        .update({
          name_pl: draft.name_pl.trim(),
          name_en: draft.name_en.trim(),
          description_pl: draft.description_pl.trim() || null,
          description_en: draft.description_en.trim() || null,
          rank: draft.rank,
          benefits: serializeTierBenefits(draft.benefits),
          features,
          active: draft.active,
          is_default: draft.is_default,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierSaved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteTier = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("membership_tiers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierDeleted"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createTier = useMutation({
    mutationFn: async (input: { key: string; rank: number; name_pl: string; name_en: string }) => {
      // tenant_id wymuszony przez politykę RLS - pobierz z istniejącej warstwy
      const existing = tiersQ.data?.[0];
      if (!existing) throw new Error(tm("toast.noTenant"));
      const { error } = await supabase.from("membership_tiers").insert({
        tenant_id: existing.tenant_id,
        key: input.key.trim(),
        rank: input.rank,
        name_pl: input.name_pl.trim(),
        name_en: input.name_en.trim(),
        benefits: [] as unknown as Json,
        features: {} as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.tierCreated"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipTiers() });
      void qc.invalidateQueries({ queryKey: billingKeys.membershipTiers() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const savePlanTier = useMutation({
    mutationFn: async ({ planId, tierKey }: { planId: string; tierKey: string | null }) => {
      const { error } = await supabase
        .from("access_plans")
        .update({ tier_key: tierKey })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(tm("toast.planMappingSaved"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.plans() });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6 p-6">
      {/* Header + KPI: szybki podgląd stanu katalogu warstw. */}
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
              <Crown className="h-6 w-6" aria-hidden="true" />
              {tm("title")}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{tm("subtitle")}</p>
          </div>
          <NewTierDialog
            lang={lang}
            existingKeys={tiers.map((tt) => tt.key)}
            suggestedRank={(tiers.at(-1)?.rank ?? 0) + 10}
            onCreate={(v) => createTier.mutate(v)}
            isPending={createTier.isPending}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <KpiTile
            icon={Layers}
            label={tm("kpi.tiers")}
            value={`${activeTiersCount} / ${tiers.length}`}
          />
          <KpiTile
            icon={ShieldCheck}
            label={tm("kpi.default")}
            value={defaultTier ? (lang === "pl" ? defaultTier.name_pl : defaultTier.name_en) : "-"}
          />
          <KpiTile
            icon={Tag}
            label={tm("kpi.mappedPlans")}
            value={`${mappedPlansCount} / ${(plansQ.data ?? []).length}`}
          />
          <KpiTile icon={Gift} label={tm("kpi.activeGrants")} value={String(activeGrantsCount)} />
        </div>
      </header>

      {/* Tabs porządkują 4 obszary: katalog warstw | mapowanie planów | nadania | organizacje. */}
      <Tabs defaultValue="tiers" className="w-full">
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-md bg-muted/40 p-1">
          <TabsTrigger value="tiers" className="gap-1.5 rounded-[6px] text-xs">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            {tm("tabs.tiers")}
            <span className="ml-1 rounded-[6px] bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
              {tiers.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="mapping" className="gap-1.5 rounded-[6px] text-xs">
            <Tag className="h-3.5 w-3.5" aria-hidden />
            {tm("tabs.mapping")}
          </TabsTrigger>
          <TabsTrigger value="grants" className="gap-1.5 rounded-[6px] text-xs">
            <Gift className="h-3.5 w-3.5" aria-hidden />
            {tm("tabs.grants")}
            <span className="ml-1 rounded-[6px] bg-background/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
              {activeGrantsCount}
            </span>
          </TabsTrigger>
          <TabsTrigger value="orgs" className="gap-1.5 rounded-[6px] text-xs">
            <Landmark className="h-3.5 w-3.5" aria-hidden />
            {tm("tabs.orgs")}
          </TabsTrigger>
        </TabsList>

        {/* ————— WARSTWY ————— */}
        <TabsContent value="tiers" className="mt-4 space-y-4">
          <SectionCard
            icon={Layers}
            title={tm("sections.tiersTitle")}
            description={tm("sections.tiersDesc")}
            padded={false}
          >
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {tiers.map((tier) => {
                const draft = drafts[tier.id] ?? draftFromTier(tier);
                const set = (patch: Partial<TierDraft>) =>
                  setDrafts((d) => ({ ...d, [tier.id]: { ...draft, ...patch } }));
                const setBenefits = (list: TierBenefit[]) => set({ benefits: list });
                return (
                  <article
                    key={tier.id}
                    className="flex flex-col overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <header className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-4 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <BadgeCheck
                          className="h-4 w-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
                        <span className="truncate font-mono text-sm font-semibold">
                          {tier.key}
                        </span>
                        <Badge variant="secondary" className="rounded-[6px] text-[10px]">
                          {tm("rankBadge")} {tier.rank}
                        </Badge>
                        {tier.is_default && (
                          <Badge className="rounded-[6px] bg-primary/10 text-[10px] text-primary hover:bg-primary/10">
                            {tm("defaultBadge")}
                          </Badge>
                        )}
                        {!tier.active && (
                          <Badge variant="outline" className="rounded-[6px] text-[10px]">
                            {tm("inactiveBadge")}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (confirm(tm("deleteConfirm", { key: tier.key }))) {
                            deleteTier.mutate(tier.id);
                          }
                        }}
                        disabled={deleteTier.isPending || tier.is_default}
                        title={
                          tier.is_default ? tm("deleteDefaultDisabled") : tm("deleteTitle")
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </header>

                    <div className="flex flex-1 flex-col gap-5 p-4">
                      <FieldGroup label={tm("groups.naming")}>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Nazwa PL</Label>
                            <Input
                              value={draft.name_pl}
                              onChange={(e) => set({ name_pl: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Name EN</Label>
                            <Input
                              value={draft.name_en}
                              onChange={(e) => set({ name_en: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Opis PL</Label>
                            <Textarea
                              rows={2}
                              value={draft.description_pl}
                              onChange={(e) => set({ description_pl: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Description EN</Label>
                            <Textarea
                              rows={2}
                              value={draft.description_en}
                              onChange={(e) => set({ description_en: e.target.value })}
                            />
                          </div>
                        </div>
                      </FieldGroup>

                      <FieldGroup label={tm("groups.status")}>
                        <div className="grid grid-cols-3 items-end gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">{tm("fields.rank")}</Label>
                            <Input
                              type="number"
                              min={0}
                              value={draft.rank}
                              onChange={(e) => set({ rank: Number(e.target.value) || 0 })}
                            />
                          </div>
                          <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs">
                            <Switch
                              checked={draft.active}
                              onCheckedChange={(v) => set({ active: v })}
                            />
                            {tm("fields.active")}
                          </label>
                          <label className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-2 text-xs">
                            <Switch
                              checked={draft.is_default}
                              onCheckedChange={(v) => set({ is_default: v })}
                            />
                            {tm("fields.default")}
                          </label>
                        </div>
                      </FieldGroup>

                      <FieldGroup label={tm("groups.benefits")}>
                        <TierBenefitsEditor value={draft.benefits} onChange={setBenefits} />
                      </FieldGroup>

                      <FieldGroup label={tm("groups.capabilities")}>
                        <div className="space-y-3">
                          <div>
                            <Label className="mb-1 block text-xs">
                              {tm("fields.featuresKnown")}
                            </Label>
                            <TierFeatureTogglesEditor
                              value={draft.features}
                              onChange={(features) => set({ features })}
                            />
                          </div>
                          <ExpertRequestQuotaEditor
                            value={draft.features}
                            onChange={(features) => set({ features })}
                          />
                          <div className="space-y-1">
                            <Label className="flex items-center gap-1.5 text-xs">
                              <FileJson className="h-3 w-3" aria-hidden />
                              {tm("fields.featuresJson")}
                            </Label>
                            <Input
                              value={draft.features}
                              onChange={(e) => set({ features: e.target.value })}
                              className="font-mono text-xs"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {tm("fields.featuresHint")}
                            </p>
                          </div>
                        </div>
                      </FieldGroup>

                      <div className="mt-auto pt-1">
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={saveTier.isPending}
                          onClick={() => saveTier.mutate({ id: tier.id, draft })}
                        >
                          <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          {tm("save")}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ————— MAPOWANIE PLANÓW ————— */}
        <TabsContent value="mapping" className="mt-4 space-y-4">
          <SectionCard icon={Tag} title={tm("mapping.heading")} description={tm("mapping.hint")}>
            <div className="space-y-2">
              {(plansQ.data ?? []).map((plan) => (
                <div
                  key={plan.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{planName(plan, lang)}</div>
                    <div className="text-xs text-muted-foreground">
                      {(plan.price_cents / 100).toFixed(2)} {plan.currency} / {plan.interval}
                      {plan.currency.toUpperCase() === "PLN" && (
                        <span className="ml-2 text-[11px] text-muted-foreground/80">
                          · EN:{" "}
                          {(
                            convertToDisplayCurrency(plan.price_cents, plan.currency, "EUR")
                              .cents / 100
                          ).toFixed(2)}{" "}
                          EUR
                        </span>
                      )}
                    </div>
                  </div>
                  <Select
                    value={plan.tier_key ?? "none"}
                    onValueChange={(v) =>
                      savePlanTier.mutate({
                        planId: plan.id,
                        tierKey: v === "none" ? null : v,
                      })
                    }
                    disabled={savePlanTier.isPending}
                  >
                    <SelectTrigger className="w-44 shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{tm("mapping.noTier")}</SelectItem>
                      {tierOptions.map((tier) => (
                        <SelectItem key={tier.key} value={tier.key}>
                          {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        {/* ————— NADANIA ————— */}
        <TabsContent value="grants" className="mt-4 space-y-4">
          <GrantsSection lang={lang} tierOptions={tierOptions} />
        </TabsContent>

        {/* ————— ORGANIZACJE + CONFLUENCE ————— */}
        <TabsContent value="orgs" className="mt-4 space-y-4">
          <SectionCard icon={Landmark} title={tm("org.heading")} description={tm("org.hint")}>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/organizations">
                <Landmark className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {tm("org.open")}
              </Link>
            </Button>
          </SectionCard>
          {/* Referencja tylko dla zespołu: uzgodnienie z modelem Confluence. */}
          <ConfluenceReconciliationCard lang={lang} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nadania warstwy poza planem (membership_grants): komplementarne / fakturowe.
// ---------------------------------------------------------------------------
function GrantsSection({
  lang,
  tierOptions,
}: {
  lang: "pl" | "en";
  tierOptions: MembershipTierRow[];
}) {
  const { t } = useTranslation();
  const tm = (k: string, opts?: Record<string, unknown>) => t(`adminMembership.${k}`, opts);
  const qc = useQueryClient();

  const grantsQ = useQuery({
    queryKey: billingKeys.admin.membershipGrants(),
    queryFn: fetchMembershipGrants,
  });

  const [email, setEmail] = useState("");
  const [tierKey, setTierKey] = useState("");
  const [months, setMonths] = useState("12");
  const [note, setNote] = useState("");

  const grantM = useMutation({
    mutationFn: () =>
      grantMembership({
        email: email.trim(),
        tierKey,
        months: months.trim() === "" ? null : Number(months),
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast.success(tm("toast.grantSuccess"));
      setEmail("");
      setNote("");
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipGrants() });
    },
    onError: (e: Error) => {
      const msg = e.message || "";
      if (msg.includes("user not found")) toast.error(tm("toast.noAccount"));
      else if (msg.includes("tier not found")) toast.error(tm("toast.unknownTier"));
      else toast.error(msg);
    },
  });

  const revokeM = useMutation({
    mutationFn: (id: string) => revokeGrant(id),
    onSuccess: () => {
      toast.success(tm("toast.grantRevoked"));
      void qc.invalidateQueries({ queryKey: billingKeys.admin.membershipGrants() });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canGrant = /.+@.+\..+/.test(email.trim()) && tierKey !== "";
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB") : "—";
  const sourceLabel = (s: string) =>
    s === "donation"
      ? tm("grants.sourceDonation")
      : s === "import"
        ? tm("grants.sourceImport")
        : tm("grants.sourceManual");

  const activeGrants = (grantsQ.data ?? []).filter((g) => !g.revoked_at);
  const revokedGrants = (grantsQ.data ?? []).filter((g) => g.revoked_at);

  const renderRow = (g: AdminGrantRow) => (
    <div
      key={g.id}
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/60 bg-background px-3 py-2"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">
          {g.display_name ? `${g.display_name} · ` : ""}
          {g.email}
        </div>
        <div className="text-xs text-muted-foreground">
          {g.tier_key} · {sourceLabel(g.source)} ·{" "}
          {g.expires_at ? `${tm("grants.until")} ${fmtDate(g.expires_at)}` : tm("grants.noExpiry")}
          {g.revoked_at ? ` · ${tm("grants.revoked")}` : ""}
        </div>
      </div>
      {!g.revoked_at && (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground hover:text-destructive"
          disabled={revokeM.isPending}
          onClick={() => revokeM.mutate(g.id)}
        >
          <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
          {tm("grants.revoke")}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <SectionCard icon={Plus} title={tm("grants.newHeading")} description={tm("grants.hint")}>
        <FieldGroup label={tm("groups.grantForm")}>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="osoba@instytucja.eu"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tm("grants.tier")}</Label>
              <Select value={tierKey} onValueChange={setTierKey}>
                <SelectTrigger>
                  <SelectValue placeholder={tm("grants.tierSelect")} />
                </SelectTrigger>
                <SelectContent>
                  {tierOptions.map((tier) => (
                    <SelectItem key={tier.key} value={tier.key}>
                      {tier.key} ({lang === "pl" ? tier.name_pl : tier.name_en})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tm("grants.months")}</Label>
              <Input
                type="number"
                min={1}
                max={120}
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                placeholder="∞"
              />
            </div>
            <Button disabled={!canGrant || grantM.isPending} onClick={() => grantM.mutate()}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {tm("grants.grant")}
            </Button>
            <div className="sm:col-span-4">
              <FloatingInput
                label={tm("grants.note")}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
        </FieldGroup>
      </SectionCard>

      <SectionCard
        icon={Users}
        title={tm("grants.activeHeading")}
        description={tm("grants.activeHint")}
      >
        {activeGrants.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tm("grants.empty")}</p>
        ) : (
          <div className="space-y-2">{activeGrants.map(renderRow)}</div>
        )}
      </SectionCard>

      {revokedGrants.length > 0 && (
        <SectionCard
          icon={Settings2}
          title={tm("grants.revokedHeading")}
          description={tm("grants.revokedHint")}
        >
          <div className="space-y-2 opacity-70">{revokedGrants.map(renderRow)}</div>
        </SectionCard>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog: nowa warstwa - key (slug), ranga, nazwy PL/EN.
// ---------------------------------------------------------------------------
function NewTierDialog({
  lang: _lang,
  existingKeys,
  suggestedRank,
  onCreate,
  isPending,
}: {
  lang: "pl" | "en";
  existingKeys: string[];
  suggestedRank: number;
  onCreate: (v: { key: string; rank: number; name_pl: string; name_en: string }) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const tm = (k: string) => t(`adminMembership.${k}`);
  const [open, setOpen] = useState(false);

  const [key, setKey] = useState("");
  const [rank, setRank] = useState(suggestedRank);
  const [namePl, setNamePl] = useState("");
  const [nameEn, setNameEn] = useState("");

  const keyOk = /^[a-z0-9_-]{2,32}$/.test(key) && !existingKeys.includes(key);
  const canSubmit = keyOk && namePl.trim().length > 0 && nameEn.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onCreate({ key, rank, name_pl: namePl, name_en: nameEn });
    setOpen(false);
    setKey("");
    setRank(suggestedRank + 10);
    setNamePl("");
    setNameEn("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setRank(suggestedRank);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {tm("newTierDialog.title")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tm("newTierDialog.title")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{tm("newTierDialog.key")}</Label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value.toLowerCase())}
              placeholder="patron"
              className="font-mono"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{tm("newTierDialog.keyHint")}</p>
          </div>
          <div>
            <Label className="text-xs">{tm("fields.rank")}</Label>
            <Input
              type="number"
              min={0}
              value={rank}
              onChange={(e) => setRank(Number(e.target.value) || 0)}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{tm("newTierDialog.rankHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FloatingInput
              label="Nazwa PL"
              value={namePl}
              onChange={(e) => setNamePl(e.target.value)}
            />
            <FloatingInput
              label="Name EN"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {tm("newTierDialog.cancel")}
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {tm("newTierDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// UI primitives lokalne dla tej strony - spójne z /admin/paywall (KPI, sekcje,
// grupy pól). Nie eksportowane - używane wyłącznie tutaj.
// ---------------------------------------------------------------------------
type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function KpiTile({ icon: Icon, label, value }: { icon: IconType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-card px-3 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted/60 text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="truncate text-sm font-semibold">{value}</div>
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
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border/60 bg-muted/20 px-5 py-3">
        <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[6px] border border-border/60 bg-background text-muted-foreground">
          <Icon className="h-4 w-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      </header>
      <div className={padded ? "space-y-5 p-5" : ""}>{children}</div>
    </section>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
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
